import type { ZoteroItem, IZotero, ZoteroObserver, ZoteroCollection } from '../typings/zotero'
import { ItemPane } from './itemPane'
import { ToolsPane } from './toolsPane'
import { UrlUtil } from './urlUtil'
import { ZoteroUtil } from './zoteroUtil'

declare const Zotero: IZotero
// Firefox/Zotero platform globals available in the privileged plugin scope
declare const IOUtils: any
declare const PathUtils: any
declare const Components: any

enum HttpCodes {
  // Zotero.HTTP.request reports 0 when no response came back (DNS failure, connection refused...)
  NO_RESPONSE = 0,
  DONE = 200,
  NOT_FOUND = 404,
}

class PdfNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfNotFoundError'
    Object.setPrototypeOf(this, PdfNotFoundError.prototype)
  }
}

class NetworkError extends Error {
  constructor(public readonly host: string) {
    super(`Cannot reach ${host}`)
    this.name = 'NetworkError'
    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}

class CaptchaRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptchaRequiredError'
    Object.setPrototypeOf(this, CaptchaRequiredError.prototype)
  }
}

class ItemObserver implements ZoteroObserver {
  // Called when items are added to a collection. We react to 'collection-item'
  // 'add' events so we know exactly which collection each item landed in.
  public async notify(event: string, type: string, ids: string[], _extraData: Record<string, any>) {
    if (event !== 'add') return
    if (!Zotero.Scihub.isAutomaticPdfDownload()) return
    if (type === 'collection-item') {
      await Zotero.Scihub.handleCollectionItemsAdded(ids)
    }
  }
}

interface ManagerRow {
  item: ZoteroItem
  tr: any
  titleText: string
  year: string
  doi: string
  statusCell: any
  hasDoi: boolean
  alreadyHas: boolean
  failed: boolean
  savedPath?: string
  // Where the PDF came from, and whether Zotero already attached it (open access)
  source?: string
  attached?: boolean
}

// A PDF saved into the collection folder by downloadPdfToFolder
interface SavedPdf {
  path: string
  source: string
  attached: boolean
}

// One open download manager per collection. Items arriving while the window
// is still opening wait in `pending`; afterwards they go through `addItems`.
interface ManagerHandle {
  win: any | null
  addItems: ((items: ZoteroItem[]) => void) | null
  pending: ZoteroItem[]
}

