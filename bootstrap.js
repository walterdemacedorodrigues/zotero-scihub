/* eslint-disable no-unused-vars */
/* global Zotero, Services */

var PLUGIN_ID = "zotero-scihub@ethanwillis.github.io";
var pluginRootURI = null;
// Zotero 8+ MenuManager registration IDs (cleaned up on shutdown)
var registeredMenuIDs = [];
// Legacy (Zotero 7) per-window XUL elements we injected
var addedElementIDs = [];
// True when running on Zotero 8+ where MenuManager is available
var useMenuManager = false;

function log(msg) {
  Zotero.debug("Sci-Hub Plugin: " + msg);
}

function install(data) {
  log("Installed version " + (data && data.version));
}

async function startup({ id, version, rootURI }) {
  log("Starting version " + version);

  pluginRootURI = rootURI;

  // Register preferences pane
  Zotero.PreferencePanes.register({
    pluginID: PLUGIN_ID,
    src: rootURI + "content/preferences.xhtml",
    scripts: [rootURI + "content/preferences.js"],
    label: "Zotero Scihub",
    image: rootURI + "skin/default/sci-hub-logo.svg",
  });

  // Load main plugin script
  Services.scriptloader.loadSubScript(rootURI + "content/scihub.js");

  // Initialize the plugin
  Zotero.Scihub.load();

  // Let the plugin locate its bundled windows (e.g. the download dialog)
  Zotero.Scihub.rootURI = rootURI;

  // Zotero 8+ provides the MenuManager API. Use it when available; otherwise
  // fall back to manual XUL menu injection (Zotero 7).
  useMenuManager =
    typeof Zotero.MenuManager !== "undefined" &&
    typeof Zotero.MenuManager.registerMenu === "function";

  if (useMenuManager) {
    registerMenus(rootURI);
  } else {
    // Add menu items to all already-open windows (Zotero 7)
    addToAllWindows();
  }
}

function onMainWindowLoad({ window }) {
  // MenuManager handles every main window automatically; only the legacy
  // path needs to inject into each newly-opened window.
  if (!useMenuManager) {
    addMenuItems(window);
  }
}

function onMainWindowUnload({ window }) {
  if (!useMenuManager) {
    removeMenuItems(window);
  }
}

function shutdown() {
  log("Shutting down");

  if (useMenuManager) {
    for (var menuID of registeredMenuIDs) {
      try {
        Zotero.MenuManager.unregisterMenu(menuID);
      } catch (err) {
        log("Error unregistering menu: " + err);
      }
    }
    registeredMenuIDs = [];
  } else {
    removeFromAllWindows();
  }

  if (Zotero.Scihub) {
    Zotero.Scihub.unload();
  }

  pluginRootURI = null;
}

function uninstall() {
  log("Uninstalled");
}

// --- Zotero 8+ menu registration via MenuManager ---

function registerMenus(rootURI) {
  var iconURI = rootURI + "skin/default/sci-hub-logo.svg";

  // "Download Sci-Hub PDF" on the item context menu
  registeredMenuIDs.push(
    Zotero.MenuManager.registerMenu({
      menuID: "zotero-scihub-itemmenu",
      pluginID: PLUGIN_ID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "zotero-scihub-itemmenu-update",
          icon: iconURI,
          onCommand: function () {
            Zotero.Scihub.openSelectedItemsDownload().catch(function (err) {
              log("Error downloading selected items: " + err);
            });
          },
        },
      ],
    })
  );

  // "Download Collection PDFs…" on the collection context menu
  registeredMenuIDs.push(
    Zotero.MenuManager.registerMenu({
      menuID: "zotero-scihub-collectionmenu",
      pluginID: PLUGIN_ID,
      target: "main/library/collection",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "zotero-scihub-collectionmenu-update",
          icon: iconURI,
          onCommand: function () {
            Zotero.Scihub.openCollectionDownload().catch(function (err) {
              log("Error downloading collection: " + err);
            });
          },
        },
      ],
    })
  );

  // "Download Sci-Hub PDFs…" on the Tools menu (acts on the selected collection)
  registeredMenuIDs.push(
    Zotero.MenuManager.registerMenu({
      menuID: "zotero-scihub-toolsmenu",
      pluginID: PLUGIN_ID,
      target: "main/menubar/tools",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "zotero-scihub-toolsmenu-updateall",
          icon: iconURI,
          onCommand: function () {
            Zotero.Scihub.openCollectionDownload().catch(function (err) {
              log("Error downloading collection: " + err);
            });
          },
        },
      ],
    })
  );
}

