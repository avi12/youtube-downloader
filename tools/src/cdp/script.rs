//! The JavaScript the commands evaluate inside the page or the service worker. It runs in the
//! browser, so it stays JavaScript.

/// Buttons that look like the extension's download button, each with its ancestor chain.
pub(super) const BUTTON_CHAINS: &str = r"
(() => {
  const out = [];
  for (const btn of document.querySelectorAll('button')) {
    const aria = btn.getAttribute('aria-label') || '';
    const text = (btn.textContent || '').trim().slice(0, 60);
    if (!/download|stop|retry|failed/i.test(aria + ' ' + text)) continue;
    const chain = [];
    let cur = btn;
    for (let i = 0; i < 8 && cur; i++) {
      const id = cur.id ? '#' + cur.id : '';
      const cls = cur.className && typeof cur.className === 'string' ? '.' + cur.className.split(/\s+/).slice(0,3).join('.') : '';
      chain.push(cur.tagName?.toLowerCase() + id + cls);
      cur = cur.parentElement;
    }
    out.push({ aria, text, chain: chain.join(' > ') });
  }
  return out;
})()
";

/// The same buttons without their chains.
pub(super) const BUTTON_LABELS: &str = r#"
(() => {
  return [...document.querySelectorAll('button')]
    .map(el => ({ aria: el.getAttribute('aria-label'), text: el.textContent?.trim()?.slice(0,40), id: el.id }))
    .filter(b => /download|stop|retry|failed/i.test((b.aria ?? "") + " " + (b.text ?? "")));
})()
"#;

/// The snackbar elements of the watch page.
pub(super) const SNACKBARS: &str = r"
(() => {
  const host = document.querySelector('ytd-watch-flexy') ?? document.body;
  const snacks = [...host.querySelectorAll('*')].filter(el => el.tagName?.toLowerCase().includes('snack'));
  return snacks.map(s => ({ tag: s.tagName, text: s.textContent?.slice(0, 200) }));
})()
";

/// The items of the `chrome://downloads` manager, in full.
pub(super) const DOWNLOAD_ITEMS_FULL: &str = r"
(async () => {
  const mgr = document.querySelector('downloads-manager');
  if (!mgr) return { hasMgr: false };
  const list = mgr.shadowRoot?.querySelector('iron-list');
  const items = list?.items ?? [];
  const all = items.slice(0, 15).map(it => ({
    id: it.id, state: it.state, danger_type: it.danger_type, percent: it.percent,
    file_name: it.file_name, file_path: it.file_path, file_url: it.file_url,
    last_reason_text: it.last_reason_text, received_bytes: it.received_bytes,
    total_bytes: it.total_bytes, since_string: it.since_string,
    date_string: it.date_string, referrer_url: it.referrer_url
  }));
  return { hasMgr: true, totalSize: items.length, items: all };
})()
";

/// The first items of the `chrome://downloads` manager, short.
pub(super) const DOWNLOAD_ITEMS_SHORT: &str = r"
(async () => {
  const mgr = document.querySelector('downloads-manager');
  const list = mgr?.shadowRoot?.querySelector('iron-list');
  const items = list?.items ?? [];
  return items.slice(0, 10).map(it => ({
    id: it.id, state: it.state, danger_type: it.danger_type, percent: it.percent,
    file_name: it.file_name, last_reason_text: it.last_reason_text,
    received_bytes: it.received_bytes, total_bytes: it.total_bytes,
    since_string: it.since_string, date_string: it.date_string
  }));
})()
";

/// The latest downloads, as `chrome.downloads` reports them (service worker).
pub(super) const DOWNLOADS_API: &str = r"
new Promise(res => {
  chrome.downloads.search({ limit: 10, orderBy: ['-startTime'] }, items => {
    res(items.map(it => ({
      id: it.id, filename: it.filename, state: it.state, danger: it.danger, paused: it.paused,
      startTime: it.startTime, endTime: it.endTime, url: it.url, referrer: it.referrer,
      bytesReceived: it.bytesReceived, totalBytes: it.totalBytes, fileSize: it.fileSize,
      exists: it.exists
    })));
  });
})
";

