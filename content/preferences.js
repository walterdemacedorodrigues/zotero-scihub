/* eslint-disable no-undef */
/* global Zotero, document */

// Initialize preferences UI from stored values
// Note: defaults here must match those in prefs.js to handle first-run initialization
// The preference attribute on the HTML elements handles auto-binding in Zotero 7,
// but this script provides a fallback for manual initialization.
function initScihubPreferences() {
  var DEFAULT_SCIHUB_URL = "https://sci-hub.al/";
  var DEFAULT_SCINET_URL = "https://sci-net.xyz/";
  var DEFAULT_AUTOMATIC_PDF_DOWNLOAD = true;

  try {
    var automaticPdfDownloadCheckbox = document.getElementById(
      "id-zoteroscihub-automatic-pdf-download"
    );
    var currentAutoDownload = Zotero.Prefs.get(
      "zoteroscihub.automatic_pdf_download"
    );
    if (currentAutoDownload === undefined) {
      Zotero.Prefs.set(
        "zoteroscihub.automatic_pdf_download",
        DEFAULT_AUTOMATIC_PDF_DOWNLOAD
      );
      currentAutoDownload = DEFAULT_AUTOMATIC_PDF_DOWNLOAD;
    }
    if (automaticPdfDownloadCheckbox) {
      automaticPdfDownloadCheckbox.checked = currentAutoDownload;
      automaticPdfDownloadCheckbox.addEventListener("change", function () {
        Zotero.Prefs.set(
          "zoteroscihub.automatic_pdf_download",
          this.checked
        );
      });
    }

    var sciHubUrlInput = document.getElementById("id-zoteroscihub-scihub-url");
    var currentUrl = Zotero.Prefs.get("zoteroscihub.scihub_url");
    if (currentUrl === undefined) {
      Zotero.Prefs.set("zoteroscihub.scihub_url", DEFAULT_SCIHUB_URL);
      currentUrl = DEFAULT_SCIHUB_URL;
    }
    if (sciHubUrlInput) {
      sciHubUrlInput.value = currentUrl;
      sciHubUrlInput.addEventListener("input", function () {
        Zotero.Prefs.set("zoteroscihub.scihub_url", this.value);
      });
    }

    var sciNetUrlInput = document.getElementById("id-zoteroscihub-scinet-url");
    var currentScinetUrl = Zotero.Prefs.get("zoteroscihub.scinet_url");
    if (currentScinetUrl === undefined) {
      Zotero.Prefs.set("zoteroscihub.scinet_url", DEFAULT_SCINET_URL);
      currentScinetUrl = DEFAULT_SCINET_URL;
    }
    if (sciNetUrlInput) {
      sciNetUrlInput.value = currentScinetUrl;
      sciNetUrlInput.addEventListener("input", function () {
        Zotero.Prefs.set("zoteroscihub.scinet_url", this.value);
      });
    }
  } catch (e) {
    Zotero.debug("Sci-Hub Plugin: Error initializing preferences: " + e);
  }
}

// Renders the per-collection folder mappings with edit/remove controls.
function renderCollectionFolders() {
  try {
    var body = document.getElementById("scihub-folders-body");
    var empty = document.getElementById("scihub-folders-empty");
    if (!body || !Zotero.Scihub) return;

    var folders = Zotero.Scihub.getCollectionFolders();
    var keys = Object.keys(folders);

    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }
    empty.style.display = keys.length === 0 ? "" : "none";

    keys.forEach(function (key) {
      var entry = folders[key];

      var tr = document.createElement("tr");

      var tdName = document.createElement("td");
      tdName.textContent = entry.name || key;

      var tdPath = document.createElement("td");
      tdPath.className = "path";
      tdPath.textContent = entry.path;

      var tdActions = document.createElement("td");
      tdActions.style.whiteSpace = "nowrap";

      var changeBtn = document.createElement("button");
      changeBtn.textContent = "Change…";
      changeBtn.addEventListener("click", function () {
        Zotero.Scihub.pickFolder(window).then(function (path) {
          if (path) {
            Zotero.Scihub.setCollectionFolder(key, entry.name, path);
            renderCollectionFolders();
          }
        });
      });

      var removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", function () {
        Zotero.Scihub.removeCollectionFolder(key);
        renderCollectionFolders();
      });

      tdActions.appendChild(changeBtn);
      tdActions.appendChild(removeBtn);

      tr.appendChild(tdName);
      tr.appendChild(tdPath);
      tr.appendChild(tdActions);
      body.appendChild(tr);
    });
  } catch (e) {
    Zotero.debug("Sci-Hub Plugin: Error rendering collection folders: " + e);
  }
}

initScihubPreferences();
renderCollectionFolders();