// --- Legacy (Zotero 7) manual XUL menu injection ---

function addToAllWindows() {
  var windows = Zotero.getMainWindows();
  for (var win of windows) {
    if (!win.ZoteroPane) continue;
    addMenuItems(win);
  }
}

function removeFromAllWindows() {
  var windows = Zotero.getMainWindows();
  for (var win of windows) {
    if (!win.ZoteroPane) continue;
    removeMenuItems(win);
  }
}

function addMenuItems(window) {
  var doc = window.document;
  var iconURI = pluginRootURI + "skin/default/sci-hub-logo.svg";

  // Add "Update Scihub PDF" to item context menu
  var itemMenuPopup = doc.getElementById("zotero-itemmenu");
  if (itemMenuPopup) {
    var itemMenuSep = doc.createXULElement("menuseparator");
    itemMenuSep.id = "zotero-scihub-itemmenu-separator";
    itemMenuPopup.appendChild(itemMenuSep);
    addedElementIDs.push(itemMenuSep.id);

    var itemMenu = doc.createXULElement("menuitem");
    itemMenu.id = "zotero-itemmenu-scihub";
    itemMenu.classList.add("menuitem-iconic");
    itemMenu.setAttribute("image", iconURI);
    itemMenu.setAttribute("label", "Download Sci-Hub PDF");
    itemMenu.addEventListener("command", function () {
      Zotero.Scihub.openSelectedItemsDownload().catch(function (err) {
        log("Error downloading selected items: " + err);
      });
    });
    itemMenuPopup.appendChild(itemMenu);
    addedElementIDs.push(itemMenu.id);
  } else {
    log("Warning: zotero-itemmenu element not found");
  }

  // Add "Update Collection Scihub PDFs" to collection context menu
  var collMenuPopup = doc.getElementById("zotero-collectionmenu");
  if (collMenuPopup) {
    var collMenuSep = doc.createXULElement("menuseparator");
    collMenuSep.id = "zotero-scihub-collectionmenu-separator";
    collMenuPopup.appendChild(collMenuSep);
    addedElementIDs.push(collMenuSep.id);

    var collMenu = doc.createXULElement("menuitem");
    collMenu.id = "zotero-collectionmenu-scihub";
    collMenu.classList.add("menuitem-iconic");
    collMenu.setAttribute("image", iconURI);
    collMenu.setAttribute("label", "Download Collection PDFs…");
    collMenu.addEventListener("command", function () {
      Zotero.Scihub.openCollectionDownload().catch(function (err) {
        log("Error downloading collection: " + err);
      });
    });
    collMenuPopup.appendChild(collMenu);
    addedElementIDs.push(collMenu.id);
  } else {
    log("Warning: zotero-collectionmenu element not found");
  }

  // Add "Download Sci-Hub PDFs…" to Tools menu (acts on the selected collection)
  var toolsMenuPopup = doc.getElementById("menu_ToolsPopup");
  if (toolsMenuPopup) {
    var toolsMenuSep = doc.createXULElement("menuseparator");
    toolsMenuSep.id = "zotero-scihub-tools-separator";
    toolsMenuPopup.appendChild(toolsMenuSep);
    addedElementIDs.push(toolsMenuSep.id);

    var toolsMenu = doc.createXULElement("menuitem");
    toolsMenu.id = "zotero-scihub-tools-download";
    toolsMenu.classList.add("menuitem-iconic");
    toolsMenu.setAttribute("image", iconURI);
    toolsMenu.setAttribute("label", "Download Sci-Hub PDFs…");
    toolsMenu.addEventListener("command", function () {
      Zotero.Scihub.openCollectionDownload().catch(function (err) {
        log("Error downloading collection: " + err);
      });
    });
    toolsMenuPopup.appendChild(toolsMenu);
    addedElementIDs.push(toolsMenu.id);
  } else {
    log("Warning: menu_ToolsPopup element not found");
  }
}

function removeMenuItems(window) {
  var doc = window.document;
  for (var id of addedElementIDs) {
    var elem = doc.getElementById(id);
    if (elem) {
      elem.remove();
    }
  }
  addedElementIDs = [];
}
