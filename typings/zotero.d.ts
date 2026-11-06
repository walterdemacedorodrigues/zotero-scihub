interface IZoteroPane {
  canEdit: () => boolean
  displayCannotEditLibraryMessage: () => void
  getSelectedCollection: (asID: boolean) => ZoteroCollection | null
  getSelectedItems: () => [ZoteroItem]
  getSelectedLibraryID: () => number
}

interface ZoteroCollection {
  id: number
  key: string
  name: string
  getChildItems: (asIDs: boolean, includeDeleted: boolean) => [ZoteroItem]
}

interface ZoteroObserver {
  notify: (event: string, type: string, ids: any[], extraData: Record<string, any>) => Promise<void>
}

interface ZoteroItem {
  id: string
  libraryID: string
  getField: (field: string, unformatted?: boolean, includeBaseMapped?: boolean) => string
  isRegularItem: () => boolean
  getCollections?: () => number[]
  getAttachments?: () => number[]
  // attachments only: path of the stored file, false if it is missing
  getFilePathAsync?: () => Promise<string | false>
}

interface ProgressWindow {
  changeHeadline: (headline: string, icon?: string, postText?: string) => void
  addDescription: (body: string) => void
  startCloseTimer: (millis: number) => void
  show: () => void
}

interface IZotero {
  Scihub: import('../content/scihub').Scihub

  debug: (msg: string) => void
  logError: (err: Error | string) => void
  launchURL: (url: string) => void
  getActiveZoteroPane: () => IZoteroPane
  getMainWindows: () => any[]
  getMainWindow: () => any

  Notifier: {
    registerObserver: (observer: ZoteroObserver, types: string[], id: string, priority?: number) => number // any => ZoteroObserver
    unregisterObserver: (id: number) => void
  }

  Prefs: {
    get: (pref: string, global?: boolean) => string | number | boolean
    set: (pref: string, value: string | number | boolean) => any
  }

  Items: {
    getAsync: (ids: number | number[]) => Promise<any | any[]>
    getAll: (libraryID: number) => Promise<ZoteroItem[]>
  }

  Collections: {
    get: (id: number) => ZoteroCollection | false
  }

  HTTP: {
    request: (method: string, url: string, options?: {
      body?: string,
      responseType?: XMLHttpRequestResponseType,
      headers?: Record<string, string>,
      timeout?: number,
      noCache?: boolean,
      // HTTP status codes considered successful, or false to accept any
      successCodes?: number[] | false,
    }) => Promise<XMLHttpRequest>
  }

  Attachments: {
    importFromURL: (options: Record<string, any>) => Promise<ZoteroItem>
    importFromFile: (options: Record<string, any>) => Promise<ZoteroItem>
    // Zotero's "Find Full Text": resolves an open-access PDF and attaches it, false if none
    addAvailableFile: (item: ZoteroItem, options?: { methods?: string[] }) => Promise<ZoteroItem | false>
    shouldAutoRenameFile?: (isLink: boolean, libraryID?: string) => boolean
    getRenamedFileBaseNameIfAllowedType?: (parentItem: ZoteroItem, file: string) => Promise<string | false>
  }

  File: {
    pathToFile: (path: string) => any
  }

  Libraries: {
    isEditable: (libraryId: string) => boolean
  }

  ProgressWindow: {
    new(): ProgressWindow
  }

  PreferencePanes: {
    register: (options: {
      pluginID: string,
      src: string,
      scripts?: string[],
      label?: string,
      image?: string,
    }) => void
  }
}

export { ZoteroItem, ZoteroObserver, IZotero, IZoteroPane, ProgressWindow, ZoteroCollection }