/// Every installed extension (service worker, which has `chrome.management`).
pub(super) const EXTENSIONS: &str = r"
new Promise(res => {
  chrome.management.getAll(exts => {
    res(exts.map(e => ({
      id: e.id, name: e.name, version: e.version, enabled: e.enabled,
      installType: e.installType, shortName: e.shortName
    })));
  });
})
";

/// The player's playability and the video element's state.
pub(super) const PLAYABILITY: &str = r"
({
  playabilityStatus: window.ytInitialPlayerResponse?.playabilityStatus,
  videoDetails: { videoId: window.ytInitialPlayerResponse?.videoDetails?.videoId, lengthSeconds: window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds, title: window.ytInitialPlayerResponse?.videoDetails?.title },
  ytpError: document.querySelector('.ytp-error')?.textContent?.slice(0, 200),
  moviePlayer: !!document.querySelector('#movie_player'),
  videoEl: { exists: !!document.querySelector('video'), duration: document.querySelector('video')?.duration, readyState: document.querySelector('video')?.readyState, error: document.querySelector('video')?.error?.message }
})
";

/// Whether the download button got its click handler.
pub(super) const CLICK_BOUND: &str = r"
(() => {
  const dl = document.querySelector('.ytdl-download-button');
  if (!dl) return { dl: null };
  const wrapper = dl.matches('button-view-model') ? dl : dl.closest('button-view-model') ?? dl;
  const inner = dl.querySelector('button');
  return {
    dlTag: dl.tagName,
    dlClasses: dl.className,
    dlAttrs: dl.getAttributeNames(),
    wrapperTag: wrapper.tagName,
    wrapperAttrs: wrapper.getAttributeNames(),
    wrapperIsBound: wrapper.hasAttribute('data-ytdl-click-bound'),
    innerTag: inner?.tagName,
    innerText: inner?.textContent?.trim().slice(0, 60),
    innerAriaLabel: inner?.getAttribute('aria-label')
  };
})()
";

/// The extension's footprint on the watch page.
pub(super) const PAGE_HEALTH: &str = r#"
({
  ytdlAnchor: !!document.querySelector('.ytdl-download-button, .ytdl-chevron-button, [class*="ytdl-"]'),
  ytdlClasses: [...new Set([...document.querySelectorAll('[class*="ytdl-"]')].map(e => [...e.classList].filter(c => c.startsWith('ytdl-'))).flat())],
  actionsInnerHTML: document.querySelector('div#actions-inner')?.innerHTML?.slice(0, 500),
  readyState: document.readyState,
  url: location.href,
  videoLoaded: !!document.querySelector('video')?.duration
})
"#;

/// The errors the extension recorded on the page.
pub(super) const PAGE_ERRORS: &str = r"
(async () => {
  const errs = [];
  if (window.__ytdlErrors) errs.push(...window.__ytdlErrors);
  return errs;
})()
";

/// Proof the service worker is alive, with its manifest identity.
pub(super) const WORKER_HEALTH: &str = r"
({
  alive: true,
  extId: chrome.runtime.id,
  manifest: { version: chrome.runtime.getManifest().version, name: chrome.runtime.getManifest().name }
})
";

/// Clicks the extension's plain "Download" button.
pub(super) const CLICK_DOWNLOAD: &str = r"
(() => {
  const candidates = [...document.querySelectorAll('button')]
    .filter(el => /^(Download|Stop download|Retry|Failed)/.test(el.getAttribute('aria-label') || el.textContent || ''));
  const el = candidates.find(b => /^Download$/.test((b.getAttribute('aria-label') || '').trim()));
  if (!el) return { ok: false, found: candidates.map(b => b.getAttribute('aria-label') || b.textContent?.trim()) };
  el.click();
  return { ok: true };
})()
";

/// Reloads the extension through its details page (`chrome://extensions`).
pub(super) fn reload_extension(extension_id: &str) -> String {
    format!(
        r#"new Promise(r => chrome.developerPrivate.reload("{extension_id}", {{ failQuietly: false, populateErrorForUnpacked: false }}, () => r()))"#
    )
}

/// Reloads the extension from its own service worker (leaves the manifest stale).
pub(super) const RUNTIME_RELOAD: &str = "chrome.runtime.reload()";

/// A trivial expression that proves the target answers.
pub(super) const PING: &str = "1+1";
