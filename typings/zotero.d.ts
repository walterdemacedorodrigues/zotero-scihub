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
  isCollection?: () => boolean
  getCollections?: () => number[]
  getAttachments?: () => number[]
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
    }) => Promise<XMLHttpRequest>
  }

  Attachments: {
    importFromURL: (options: Record<string, any>) => Promise<ZoteroItem>
    importFromFile: (options: Record<string, any>) => Promise<ZoteroItem>
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