class Scihub {
  // TOOD: only bulk-update items which are missing paper attachement
  private static readonly DEFAULT_SCIHUB_URL = 'https://sci-hub.al/'
  // Sci-Hub stopped adding papers in 2022; newer ones are often uploaded to Sci-Net
  private static readonly DEFAULT_SCINET_URL = 'https://sci-net.xyz/'
  private static readonly DEFAULT_AUTOMATIC_PDF_DOWNLOAD = true
  private static readonly USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_3_1 like Mac OS X) '
    + 'AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1'
  // Collections with this exact name are ignored by the plugin
  private static readonly INBOX_COLLECTION_NAME = 'Inbox'
  // Pref holding the per-collection folder map: { [collectionKey]: { name, path } }
  private static readonly COLLECTION_FOLDERS_PREF = 'zoteroscihub.collection_folders'
  private observerId: number | null = null
  private initialized = false
  // Open download managers, keyed by collection key
  private managers = new Map<string, ManagerHandle>()
  // Filenames are truncated to keep them within filesystem limits
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  private static readonly MAX_FILENAME_LENGTH = 150
  // Plugin root URI, injected from bootstrap.js; used to locate bundled windows
  public rootURI = ''
  public ItemPane: ItemPane
  public ToolsPane: ToolsPane

  constructor() {
    this.ItemPane = new ItemPane()
    this.ToolsPane = new ToolsPane()
  }

  public getBaseScihubUrl(): string {
    if (Zotero.Prefs.get('zoteroscihub.scihub_url') === undefined) {
      Zotero.Prefs.set('zoteroscihub.scihub_url', Scihub.DEFAULT_SCIHUB_URL)
    }

    return (Zotero.Prefs.get('zoteroscihub.scihub_url') as string).trim()
  }

  public getBaseScinetUrl(): string {
    if (Zotero.Prefs.get('zoteroscihub.scinet_url') === undefined) {
      Zotero.Prefs.set('zoteroscihub.scinet_url', Scihub.DEFAULT_SCINET_URL)
    }

    return (Zotero.Prefs.get('zoteroscihub.scinet_url') as string).trim()
  }

  public isAutomaticPdfDownload(): boolean {
    if (Zotero.Prefs.get('zoteroscihub.automatic_pdf_download') === undefined) {
      Zotero.Prefs.set('zoteroscihub.automatic_pdf_download', Scihub.DEFAULT_AUTOMATIC_PDF_DOWNLOAD)
    }

    return Zotero.Prefs.get('zoteroscihub.automatic_pdf_download') as boolean
  }

  public load(): void {
    // Register the callback in Zotero as an item observer
    if (this.initialized) return
    this.observerId = Zotero.Notifier.registerObserver(new ItemObserver(), ['collection-item'], 'Scihub')
    this.initialized = true
  }

  public unload(): void {
    if (this.observerId) {
      Zotero.Notifier.unregisterObserver(this.observerId)
    }
  }

  public async updateItems(items: ZoteroItem[]): Promise<void> {
    // WARN: Sequentially go through items, parallel will fail due to rate-limiting
    // Cycle needs to be broken if scihub asks for Captcha,
    // then user have to be redirected to the page to fill it in
    for (const item of items) {
      // Skip items which are not processable
      if (!item.isRegularItem()) { continue }

      // Skip items which already have a PDF attached
      if (await this.itemHasPdfAttachment(item)) {
        Zotero.debug(`scihub: "${item.getField('title')}" already has a PDF attachment`)
        continue
      }

      // Skip items without DOI
      const doi = this.getDoi(item)
      if (!doi) {
        ZoteroUtil.showPopup('DOI is missing', item.getField('title'), true)
        Zotero.debug(`scihub: failed to generate URL for "${item.getField('title')}"`)
        continue
      }

      try {
        await this.updateItem(doi, item)
      } catch (error) {
        if (error instanceof CaptchaRequiredError) {
          // Skip this item and continue with remaining items
          ZoteroUtil.showPopup(
            'Captcha Required',
            `Captcha is required for "${item.getField('title')}". Skipping this item.`,
            true
          )
          Zotero.debug(`scihub: captcha required, skipping "${item.getField('title')}"`)
          continue
        } else if (error instanceof PdfNotFoundError) {
          // Do not stop traversing items if PDF is missing for one of them
          ZoteroUtil.showPopup('PDF not available', `${error.message}.\n"${item.getField('title')}"`, true)
          continue
        } else if (error instanceof NetworkError) {
          // Nothing will work for the other items either
          ZoteroUtil.showPopup(
            'Network error',
            `Cannot reach ${error.host}. Your network may block it (DNS): try another mirror in the plugin settings.`,
            true
          )
          break
        } else {
          // Skip this item on unexpected errors and continue with remaining items
          ZoteroUtil.showPopup(
            'Download Failed',
            `Failed to download PDF for "${item.getField('title')}". Skipping this item.\nError: ${error}`,
            true
          )
          Zotero.debug(`scihub: unexpected error for "${item.getField('title')}": ${error}`)
          continue
        }
      }
    }
  }

  private async updateItem(doi: string, item: ZoteroItem): Promise<void> {
    ZoteroUtil.showPopup('Fetching PDF', item.getField('title'))
    let pdf: { url: URL, source: string }
    try {
      pdf = await this.resolvePdfUrl(doi)
    } catch (error) {
      if (!(error instanceof PdfNotFoundError) && !(error instanceof NetworkError)) throw error
      if (await this.attachOpenAccessPdf(item)) return
      throw error
    }
    await ZoteroUtil.attachRemotePDFToItem(pdf.url, item)
  }

  // Resolves the PDF URL on Sci-Hub, falling back to Sci-Net for papers Sci-Hub
  // does not have or cannot serve right now. Throws CaptchaRequiredError and
  // unexpected errors from Sci-Hub as they are, without trying Sci-Net.
  private async resolvePdfUrl(doi: string, onStatus?: (status: string) => void): Promise<{ url: URL, source: string }> {
    const scihubUrl = new URL(doi, this.getBaseScihubUrl())
    try {
      return { url: await this.resolvePdfHttpsUrl(scihubUrl), source: 'Sci-Hub' }
    } catch (scihubError) {
      if (!(scihubError instanceof PdfNotFoundError) && !(scihubError instanceof NetworkError)) throw scihubError
      const scinetUrl = new URL(doi, this.getBaseScinetUrl())
      Zotero.debug(`scihub: ${scihubError.message}, trying "${scinetUrl}"`)
      onStatus?.('Trying Sci-Net…')
      try {
        return { url: await this.resolveScinetPdfUrl(scinetUrl), source: 'Sci-Net' }
      } catch (scinetError) {
        Zotero.debug(`scihub: Sci-Net failed for "${scinetUrl}": ${scinetError}`)
        // Report an unreachable Sci-Hub rather than a PDF it could not even look for
        if (scihubError instanceof NetworkError) throw scihubError
        throw new PdfNotFoundError('No PDF found')
      }
    }
  }

  // Zotero's own open-access lookup (Unpaywall, OpenAlex, publisher page).
  // Returns the new attachment, or false if there is no open-access copy.
  private async attachOpenAccessPdf(item: ZoteroItem): Promise<ZoteroItem | false> {
    Zotero.debug(`scihub: looking for an open-access copy of "${item.getField('title')}"`)
    try {
      return await Zotero.Attachments.addAvailableFile(item)
    } catch (error) {
      Zotero.debug(`scihub: open-access lookup failed: ${error}`)
      return false
    }
  }

  // GET a Sci-Hub or Sci-Net page. Any status is returned, except 0 (no
  // response at all), which throws NetworkError.
  private async fetchPage(url: URL): Promise<XMLHttpRequest> {
    const xhr = await Zotero.HTTP.request('GET', url.href, {
      responseType: 'document',
      // Sci-Hub may serve its pages (the captcha page too) with a long max-age:
      // without this a retry after solving the captcha could get the cached captcha page
      noCache: true,
      // a 404 is Sci-Hub's "no such paper" answer, not a transport error
      successCodes: false,
      headers: { 'User-Agent': Scihub.USER_AGENT },
      timeout: 30000,
    })
    if (xhr.status === HttpCodes.NO_RESPONSE) {
      // The Gecko error code (e.g. NS_ERROR_UNKNOWN_HOST) tells DNS, TLS and connection problems apart
      const channelStatus = (xhr as XMLHttpRequest & { channel?: { status: number } }).channel?.status
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      Zotero.debug(`scihub: no response from "${url}" (channel status 0x${(channelStatus ?? 0).toString(16)})`)
      throw new NetworkError(url.host)
    }
    return xhr
  }

  // Fetches the Sci-Hub landing page and resolves the direct (https) PDF URL.
  // Throws PdfNotFoundError / CaptchaRequiredError / NetworkError / Error on failure.
  private async resolvePdfHttpsUrl(scihubUrl: URL): Promise<URL> {
    const xhr = await this.fetchPage(scihubUrl)
    // Mirrors may redirect to another domain: resolve links against the final URL
    const pdfUrl = this.extractScihubPdfUrl(xhr.responseXML, xhr.responseURL || scihubUrl.href)
    const body = xhr.responseXML?.querySelector('body')

    if (xhr.status === HttpCodes.DONE && pdfUrl) {
      return UrlUtil.urlToHttps(pdfUrl)
    } else if (xhr.status === HttpCodes.DONE && this.isPdfNotAvailable(body)) {
      Zotero.debug(`scihub: PDF is not available at the moment "${scihubUrl}"`)
      throw new PdfNotFoundError(`Pdf is not available: ${scihubUrl}`)
    } else if (xhr.status === HttpCodes.DONE && this.isCaptchaRequired(body)) {
      Zotero.debug(`scihub: captcha required for "${scihubUrl}"`)
      throw new CaptchaRequiredError(`Captcha is required: ${scihubUrl}`)
    } else if (xhr.status === HttpCodes.DONE || xhr.status === HttpCodes.NOT_FOUND) {
      // Any other page without a PDF ("try Sci-Net", search page...) means the
      // paper is not here. Log a snippet so a new page format can be diagnosed.
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const snippet = (body?.innerHTML ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
      Zotero.debug(`scihub: ${xhr.status} but no PDF link for "${scihubUrl.href}". Body snippet: ${snippet}`)
      throw new PdfNotFoundError(`Pdf is not available: ${scihubUrl}`)
    } else {
      Zotero.debug(`scihub: failed to fetch PDF from "${scihubUrl}" status=${xhr.status} statusText=${xhr.statusText}`)
      throw new Error(`HTTP ${xhr.status}${xhr.statusText ? ` ${xhr.statusText}` : ''}`)
    }
  }

  // Sci-Net shows the paper in an iframe; unknown DOIs are redirected to the home page
  private async resolveScinetPdfUrl(scinetUrl: URL): Promise<URL> {
    const xhr = await this.fetchPage(scinetUrl)
    const rawUrl = xhr.responseXML?.querySelector('iframe[src*=".pdf"]')?.getAttribute('src')
    if (xhr.status === HttpCodes.DONE && rawUrl) {
      return UrlUtil.urlToHttps(new URL(rawUrl, xhr.responseURL || scinetUrl.href).href)
    }
    throw new PdfNotFoundError(`Pdf is not available: ${scinetUrl}`)
  }

  private extractScihubPdfUrl(doc: Document | null | undefined, baseUrl: string): string | null {
    if (!doc) return null
    // older .tf domains have an iframe#pdf, .st domains an embed#pdf, and the
    // .ru domain (2026) a citation_pdf_url meta, an <object> and a download link
    const rawUrl = doc.querySelector('#pdf')?.getAttribute('src')
      ?? doc.querySelector('meta[name="citation_pdf_url"]')?.getAttribute('content')
      ?? doc.querySelector('object[type="application/pdf"]')?.getAttribute('data')
      ?? doc.querySelector('.download a')?.getAttribute('href')
    if (!rawUrl) return null
    // Resolve relative and protocol-relative ("//host/file.pdf") urls against the page
    return new URL(rawUrl, baseUrl).href
  }

  private isPdfNotAvailable(body: HTMLBodyElement | null | undefined): boolean {
    const innerHTML = body?.innerHTML
    // older .tf domain return rich error message
    // newer .st domains return empty page if pdf is not available
    // sci-hub.ru (2026) answers "статья отсутствует в базе" (article not in the
    // database) for papers published after 2021, pointing to Sci-Net
    if (!innerHTML || innerHTML?.trim() === '' ||
      innerHTML?.match(/Please try to search again using DOI/im) ||
      innerHTML?.match(/статья не найдена в базе/im) ||
      innerHTML?.match(/(отсутствует|нет) в (моей )?базе/im)) {
      return true
    }
    return false
  }

  private isCaptchaRequired(body: HTMLBodyElement | null | undefined): boolean {
    // sci-hub.ru (2026) asks "are you a robot?" in a .question with an .answer button
    if (body?.querySelector('.question .answer')) {
      return true
    }
    const innerHTML = body?.innerHTML
    if (innerHTML?.match(/captcha|challenge/im)) {
      return true
    }
    return false
  }

  private getDoi(item: ZoteroItem): string | null {
    const doiField = item.getField('DOI')
    const doiFromExtra = this.getDoiFromExtra(item)
    const doiFromUrl = this.getDoiFromUrl(item)
    const doi = doiField ?? doiFromExtra ?? doiFromUrl

    if (doi && (typeof doi === 'string') && doi.length > 0) {
      return doi
    }
    return null
  }

  private getDoiFromExtra(item: ZoteroItem): string | null {
    // For books "extra" field might contain DOI instead
    // values in extra are <key>: <value> separated by newline
    const extra = item.getField('extra')
    const match = extra?.match(/^DOI: (.+)$/m)
    if (match) {
      return match[1]
    }
    return null
  }

  private getDoiFromUrl(item: ZoteroItem): string | null {
    // If item was added by the doi.org url it can be extracted from its pathname
    const url = item.getField('url')
    const isDoiOrg = url?.match(/\bdoi\.org\b/i)
    if (isDoiOrg) {
      const doiPath = new URL(url).pathname
      return decodeURIComponent(doiPath).replace(/^\//, '')
    }
    return null
  }

  private generateScihubItemUrl(item: ZoteroItem): URL | null {
    const doi = this.getDoi(item)
    if (doi) {
      const baseUrl = this.getBaseScihubUrl()
      return new URL(doi, baseUrl)
    }
    return null
  }

  // Public helper so the review dialog can show each item's DOI
  public getItemDoi(item: ZoteroItem): string | null {
    return this.getDoi(item)
  }

  // True if the item already has a PDF attachment. Used to skip re-downloading
  // (and never overwrite) items that already have their file.
  public async itemHasPdfAttachment(item: ZoteroItem): Promise<boolean> {
    const attachmentIds = item.getAttachments?.() ?? []
    for (const id of attachmentIds) {
      const attachment = await Zotero.Items.getAsync(id)
      if (attachment && this.isPdfAttachment(attachment)) {
        return true
      }
    }
    return false
  }

  private isPdfAttachment(attachment: any): boolean {
    // Prefer Zotero's dedicated helper, fall back to the stored content type
    if (typeof attachment.isPDFAttachment === 'function') {
      return attachment.isPDFAttachment() as boolean
    }
    return attachment.attachmentContentType === 'application/pdf'
  }

  // Opens a native "choose folder" dialog and returns the selected path (or null).
  // Runs in the privileged plugin scope, parented to the given window.
  public async pickFolder(parentWindow: { browsingContext?: unknown } | null): Promise<string | null> {
    const nsIFilePicker = Components.interfaces.nsIFilePicker
    const fp = Components.classes['@mozilla.org/filepicker;1'].createInstance(nsIFilePicker)
    const browsingContext = parentWindow?.browsingContext ?? Zotero.getMainWindow().browsingContext
    fp.init(browsingContext, 'Select destination folder for the PDFs', nsIFilePicker.modeGetFolder)
    const result = await new Promise<number>(resolve => { fp.open(resolve) })
    if (result === nsIFilePicker.returnOK) {
      return fp.file.path as string
    }
    return null
  }

  // --- Per-collection folder mapping (persisted in prefs) ---

  public getCollectionFolders(): Record<string, { name: string, path: string }> {
    const raw = Zotero.Prefs.get(Scihub.COLLECTION_FOLDERS_PREF)
    if (typeof raw !== 'string' || raw.length === 0) {
      return {}
    }
    try {
      return JSON.parse(raw) as Record<string, { name: string, path: string }>
    } catch {
      return {}
    }
  }

  public getCollectionFolder(collectionKey: string): { name: string, path: string } | null {
    return this.getCollectionFolders()[collectionKey] ?? null
  }

  public setCollectionFolder(collectionKey: string, name: string, path: string): void {
    const folders = this.getCollectionFolders()
    folders[collectionKey] = { name, path }
    Zotero.Prefs.set(Scihub.COLLECTION_FOLDERS_PREF, JSON.stringify(folders))
  }

  public removeCollectionFolder(collectionKey: string): void {
    const folders = this.getCollectionFolders()
    delete folders[collectionKey]
    Zotero.Prefs.set(Scihub.COLLECTION_FOLDERS_PREF, JSON.stringify(folders))
  }

  private isInboxCollection(collection: ZoteroCollection): boolean {
    return collection.name === Scihub.INBOX_COLLECTION_NAME
  }

  // First non-Inbox collection the item belongs to, or null
  private getFirstValidCollection(item: ZoteroItem): ZoteroCollection | null {
    const collectionIds = item.getCollections?.() ?? []
    for (const id of collectionIds) {
      const collection = Zotero.Collections.get(id)
      if (collection && !this.isInboxCollection(collection)) {
        return collection
      }
    }
    return null
  }

  // --- Download flow ---

  // Auto-trigger: items just added to collections. Grouped per (non-Inbox)
  // collection; each item is handled for the first collection it lands in.
  public async handleCollectionItemsAdded(ids: string[]): Promise<void> {
    const seen = new Set<number>()
    const groups = new Map<string, { collection: ZoteroCollection, items: ZoteroItem[] }>()

    for (const id of ids) {
      // 'collection-item' ids look like "<collectionID>-<itemID>"
      const [collectionIdStr, itemIdStr] = id.split('-')
      const collectionId = parseInt(collectionIdStr)
      const itemId = parseInt(itemIdStr)
      if (isNaN(collectionId) || isNaN(itemId) || seen.has(itemId)) continue

      const collection = Zotero.Collections.get(collectionId)
      if (!collection || this.isInboxCollection(collection)) continue

      const item = await Zotero.Items.getAsync(itemId)
      if (!item || !item.isRegularItem()) continue

      seen.add(itemId)
      const group = groups.get(collection.key) ?? { collection, items: [] }
      group.items.push(item)
      groups.set(collection.key, group)
    }

    for (const group of groups.values()) {
      await this.openDownloadManager(group.collection, group.items)
    }
  }

  // Manual trigger: right-click a collection
  public async openCollectionDownload(): Promise<void> {
    const ZoteroPane = Zotero.getActiveZoteroPane()
    const collection = ZoteroPane.getSelectedCollection(false)
    if (!collection) {
      ZoteroUtil.showPopup('No collection selected', 'Select a collection first.', true)
      return
    }
    if (this.isInboxCollection(collection)) {
      ZoteroUtil.showPopup('Inbox skipped', 'The "Inbox" collection is ignored by Sci-Hub.', true)
      return
    }
    await this.openDownloadManager(collection, collection.getChildItems(false, false))
  }

  // Manual trigger: right-click items; each routed to its first valid collection
  public async openSelectedItemsDownload(): Promise<void> {
    const ZoteroPane = Zotero.getActiveZoteroPane()
    const seen = new Set<number>()
    const groups = new Map<string, { collection: ZoteroCollection, items: ZoteroItem[] }>()

    for (const item of ZoteroPane.getSelectedItems()) {
      if (!item.isRegularItem()) continue
      const collection = this.getFirstValidCollection(item)
      if (!collection) {
        ZoteroUtil.showPopup('No collection', `"${item.getField('title')}" is not in a non-Inbox collection. Skipped.`, true)
        continue
      }
      const itemId = parseInt(item.id)
      if (seen.has(itemId)) continue
      seen.add(itemId)
      const group = groups.get(collection.key) ?? { collection, items: [] }
      group.items.push(item)
      groups.set(collection.key, group)
    }

    for (const group of groups.values()) {
      await this.openDownloadManager(group.collection, group.items)
    }
  }

  // Resolves the destination folder for a collection: returns its mapped folder,
  // or prompts the user to pick one (saving the mapping). Null if cancelled.
  private async resolveFolderForCollection(collection: ZoteroCollection): Promise<string | null> {
    const existing = this.getCollectionFolder(collection.key)
    if (existing) {
      return existing.path
    }
    const picked = await this.pickFolder(Zotero.getMainWindow())
    if (!picked) {
      return null
    }
    this.setCollectionFolder(collection.key, collection.name, picked)
    return picked
  }

  // Opens the download-manager window for a collection: resolves its folder
  // (asking once if unset), then builds the item list with live per-item progress.
  // The UI is built programmatically here (Zotero 9's CSP blocks scripts loaded
  // inside plugin dialog documents), so there are no per-item prompts or popups.
  // If the collection already has a manager open (or opening), the items are
  // appended to it instead: adding papers one by one fires one notifier event
  // per item, and each event must not spawn or reset a window.
  public async openDownloadManager(collection: ZoteroCollection, items: ZoteroItem[]): Promise<void> {
    const regular = items.filter(item => item.isRegularItem())
    if (regular.length === 0) {
      ZoteroUtil.showPopup('Nothing to download', `"${collection.name}" has no regular items.`, true)
      return
    }

    // win is null while the folder is being resolved, so the handle counts as open
    const existing = this.managers.get(collection.key)
    if (existing && !existing.win?.closed) {
      if (existing.addItems) {
        existing.addItems(regular)
      } else {
        existing.pending.push(...regular)
      }
      return
    }

    // Registered before the first await so concurrent calls queue into it
    const handle: ManagerHandle = { win: null, addItems: null, pending: regular.slice() }
    this.managers.set(collection.key, handle)
    const forget = () => {
      if (this.managers.get(collection.key) === handle) this.managers.delete(collection.key)
    }

    try {
      const folder = await this.resolveFolderForCollection(collection)
      if (!folder) {
        forget()
        return
      }

      Zotero.debug(`scihub: opening download manager for "${collection.name}" (${handle.pending.length} items) -> ${folder}`)
      const mainWin = Zotero.getMainWindow()
      // Open a blank window (loads instantly) and build the UI into it. Loading a
      // bundled file via openDialog fails for packaged plugins (jar: rootURI), so
      // the window's document stays "uninitialized".
      // The name must be '_blank': with a fixed name, openDialog returns the
      // window already open and schedules a fresh about:blank load in it, which
      // wipes whatever gets built there in the meantime.
      const win = mainWin.openDialog(
        'about:blank',
        '_blank',
        'chrome,centerscreen,resizable,dialog=no,width=1080,height=640'
      )
      if (!win) {
        forget()
        ZoteroUtil.showPopup('Error', 'Could not open the download window.', true)
        return
      }
      handle.win = win

      Zotero.debug(`scihub: openDialog returned win=${!!win}, type=${typeof win}`)

      // The dialog's 'load' event is unreliable from the opener, so poll the new
      // window until it has a real, sized document, then build the UI into it.
      // Building too early (the throwaway about:blank, or a 0-height window) is
      // why content didn't show, so we wait for readyState + innerHeight > 0.
      /* eslint-disable @typescript-eslint/no-magic-numbers */
      let attempts = 0
      const tryBuild = () => {
        attempts += 1
        let state = 'no-document'
        let hasBody = false
        let height = -1
        try {
          if (win.document) {
            state = win.document.readyState
            hasBody = !!win.document.body
          }
          height = win.innerHeight
        } catch (e) {
          state = `err:${e}`
        }
        if (attempts === 1 || attempts % 10 === 0) {
          Zotero.debug(`scihub: poll #${attempts} state=${state} body=${hasBody} innerHeight=${height}`)
        }

        const documentReady = state === 'complete' || state === 'interactive'
        const fallback = attempts > 100 // ~5s: build anyway rather than hang
        if (hasBody && ((documentReady && height > 0) || fallback)) {
          Zotero.debug(`scihub: building (attempt ${attempts}, state=${state}, innerHeight=${height})`)
          try {
            const addItems = this.buildDownloadManager(win, handle.pending, folder, collection)
            handle.pending = []
            handle.addItems = addItems
          } catch (error) {
            forget()
            Zotero.debug(`scihub: buildDownloadManager failed: ${error}`)
            ZoteroUtil.showPopup('Error', `Download window failed to render: ${error}`, true)
          }
          return
        }
        if (attempts > 200) {
          forget()
          Zotero.debug(`scihub: gave up waiting; state=${state} body=${hasBody} innerHeight=${height}`)
          ZoteroUtil.showPopup('Error', 'Download window did not become ready.', true)
          return
        }
        mainWin.setTimeout(tryBuild, 50)
      }
      tryBuild()
      /* eslint-enable @typescript-eslint/no-magic-numbers */
    } catch (error) {
      forget()
      Zotero.debug(`scihub: error opening download manager: ${error}`)
      ZoteroUtil.showPopup('Error', `Could not open the download window: ${error}`, true)
    }
  }

  // Builds the manager UI inside the (already loaded) blank dialog window.
  // Returns a function that appends more items to the list (duplicates ignored).
  private buildDownloadManager(win: any, items: ZoteroItem[], folder: string, collection: ZoteroCollection): (items: ZoteroItem[]) => void {
    const doc = win.document
    Zotero.debug(`scihub: building manager UI, readyState=${doc.readyState}`)

    const root = doc.body
    if (!root) {
      Zotero.debug('scihub: dialog has no document.body')
      throw new Error('Download window shell did not load.')
    }
    Zotero.debug(`scihub: innerWidth=${win.innerWidth} innerHeight=${win.innerHeight}`)
    try { doc.title = `Sci-Hub Download Manager — ${collection.name}` } catch (e) { /* ignore */ }
    if (doc.documentElement && doc.documentElement.style) {
      doc.documentElement.style.height = '100%'
      doc.documentElement.style.colorScheme = 'light dark'
    }
    // System colors that follow the OS/Zotero light/dark theme
    root.style.cssText = 'height:100%; margin:0; background:Canvas; color:CanvasText; color-scheme:light dark; font:message-box;'
    while (root.firstChild) root.removeChild(root.firstChild)

    const make = (tag: string, css?: string, text?: string): any => {
      const el = doc.createElement(tag)
      if (css) el.style.cssText = css
      if (text != null) el.textContent = text
      return el
    }

    // Viewport-relative height so the flex layout fills the window even if the
    // window had no measured size yet when we built (innerHeight can be 0 early).
    let currentFolder = folder
    const container = make('div',
      'display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:12px; height:100vh;')
    root.appendChild(container)

    const header = make('div', 'display:flex; align-items:center; gap:6px;')
    header.appendChild(make('span', '', 'Collection:'))
    header.appendChild(make('b', '', collection.name))
    container.appendChild(header)

    const folderRow = make('div', 'display:flex; align-items:center; gap:8px;')
    folderRow.appendChild(make('span', 'opacity:0.7;', 'Folder:'))
    const folderLabel = make('span', 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.85;', currentFolder)
    folderRow.appendChild(folderLabel)
    const changeBtn = make('button', '', 'Change folder…')
    folderRow.appendChild(changeBtn)
    container.appendChild(folderRow)

    // Main area: items table on the left, live activity / captcha panel on the right
    const mainRow = make('div', 'flex:1 1 auto; min-height:0; display:flex; gap:8px;')
    const listWrap = make('div', 'flex:1 1 auto; min-width:0; min-height:0; overflow:auto; border:1px solid rgba(127,127,127,0.4); border-radius:4px;')
    const table = make('table', 'width:100%; border-collapse:collapse;')
    const thead = make('thead')
    const headRow = make('tr')
    const headerDefs = [
      { label: 'Title', width: '' },
      { label: 'Year', width: 'width:70px;' },
      { label: 'DOI', width: 'width:170px;' },
      { label: 'Status', width: 'width:160px;' },
    ]
    const headerCells: any[] = []
    headerDefs.forEach((def, index) => {
      const th = make('th',
        `text-align:left; padding:4px; position:sticky; top:0; background:Canvas; cursor:pointer; user-select:none; ${def.width}`,
        def.label)
      th.addEventListener('click', () => { sortBy(index) })
      headerCells.push(th)
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    table.appendChild(thead)
    const tbody = make('tbody')
    table.appendChild(tbody)
    listWrap.appendChild(table)
    mainRow.appendChild(listWrap)

    // Right-side panel: activity log + (hidden until needed) captcha iframe
    const panel = make('div', 'flex:0 0 380px; width:380px; display:flex; flex-direction:column; gap:6px; border:1px solid rgba(127,127,127,0.4); border-radius:4px; padding:6px; box-sizing:border-box;')
    panel.appendChild(make('div', 'font-weight:bold;', 'Activity'))
    const logArea = make('div', 'flex:1 1 auto; min-height:60px; overflow:auto; font-size:0.9em; line-height:1.35;')
    panel.appendChild(logArea)
    const logActivity = (text: string) => {
      logArea.appendChild(make('div', '', text))
      logArea.scrollTop = logArea.scrollHeight
    }

    const captchaArea = make('div', 'display:none; flex-direction:column; gap:4px; flex:2 1 auto; min-height:0;')
    const captchaMsg = make('div', 'font-weight:bold;', 'Captcha required — solve it below, then click Continue.')
    const captchaFrame = make('iframe', 'flex:1 1 auto; width:100%; min-height:220px; border:1px solid rgba(127,127,127,0.4); background:#fff;')
    const captchaButtons = make('div', 'display:flex; gap:4px; flex-wrap:wrap;')
    const solveBtn = make('button', '', 'Resolvi — continuar')
    const skipBtn = make('button', '', 'Pular')
    const popBtn = make('button', '', 'Abrir em janela')
    captchaButtons.appendChild(solveBtn)
    captchaButtons.appendChild(skipBtn)
    captchaButtons.appendChild(popBtn)
    captchaArea.appendChild(captchaMsg)
    captchaArea.appendChild(captchaFrame)
    captchaArea.appendChild(captchaButtons)
    panel.appendChild(captchaArea)

    mainRow.appendChild(panel)
    container.appendChild(mainRow)

    const footer = make('div', 'display:flex; align-items:center; gap:8px;')
    const summary = make('span', 'opacity:0.8;', '')
    footer.appendChild(summary)
    footer.appendChild(make('span', 'flex:1;'))
    const startBtn = make('button', '', 'Start download')
    const retryBtn = make('button', '', 'Retry failed')
    retryBtn.disabled = true
    const closeBtn = make('button', '', 'Close')
    footer.appendChild(startBtn)
    footer.appendChild(retryBtn)
    footer.appendChild(closeBtn)
    container.appendChild(footer)

    const rows: ManagerRow[] = []
    const rowItemIds = new Set<number>()
    let total = 0

    // Click a column header to sort by it (toggles ascending/descending)
    let sortCol = -1
    let sortAsc = true
    const applySort = () => {
      const col = sortCol
      const value = (r: ManagerRow): string => {
        if (col === 0) return r.titleText.toLowerCase()
        if (col === 1) return r.year
        if (col === 2) return r.doi.toLowerCase()
        return String(r.statusCell.textContent ?? '')
      }
      const sorted = rows.slice().sort((a, b) => {
        const va = value(a)
        const vb = value(b)
        if (va < vb) return sortAsc ? -1 : 1
        if (va > vb) return sortAsc ? 1 : -1
        return 0
      })
      sorted.forEach(r => { tbody.appendChild(r.tr) })
      headerCells.forEach((th, i) => {
        th.textContent = headerDefs[i].label + (i === col ? (sortAsc ? '  ▲' : '  ▼') : '')
      })
    }
    const sortBy = (col: number) => {
      if (sortCol === col) { sortAsc = !sortAsc } else { sortCol = col; sortAsc = true }
      applySort()
    }

    const isDone = (r: ManagerRow): boolean => String(r.statusCell.textContent ?? '').startsWith('✓')
    const updateSummary = () => {
      const done = rows.filter(isDone).length
      summary.textContent = `${done} / ${total} done`
    }

    // Appends items not yet listed. Rows pushed while a download run is going
    // over `rows` get picked up by that same run.
    const addRows = (newItems: ZoteroItem[]): ManagerRow[] => {
      const added: ManagerRow[] = []
      for (const item of newItems) {
        const itemId = parseInt(item.id)
        if (rowItemIds.has(itemId)) continue
        rowItemIds.add(itemId)
        const doi = this.getDoi(item) || ''
        const hasDoi = !!doi
        if (hasDoi) total += 1
        const titleText = item.getField('title') || '(untitled)'
        const year = this.getItemYear(item)
        const tr = make('tr', 'border-top:1px solid rgba(127,127,127,0.25);')
        tr.appendChild(make('td', 'padding:4px;', titleText))
        tr.appendChild(make('td', 'padding:4px; white-space:nowrap;', year || '—'))
        tr.appendChild(make('td', 'padding:4px; opacity:0.8; word-break:break-all;', doi || '—'))
        const statusCell = make('td', 'padding:4px;', hasDoi ? 'Queued' : 'No DOI')
        tr.appendChild(statusCell)
        tbody.appendChild(tr)
        const row: ManagerRow = { item, tr, titleText, year, doi, statusCell, hasDoi, alreadyHas: false, failed: false }
        rows.push(row)
        added.push(row)
      }
      if (added.length === 0) return added
      if (sortCol >= 0) applySort()
      updateSummary()

      // Pre-mark already-downloaded items (async, non-blocking)
      void (async () => {
        for (const row of added) {
          if (!row.hasDoi) continue
          try {
            if (await this.itemHasPdfAttachment(row.item)) {
              row.alreadyHas = true
              row.statusCell.textContent = '✓ Already downloaded'
              updateSummary()
            }
          } catch (e) { /* ignore */ }
        }
      })()
      return added
    }

    addRows(items)
    updateSummary()
    Zotero.debug(`scihub: manager UI built, ${rows.length} rows, ${total} with DOI`)

    // Captcha gate: shows the Sci-Hub page in the side iframe and resolves with
    // the user's choice ('retry' after solving, or 'skip').
    let captchaResolve: ((action: string) => void) | null = null
    const hideCaptcha = () => {
      captchaArea.style.display = 'none'
      captchaFrame.src = 'about:blank'
      logArea.style.flex = '1 1 auto'
    }
    const showCaptcha = (url: string): Promise<string> => {
      captchaFrame.src = url
      captchaArea.style.display = 'flex'
      logArea.style.flex = '0 0 60px'
      return new Promise<string>(resolve => { captchaResolve = resolve })
    }
    const settleCaptcha = (action: string) => {
      if (!captchaResolve) return
      const resolve = captchaResolve
      captchaResolve = null
      hideCaptcha()
      resolve(action)
    }
    solveBtn.addEventListener('click', () => { settleCaptcha('retry') })
    skipBtn.addEventListener('click', () => { settleCaptcha('skip') })
    popBtn.addEventListener('click', () => {
      try {
        Zotero.getMainWindow().open(captchaFrame.src, 'scihub-captcha', 'centerscreen,resizable,width=860,height=760')
      } catch (e) { /* ignore */ }
    })

    let running = false
    const setBusy = (busy: boolean) => {
      running = busy
      startBtn.disabled = busy
      changeBtn.disabled = busy
      closeBtn.disabled = busy
      retryBtn.disabled = busy || rows.filter(r => r.failed).length === 0
    }

    // Downloads (and attaches) a set of rows, updating status live. Re-uses the
    // already-saved file on retry so it never re-downloads or duplicates. On a
    // captcha it pauses and waits for the user before moving to the next item.
    const processRows = async (target: ManagerRow[]) => {
      if (running) return
      setBusy(true)
      for (const row of target) {
        if (!row.hasDoi) continue

        let exists = row.alreadyHas
        if (!exists && !row.savedPath) {
          try { exists = await this.itemHasPdfAttachment(row.item) } catch (e) { exists = false }
        }
        if (exists) {
          row.statusCell.textContent = '✓ Already downloaded'
          row.failed = false
          updateSummary()
          continue
        }

        const scihubUrl = this.generateScihubItemUrl(row.item)
        let resolved = false
        while (!resolved) {
          try {
            if (!row.savedPath) {
              row.statusCell.textContent = 'Downloading…'
              logActivity(`⬇ ${row.titleText}`)
              const saved = await this.downloadPdfToFolder(row.item, currentFolder, status => {
                row.statusCell.textContent = status
                logActivity(`↪ ${status}`)
              })
              row.savedPath = saved.path
              row.source = saved.source
              row.attached = saved.attached
            }
            if (!row.attached) {
              row.statusCell.textContent = 'Attaching…'
              await this.attachFileToItem(row.item, row.savedPath)
              row.attached = true
            }
            const via = row.source && row.source !== 'Sci-Hub' ? ` (${row.source})` : ''
            row.statusCell.textContent = `✓ Done${via}`
            row.failed = false
            resolved = true
            logActivity(`✓ ${row.titleText}${via}`)
          } catch (error) {
            const err: any = error
            if (err instanceof CaptchaRequiredError && scihubUrl) {
              // Pause: let the user solve the captcha, then retry this same item
              row.statusCell.textContent = '⏸ Solve captcha'
              logActivity(`⏸ Captcha: ${row.titleText} — solve it on the right`)
              const action = await showCaptcha(scihubUrl.href)
              if (action === 'skip') {
                row.statusCell.textContent = '⚠ Captcha (skipped)'
                row.failed = true
                resolved = true
                logActivity(`⤼ Skipped: ${row.titleText}`)
              }
              // otherwise loop and retry the same item
            } else {
              Zotero.debug(`scihub: FAILED "${row.titleText}" saved=${!!row.savedPath}: name=${err && err.name} message=${err && err.message} str=${String(err)}`)
              row.statusCell.textContent = row.savedPath ? '⚠ Saved, attach failed' : this.describeDownloadError(err)
              row.failed = true
              resolved = true
              logActivity(`✕ ${row.titleText}: ${String(row.statusCell.textContent)}`)
            }
          }
        }
        updateSummary()
      }
      setBusy(false)
      const failedCount = rows.filter(r => r.failed).length
      retryBtn.textContent = failedCount > 0 ? `Retry failed (${failedCount})` : 'Retry failed'
      retryBtn.disabled = failedCount === 0
    }

    closeBtn.addEventListener('click', () => { win.close() })
    changeBtn.addEventListener('click', () => {
      void (async () => {
        const picked = await this.pickFolder(win)
        if (picked) {
          currentFolder = picked
          folderLabel.textContent = picked
          this.setCollectionFolder(collection.key, collection.name, picked)
        }
      })()
    })
    startBtn.addEventListener('click', () => { void processRows(rows) })
    retryBtn.addEventListener('click', () => { void processRows(rows.filter(r => r.failed)) })

    return (newItems: ZoteroItem[]) => {
      const added = addRows(newItems)
      if (added.length === 0) return
      logActivity(`+ ${added.length} item(s) added to the list`)
      Zotero.debug(`scihub: appended ${added.length} rows to "${collection.name}" manager (${rows.length} total)`)
    }
  }

  // Short, human-readable reason a download failed (shown in the Status column)
  private describeDownloadError(error: any): string {
    if (error instanceof CaptchaRequiredError) return '⚠ Captcha required'
    if (error instanceof PdfNotFoundError || error instanceof NetworkError) return `✕ ${error.message}`
    let message = error && error.message ? String(error.message) : ''
    if (!message) message = error && error.name ? String(error.name) : String(error)
    if (!message || message === 'Error') message = 'Unknown error'
    if (message === 'DOI is missing') return '✕ No DOI'
    if (/timeout/i.test(message)) return '✕ Timed out'
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    return `✕ ${message}`.slice(0, 90)
  }

  // Best-effort publication year for the Year column
  private getItemYear(item: ZoteroItem): string {
    const date = item.getField('date')
    const match = date ? date.match(/\d{4}/) : null
    return match ? match[0] : ''
  }

  // Downloads the item's PDF (Sci-Hub, then Sci-Net) and saves it into
  // folderPath. When neither has it, Zotero's open-access lookup attaches a copy
  // and that file is copied into folderPath. onStatus reports each fallback.
  // Throws PdfNotFoundError / CaptchaRequiredError / NetworkError / Error.
  public async downloadPdfToFolder(item: ZoteroItem, folderPath: string, onStatus?: (status: string) => void): Promise<SavedPdf> {
    const doi = this.getDoi(item)
    if (!doi) {
      throw new Error('DOI is missing')
    }

    let pdf: { url: URL, source: string }
    try {
      pdf = await this.resolvePdfUrl(doi, onStatus)
    } catch (error) {
      if (!(error instanceof PdfNotFoundError) && !(error instanceof NetworkError)) throw error
      onStatus?.('Looking for open access…')
      const attachment = await this.attachOpenAccessPdf(item)
      if (!attachment) throw error
      const storedPath = await attachment.getFilePathAsync?.()
      if (!storedPath) throw new Error('Open-access file attached, but not found on disk')
      const ext: string = PathUtils.filename(storedPath).split('.').pop() || 'pdf'
      const copyPath = await this.buildUniqueFilePath(item, folderPath, ext)
      await IOUtils.copy(storedPath, copyPath)
      return { path: copyPath, source: 'open access', attached: true }
    }

    // Fetch the raw PDF bytes
    const xhr = await Zotero.HTTP.request(
      'GET', pdf.url.href, { responseType: 'arraybuffer', timeout: 60000 }
    )
    if (xhr.status !== HttpCodes.DONE || !xhr.response) {
      throw new Error(xhr.status === HttpCodes.DONE
        ? 'Empty PDF response'
        : `HTTP ${xhr.status}${xhr.statusText ? ` ${xhr.statusText}` : ''} fetching PDF`)
    }
    const bytes = new Uint8Array(xhr.response as ArrayBuffer)
    if (!this.looksLikePdf(bytes)) {
      Zotero.debug(`scihub: ${pdf.source} returned something that is not a PDF from "${pdf.url.href}"`)
      throw new Error(`${pdf.source} did not return a PDF`)
    }

    // Write to the chosen folder under a unique, human-readable filename
    const filePath = await this.buildUniqueFilePath(item, folderPath)
    await IOUtils.write(filePath, bytes)
    return { path: filePath, source: pdf.source, attached: false }
  }

  // A PDF starts with "%PDF-", possibly after a few bytes of junk
  private looksLikePdf(bytes: Uint8Array): boolean {
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    const head = String.fromCharCode(...Array.from(bytes.subarray(0, 1024)))
    return head.includes('%PDF-')
  }

  // Attaches an already-saved file to the matching Zotero item. The copy in
  // Zotero's storage follows the user's file renaming settings, like a file
  // added through Zotero's own "Attach File" does.
  public async attachFileToItem(item: ZoteroItem, filePath: string): Promise<void> {
    let fileBaseName: string | false = false
    if (Zotero.Attachments.shouldAutoRenameFile?.(false, item.libraryID)) {
      fileBaseName = await Zotero.Attachments.getRenamedFileBaseNameIfAllowedType?.(item, filePath) ?? false
    }
    await Zotero.Attachments.importFromFile({
      file: Zotero.File.pathToFile(filePath),
      libraryID: item.libraryID,
      parentItemID: item.id,
      title: item.getField('title'),
      contentType: 'application/pdf',
      ...(fileBaseName ? { fileBaseName } : {}),
    })
  }

  private async buildUniqueFilePath(item: ZoteroItem, folderPath: string, ext = 'pdf'): Promise<string> {
    const base = this.buildFileBaseName(item)
    let candidate: string = PathUtils.join(folderPath, `${base}.${ext}`)
    let counter = 2
    while (await IOUtils.exists(candidate)) {
      candidate = PathUtils.join(folderPath, `${base} (${counter}).${ext}`)
      counter += 1
    }
    return candidate
  }

  private buildFileBaseName(item: ZoteroItem): string {
    const title = item.getField('title')
    const raw = (title && title.trim()) || this.getDoi(item) || 'paper'
    // Strip characters illegal on common filesystems and collapse whitespace
    const sanitized = raw
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Scihub.MAX_FILENAME_LENGTH)
    return sanitized || 'paper'
  }
}

Zotero.Scihub = new Scihub()

export { Scihub }
