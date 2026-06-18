# Note/News:
I've been away from any open source work for a while. I also have had issues with my Github account for a while. However!, I know a lot of people like this plugin and have posted a lot of ideas/errors in the issues. 

# Zotero Scihub

This is an add-on for [Zotero](https://www.zotero.org/) and [Juris-M](https://juris-m.github.io/) that enables automatic download of PDFs for items with a DOI.

Compatible with **Zotero 7, 8 and 9**. On Zotero 8+ the menu items are registered through the new `Zotero.MenuManager` API; on Zotero 7 the add-on falls back to manual menu injection.

# Quick Start Guide

#### Install

- Download the latest release (.xpi file) from the [Releases Page](https://github.com/ethanwillis/zotero-scihub/releases)
  _Note_ If you're using Firefox as your browser, right click the xpi and select "Save As.."
- In Zotero click "Tools" in the top menu bar and then click "Addons"
- Go to the Extensions page and then click the gear icon in the top right.
- Select Install Add-on from file.
- Browse to where you downloaded the .xpi file and select it.
- Restart Zotero, by clicking "restart now" in the extensions list where the
  scihub plugin is now listed.

#### Usage

The plugin works per **collection**, and each collection downloads into its own folder:

- When you **add an article to a collection** (any collection except one named
  `Inbox`), a **download-manager window** opens.
  - If the collection doesn't have a folder yet, you're asked to pick one for it
    (remembered for next time); if it does, that folder is used.
  - The window lists the articles and, on **Start download**, fetches each PDF
    sequentially, showing live per-item status — no per-file save prompts.
- Each PDF is saved into the collection's folder **and** attached to the matching
  Zotero item.
- Items that are not in any collection, or only in `Inbox`, are ignored.
- You can also open the manager manually by right-clicking a collection ("Download
  Collection PDFs…"), via Tools ("Download Sci-Hub PDFs…", uses the selected
  collection), or on selected items ("Download Sci-Hub PDF").
- If a PDF can't be found (or a captcha is required), that item's row shows the
  problem ("✕ No PDF found" / "⚠ Captcha required") and the rest continue.

The collection → folder mappings can be viewed, changed, or removed in the plugin
settings (Settings → Zotero Scihub).

#### Configuration

Plugin is configured through the dedicated tab: 

<img width="782" alt="Screenshot 2021-08-21 at 22 14 04" src="https://user-images.githubusercontent.com/387791/130333778-8bfb0878-2122-49a9-bc23-c528eb9b6cbf.png">

#### DNS-over-HTTPS

In case of malfunctioning or unsafe local DNS server, Zotero (as it's built on Firefox) might be configured with [Trusted Recursive Resolver](https://wiki.mozilla.org/Trusted_Recursive_Resolver) or DNS-over-HTTPS, where you could set your own DNS server just for Zotero without modifying network settings.

_Preferences > Advanced > Config Editor_

1. set `network.trr.mode` to `2` or `3`, this enables DNS-over-HTTPS (2 enables it with fallback)
2. set `network.trr.uri` to `https://cloudflare-dns.com/dns-query`, this is the provider’s URL
3. set `network.trr.bootstrapAddress` to `1.1.1.1`, this is cloudflare’s normal DNS server (only) used to retrieve the IP of cloudfaire-dns.com
4. Restart zotero, wait for a DNS cache to clean up.

## Building

0. Pre-requisite is to have [node.js](nodejs.org) installed
1. Install dependencies `npm install`
2. Build `npm run build`

## [Contributing](./CONTRIBUTING.md)

## Disclaimer

Use this code at your own peril. No warranties are provided. Keep the laws of your locality in mind!
