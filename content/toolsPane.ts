import type { ZoteroItem, IZotero } from '../typings/zotero'
import { ZoteroUtil } from './zoteroUtil'

declare const Zotero: IZotero

class ToolsPane {
  public async updateAll(): Promise<void> {
    try {
      Zotero.debug('scihub: updating all items')

      const ZoteroPane = Zotero.getActiveZoteroPane()
      const libraryId = ZoteroPane.getSelectedLibraryID()
      const allItems = await Zotero.Items.getAll(libraryId)
      const items = allItems.filter(item => {
        const isProcessable = item.isRegularItem()
        const isEditable: boolean = Zotero.Libraries.isEditable(item.libraryID)

        return isProcessable && isEditable
      }) as [ZoteroItem]

      await Zotero.Scihub.updateItems(items)
    } catch (error) {
      Zotero.debug(`scihub: error updating all items: ${error}`)
      ZoteroUtil.showPopup('Update Failed', `An error occurred: ${error}`, true)
    }
  }
}

export { ToolsPane }
