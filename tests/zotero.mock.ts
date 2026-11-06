import { IZotero, ZoteroItem, ZoteroObserver, ProgressWindow, ZoteroCollection } from '../typings/zotero'
import { regularItem1, regularItem2, attachmentsById } from './zoteroItem.mock'
import { spy } from 'sinon'

const progressWindowSpy = spy()

const Zotero: IZotero = new class {
  public Scihub

  public debug(_msg: string) { return }
  public logError(_err: Error | string) { return }
  public launchURL(_url: string) { return }
  public getActiveZoteroPane() {
    return {
      canEdit: () => true,
      displayCannotEditLibraryMessage: () => undefined,
      getSelectedCollection: () => null,
      getSelectedItems: () => [regularItem1] as [ZoteroItem],
      getSelectedLibraryID: () => 1,
    }
  }
  public getMainWindows() { return [] }
  public getMainWindow() { return undefined }

  public Notifier: IZotero['Notifier'] = new class {
    public registerObserver(_observer: ZoteroObserver, _types: string[], _id: string, _priority?: number) {
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      return 42
    }
    public unregisterObserver(_id: number) { return }
  }

  public Prefs = new class {
    private prefs: Record<string, string | number | boolean> = {}

    public get(pref: string): string | number | boolean {
      return this.prefs[pref]
    }

    public set(pref: string, value: string | number | boolean) {
      this.prefs[pref] = value
    }
  }

  Items = new class {
    public async getAsync(ids: number | number[]): Promise<any | any[]> {
      if (Array.isArray(ids)) {
        return Promise.resolve([regularItem1, regularItem2])
      } else {
        return Promise.resolve(attachmentsById[ids] ?? regularItem1)
      }
    }

    public async getAll(_libraryID: number): Promise<ZoteroItem[]> {
      return Promise.resolve([regularItem1, regularItem2])
    }
  }

  public Collections = new class {
    public get(_id: number): ZoteroCollection | false { return false }
  }

  public HTTP = new class {
    public async request(method: string, url: string, options?: {
      body?: string
      responseType?: XMLHttpRequestResponseType
      headers?: Record<string, string>
      noCache?: boolean
      successCodes?: number[] | false
    }): Promise<XMLHttpRequest> {
      const xhr = new XMLHttpRequest()
      xhr.open(method, url, false)
      if (options?.responseType) {
        xhr.responseType = options.responseType
      }
      xhr.send()
      return Promise.resolve(xhr)
    }
  }

  public Attachments = new class {
    public async importFromURL(_options: Record<string, any>): Promise<ZoteroItem> {
      return Promise.resolve(regularItem1)
    }
    public async importFromFile(_options: Record<string, any>): Promise<ZoteroItem> {
      return Promise.resolve(regularItem1)
    }
    public async addAvailableFile(_item: ZoteroItem, _options?: { methods?: string[] }): Promise<ZoteroItem | false> {
      return Promise.resolve(false)
    }
  }

  public File = new class {
    public pathToFile(path: string) { return path }
  }

  public Libraries = new class {
    public isEditable(_libraryId: string): boolean { return true }
  }

  public ProgressWindow = class implements ProgressWindow {
    public changeHeadline(headline: string, _icon?: string, _postText?: string) {
      progressWindowSpy(headline)
    }
    public addDescription(_body: string) { return }
    public startCloseTimer(_millis: number) { return }
    public show() { return }
  }

  public PreferencePanes = new class {
    public register(_options: any) { return }
  }
}

export { Zotero, progressWindowSpy }
