const { app, BrowserWindow, BrowserView, ipcMain, Menu, session, screen, net, shell, dialog, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const SIDEBAR_WIDTH = 200;
const EDGE_TRIGGER = 3;
const TOOLBAR_HEIGHT = 48;
const DOWNLOADS_POP_WIDTH = 340;
const DOWNLOADS_POP_HEIGHT = 320;
const HISTORY_POP_WIDTH = 380;
const HISTORY_POP_HEIGHT = 420;
const HISTORY_MAX_ENTRIES = 5000;
const BOOKMARK_PICKER_WIDTH = 280;
const BOOKMARK_PICKER_HEIGHT = 360;
const DEFAULT_BOOKMARK_FOLDER = { id: 1, name: 'General' };
const FIND_BAR_WIDTH = 320;
const FIND_BAR_HEIGHT = 44;
const AUTOCOMPLETE_MIN_WIDTH = 320;
const AUTOCOMPLETE_MAX_RESULTS = 8;
const SPLIT_DIVIDER_WIDTH = 8;
const SPLIT_MIN_RATIO = 0.2;
const SPLIT_MAX_RATIO = 0.8;
const DOWNLOAD_TOAST_WIDTH = 280;
const DOWNLOAD_TOAST_HEIGHT = 60;
const DOWNLOAD_TOAST_MARGIN = 12;
const DOWNLOAD_TOAST_TIMEOUT_MS = 3000;
const LYMOCHAT_HEADER_HEIGHT = 32;
const LYMOCHAT_PATH = path.join(__dirname, 'LymoChat.html');
const LYMOCHAT_MIN_WIDTH = 280;
const LYMOCHAT_MAX_WIDTH_RATIO = 0.7;
// Must match #lymochat-resize-handle's width in overlay.html: the chat
// BrowserView is inset by this much so it never covers the resize handle
// (which lives in the overlay view, a separate native layer stacked
// beneath the chat content and would otherwise never receive the drag).
const LYMOCHAT_HANDLE_WIDTH = 4;
const DEFAULT_ZOOM = 100;
const ZOOM_LEVELS = [50, 75, 80, 90, 100, 110, 125, 150];
const DEFAULT_ACCENT_COLOR = '#32CD32';
const ACCENT_COLORS = ['#32CD32', '#00BCD4', '#9C27B0', '#FF5722', '#E91E63', '#F44336', '#FFFFFF'];
const SESSION_PARTITION = 'persist:lymo-browser';
const DEFAULT_SHORTCUTS = [
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'Reddit', url: 'https://www.reddit.com' },
  { name: 'GitHub', url: 'https://www.github.com' },
  { name: 'Kick', url: 'https://kick.com' }
];

let mainWindow;
let mainWindowReady = false;
let splashWindow = null;
let splashDone = false;
let downloadToastView = null;
let downloadToastTimer = null;
let overlayView = null;
let overlayMode = null; // 'sidebar' | 'downloads' | 'history' | 'lymochat' | 'bookmark-picker' | 'find' | 'autocomplete' | null
let pendingAutocompleteRect = null; // { x, y, width }, address bar's on-screen rect while the dropdown is open
let lymochatWindow = null;
let lymochatPanelWidth = null; // legacy setting, kept so settings.json stays compatible
const tabs = new Map();
let tabOrder = []; // authoritative sidebar display order (pinned tabs always first)
let activeTabId = null;
let nextTabId = 1;
let pinnedTabs = []; // [{ url, title }], persisted so pinned tabs reopen next session
let currentZoom = DEFAULT_ZOOM;
let chromeColorTimer = null;
let lastChromeColor = null; // { hex, dark } - last ambient color sampled, reapplied to LymoChat on (re)open
let htmlFullScreen = false; // whether in-page (video) fullscreen is active
let wasFullScreenBeforeHtml = false;
const downloads = new Map();
let nextDownloadId = 1;
let darkTheme = true;
let accentColor = DEFAULT_ACCENT_COLOR;
let uiStyle = 1; // 1 = classic (sharp), 2 = rounded/filled
let notifSound = true;
let settingsTabId = null;
let shortcuts = []; // [{ id, name, url }], newtab.html quick-links
let nextShortcutId = 1;
let bookmarkFolders = []; // [{ id, name }]
let bookmarks = []; // [{ id, name, url, folderId }]
let nextBookmarkId = 1;
let nextFolderId = 1;
let downloadDir = null; // null = system Downloads folder
let history = []; // newest first
let lastHistoryId = null; // used to update the latest entry once the page title arrives late
let splitState = null; // { leftId, rightId, ratio } while split view is active, else null
let splitDividerView = null;
let splitResizing = false;

// Strips YouTube's ad data out of the player response before playback starts,
// and as a fallback for ads that still slip through (e.g. mid-roll), fast
// forwards the player past them by jumping to the end of the ad segment.
const YOUTUBE_ADBLOCK_SCRIPT = `
(function() {
  if (window.__lymoYtAdblockInstalled) return;
  window.__lymoYtAdblockInstalled = true;

  function stripAdData(response) {
    if (!response || typeof response !== 'object') return;
    delete response.adPlacements;
    delete response.playerAds;
    delete response.adSlots;
  }

  stripAdData(window.ytInitialPlayerResponse);

  // ytInitialPlayerResponse is set fresh on every SPA navigation (YouTube is
  // a single-page app), so re-strip it whenever it's (re)assigned.
  try {
    let current = window.ytInitialPlayerResponse;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return current; },
      set(value) {
        stripAdData(value);
        current = value;
      }
    });
  } catch (e) {}

  // Belt-and-suspenders: skip any ad that still manages to start playing by
  // jumping the player straight to the end of it, as soon as the player
  // marks itself as showing one.
  function skipAdIfShowing() {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video');
    if (player && video && player.classList.contains('ad-showing') && isFinite(video.duration)) {
      video.currentTime = video.duration;
    }
  }

  const adObserver = new MutationObserver(skipAdIfShowing);
  function observePlayer() {
    const player = document.querySelector('.html5-video-player');
    if (player) {
      adObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
      skipAdIfShowing();
    } else {
      setTimeout(observePlayer, 500);
    }
  }
  observePlayer();
})();
`;

// Chrome UI is split across two webContents (toolbar window + overlay view),
// plus the settings tab (its own preloaded webContents, when open); tab/zoom
// state events are broadcast to all of them.
function sendChrome(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  if (overlayView && !overlayView.webContents.isDestroyed()) overlayView.webContents.send(channel, data);
  const settingsTab = settingsTabId !== null ? tabs.get(settingsTabId) : null;
  if (settingsTab && !settingsTab.view.webContents.isDestroyed()) {
    settingsTab.view.webContents.send(channel, data);
  }
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Assigns sequential ids to the built-in defaults, or normalizes/keeps
// existing ids from settings.json (filtering out malformed entries).
function normalizeShortcuts(raw) {
  if (!Array.isArray(raw)) {
    return DEFAULT_SHORTCUTS.map((s, i) => ({ id: i + 1, name: s.name, url: s.url }));
  }
  return raw
    .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
    .map((s, i) => ({ id: typeof s.id === 'number' ? s.id : i + 1, name: s.name, url: s.url }));
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : DEFAULT_ZOOM,
      downloadDir: typeof parsed.downloadDir === 'string' ? parsed.downloadDir : null,
      lymochatPanelWidth: typeof parsed.lymochatPanelWidth === 'number' ? parsed.lymochatPanelWidth : null,
      darkTheme: typeof parsed.darkTheme === 'boolean' ? parsed.darkTheme : true,
      accentColor: ACCENT_COLORS.includes(parsed.accentColor) ? parsed.accentColor : DEFAULT_ACCENT_COLOR,
      uiStyle: parsed.uiStyle === 2 ? 2 : 1,
      shortcuts: normalizeShortcuts(parsed.shortcuts),
      pinnedTabs: Array.isArray(parsed.pinnedTabs)
        ? parsed.pinnedTabs.filter((p) => p && typeof p.url === 'string')
        : [],
      notifSound: typeof parsed.notifSound === 'boolean' ? parsed.notifSound : true
    };
  } catch {
    return {
      zoom: DEFAULT_ZOOM, downloadDir: null, lymochatPanelWidth: null, darkTheme: true,
      accentColor: DEFAULT_ACCENT_COLOR, uiStyle: 1, shortcuts: normalizeShortcuts(null), pinnedTabs: [], notifSound: true
    };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ zoom: currentZoom, downloadDir, lymochatPanelWidth, darkTheme, accentColor, uiStyle, shortcuts, pinnedTabs, notifSound }));
  } catch {
    // keep the app running even if persistence fails
  }
}

function normalizeShortcutUrl(input) {
  const trimmed = String(input || '').trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Broadcasts the shortcut list to every surface: the toolbar/overlay/settings
// tab (via preload IPC) and any tab currently showing our own newtab.html
// (via injection, since tab views have no preload -- third-party pages ignore this).
function broadcastShortcuts() {
  sendChrome('shortcuts:changed', shortcuts);
  for (const tab of tabs.values()) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) {
      wc.executeJavaScript(`window.__lymoSetShortcuts && window.__lymoSetShortcuts(${JSON.stringify(shortcuts)})`).catch(() => {});
    }
  }
}

function getBookmarksPath() {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}

function loadBookmarksFile() {
  try {
    const raw = fs.readFileSync(getBookmarksPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const folders = Array.isArray(parsed.folders) && parsed.folders.length > 0
      ? parsed.folders.filter((f) => f && typeof f.id === 'number' && typeof f.name === 'string')
      : [DEFAULT_BOOKMARK_FOLDER];
    const validFolders = folders.length > 0 ? folders : [DEFAULT_BOOKMARK_FOLDER];
    const folderIds = new Set(validFolders.map((f) => f.id));
    const items = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks
          .filter((b) => b && typeof b.id === 'number' && typeof b.name === 'string' && typeof b.url === 'string')
          .map((b) => ({
            id: b.id,
            name: b.name,
            url: b.url,
            folderId: folderIds.has(b.folderId) ? b.folderId : validFolders[0].id
          }))
      : [];
    return { folders: validFolders, bookmarks: items };
  } catch {
    return { folders: [DEFAULT_BOOKMARK_FOLDER], bookmarks: [] };
  }
}

function saveBookmarksFile() {
  try {
    fs.writeFileSync(getBookmarksPath(), JSON.stringify({ folders: bookmarkFolders, bookmarks }));
  } catch {
    // keep the app running even if persistence fails
  }
}

// Broadcasts the full bookmark state to every surface: the toolbar/overlay/
// settings tab (via preload IPC) and any tab currently showing our own
// newtab.html (via injection, since tab views have no preload -- third-party
// pages ignore this).
function broadcastBookmarks() {
  const payload = { folders: bookmarkFolders, bookmarks };
  sendChrome('bookmarks:changed', payload);
  for (const tab of tabs.values()) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) {
      wc.executeJavaScript(`window.__lymoSetBookmarks && window.__lymoSetBookmarks(${JSON.stringify(payload)})`).catch(() => {});
    }
  }
}

function getHistoryPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadHistory() {
  try {
    const raw = fs.readFileSync(getHistoryPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(getHistoryPath(), JSON.stringify(history));
  } catch {
    // keep the app running even if persistence fails
  }
}

function isTrackableUrl(url) {
  if (!url) return false;
  if (url === 'about:blank' || url.endsWith('/newtab.html')) return false;
  return /^https?:\/\//.test(url);
}

let nextHistoryId = 1;

function addHistoryEntry(url, title) {
  if (!isTrackableUrl(url)) return;
  const entry = { id: nextHistoryId++, url, title: title || url, time: Date.now() };
  history.unshift(entry);
  if (history.length > HISTORY_MAX_ENTRIES) history.length = HISTORY_MAX_ENTRIES;
  lastHistoryId = entry.id;
  saveHistory();
  sendChrome('history:added', entry);
}

// Address-bar autocomplete: matches typed text against both URL and title,
// deduped by URL, most-recent-first (history is already newest-first).
function searchHistory(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const seen = new Set();
  const results = [];
  for (const h of history) {
    if (results.length >= AUTOCOMPLETE_MAX_RESULTS) break;
    if (seen.has(h.url)) continue;
    if (h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)) {
      seen.add(h.url);
      results.push({ url: h.url, title: h.title || h.url });
    }
  }
  return results;
}

function updateLastHistoryTitle(url, title) {
  if (lastHistoryId === null || !title) return;
  const entry = history.find((h) => h.id === lastHistoryId);
  if (entry && entry.url === url && entry.title !== title) {
    entry.title = title;
    saveHistory();
    sendChrome('history:updated', entry);
  }
}

function applyZoomToView(view) {
  view.webContents.setZoomFactor(currentZoom / 100);
}

function setZoomLevel(percent) {
  currentZoom = percent;
  for (const tab of tabs.values()) {
    applyZoomToView(tab.view);
  }
  saveSettings();
  sendChrome('zoom:changed', currentZoom);
}

function zoomStep(direction) {
  let index = ZOOM_LEVELS.indexOf(currentZoom);
  if (index === -1) {
    index = ZOOM_LEVELS.reduce((closest, level, i) =>
      Math.abs(level - currentZoom) < Math.abs(ZOOM_LEVELS[closest] - currentZoom) ? i : closest, 0);
  }
  const nextIndex = Math.min(Math.max(index + direction, 0), ZOOM_LEVELS.length - 1);
  setZoomLevel(ZOOM_LEVELS[nextIndex]);
}

function handleZoomShortcut(event, input) {
  if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
  if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd') {
    event.preventDefault();
    zoomStep(1);
  } else if (input.key === '-' || input.code === 'NumpadSubtract') {
    event.preventDefault();
    zoomStep(-1);
  } else if (input.key === '0') {
    event.preventDefault();
    setZoomLevel(DEFAULT_ZOOM);
  }
}

// Ambient mode, stage 1: the page's own reported background color.
// Uses body/html's computed background-color if opaque; if transparent,
// tries the first large header/nav element spanning the top of the page.
// Small elements (buttons, icons, logos) are filtered out by a size threshold.
const PAGE_COLOR_SCRIPT = `(() => {
  const parse = (c) => {
    const m = c && c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    if (p.length === 4 && p[3] < 0.5) return null; // transparent/semi-transparent doesn't count
    return [p[0], p[1], p[2]];
  };
  const fromEl = (el) => el ? parse(getComputedStyle(el).backgroundColor) : null;
  let c = fromEl(document.body) || fromEl(document.documentElement);
  if (!c) {
    const cands = document.querySelectorAll('header, nav, [role="banner"], body > div');
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      const isTopWide = r.top <= 10 && r.width >= innerWidth * 0.8 && r.height >= 40;
      if (!isTopWide) continue;
      c = fromEl(el);
      if (c) break;
    }
  }
  return c;
})()`;

// Stage 2 (fallback): average color from a screenshot of the page's top 5px
// strip -- whatever the DOM claims, this is the actual rendered color.
async function captureTopStripColor(view) {
  const bounds = view.getBounds();
  if (bounds.width < 1 || bounds.height < 1) return null;
  const img = await view.webContents.capturePage({
    x: 0,
    y: 0,
    width: bounds.width,
    height: Math.min(5, bounds.height)
  });
  const { width, height } = img.getSize();
  if (width < 1 || height < 1) return null;
  const buf = img.getBitmap(); // BGRA
  let r = 0, g = 0, b = 0;
  const pixels = width * height;
  for (let i = 0; i < buf.length; i += 4) {
    b += buf[i];
    g += buf[i + 1];
    r += buf[i + 2];
  }
  return [r / pixels, g / pixels, b / pixels];
}

async function sampleChromeColor() {
  const tab = activeTabId !== null ? tabs.get(activeTabId) : null;
  if (!tab) return;
  const forTabId = activeTabId;
  try {
    let rgb = null;
    try {
      rgb = await tab.view.webContents.executeJavaScript(PAGE_COLOR_SCRIPT, false);
    } catch {
      // fall back to image sampling if the page won't run scripts
    }
    if (!Array.isArray(rgb) || rgb.length !== 3) {
      rgb = await captureTopStripColor(tab.view);
    }
    if (!rgb || forTabId !== activeTabId) return; // active tab changed while sampling
    const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))));
    const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const dark = luminance < 0.5;
    lastChromeColor = { hex, dark };
    sendChrome('chrome:color', { bg: hex, dark });
    applyWindowChromeColor(hex, dark);
    applyLymoChatColor(hex, dark);
  } catch {
    // keep the current color if sampling fails
  }
}

// Recolors the native window chrome (background + Windows/Linux caption
// button overlay) to match the sampled ambient color. The default frame
// can't be recolored at all -- this only works because the window is
// created with titleBarStyle: 'hidden' + titleBarOverlay.
function applyWindowChromeColor(hex, dark) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(hex);
  try {
    mainWindow.setTitleBarOverlay({ color: hex, symbolColor: dark ? '#e0e0e0' : '#1a1a1a' });
  } catch {
    // titleBarOverlay is only supported on Windows/Linux; ignore elsewhere
  }
}

// Sample after a short delay, deduplicating consecutive events, so the paint has settled.
function scheduleChromeColor() {
  clearTimeout(chromeColorTimer);
  chromeColorTimer = setTimeout(sampleChromeColor, 300);
}

// Ctrl/Cmd+T/W/L/F, wired to both the toolbar and every tab's webContents
// (see createTab's and createWindow's 'before-input-event' listeners) so
// they work no matter which one currently has keyboard focus.
function handleAppShortcuts(event, input) {
  if (input.type !== 'keyDown' || !(input.control || input.meta)) return false;
  const key = input.key.toLowerCase();
  if (key === 'n' && input.shift) {
    event.preventDefault();
    createTab(null, { incognito: true });
    return true;
  }
  if (key === 't') {
    event.preventDefault();
    createTab();
    return true;
  }
  if (key === 'w') {
    event.preventDefault();
    if (activeTabId !== null) closeTab(activeTabId);
    return true;
  }
  if (key === 'l') {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('address-bar:focus');
    return true;
  }
  if (key === 'f') {
    event.preventDefault();
    showFindBar();
    return true;
  }
  return false;
}

function handleGlobalShortcut(event, input) {
  if (input.type === 'keyDown' && input.key === 'F11') {
    event.preventDefault();
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return;
  }
  if (input.type === 'keyDown' && input.key === 'Escape' && overlayMode === 'find') {
    event.preventDefault();
    hideFindBar();
    return;
  }
  // ESC only exits F11 fullscreen; Chromium itself handles ESC behavior for
  // in-page (video) fullscreen.
  if (input.type === 'keyDown' && input.key === 'Escape' && !htmlFullScreen && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    return;
  }
  if (handleAppShortcuts(event, input)) return;
  handleZoomShortcut(event, input);
}

function bypassGoogleRedirect(event, navigationUrl) {
  let parsed;
  try {
    parsed = new URL(navigationUrl);
  } catch {
    return;
  }
  const isGoogleHost = parsed.hostname === 'www.google.com' || parsed.hostname === 'google.com';
  if (!isGoogleHost || parsed.pathname !== '/url') return;

  const realUrl = parsed.searchParams.get('q') || parsed.searchParams.get('url');
  if (!realUrl) return;

  event.preventDefault();
  event.sender.loadURL(realUrl);
}

// In fullscreen (F11 or in-page video fullscreen) the top chrome is hidden:
// the tab view covers the whole window, below where the toolbar used to be.
function isChromeHidden() {
  return htmlFullScreen || (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen());
}

function getTopOffset() {
  return isChromeHidden() ? 0 : TOOLBAR_HEIGHT;
}

function getContentBounds() {
  const [width, height] = mainWindow.getContentSize();
  const top = getTopOffset();
  return {
    x: 0,
    y: top,
    width,
    height: height - top
  };
}

function getSplitBounds() {
  const [width, height] = mainWindow.getContentSize();
  const top = getTopOffset();
  const contentHeight = height - top;
  const leftWidth = Math.round((width - SPLIT_DIVIDER_WIDTH) * splitState.ratio);
  const rightWidth = width - SPLIT_DIVIDER_WIDTH - leftWidth;
  return {
    left: { x: 0, y: top, width: leftWidth, height: contentHeight },
    divider: { x: leftWidth, y: top, width: SPLIT_DIVIDER_WIDTH, height: contentHeight },
    right: { x: leftWidth + SPLIT_DIVIDER_WIDTH, y: top, width: rightWidth, height: contentHeight }
  };
}

function getOverlayBounds() {
  const [width, height] = mainWindow.getContentSize();
  const top = getTopOffset();
  if (overlayMode === 'downloads') {
    return {
      x: width - DOWNLOADS_POP_WIDTH,
      y: top,
      width: DOWNLOADS_POP_WIDTH,
      height: DOWNLOADS_POP_HEIGHT
    };
  }
  if (overlayMode === 'history') {
    return {
      x: width - HISTORY_POP_WIDTH,
      y: top,
      width: HISTORY_POP_WIDTH,
      height: HISTORY_POP_HEIGHT
    };
  }
  if (overlayMode === 'bookmark-picker') {
    return {
      x: width - BOOKMARK_PICKER_WIDTH,
      y: top,
      width: BOOKMARK_PICKER_WIDTH,
      height: BOOKMARK_PICKER_HEIGHT
    };
  }
  if (overlayMode === 'find') {
    return {
      x: width - FIND_BAR_WIDTH,
      y: top,
      width: FIND_BAR_WIDTH,
      height: FIND_BAR_HEIGHT
    };
  }
  if (overlayMode === 'autocomplete') {
    return getAutocompleteBounds();
  }
  return { x: 0, y: top, width: SIDEBAR_WIDTH, height: height - top };
}

function updateActiveViewBounds() {
  if (splitState && splitState.visible) {
    const bounds = getSplitBounds();
    const left = tabs.get(splitState.leftId);
    const right = tabs.get(splitState.rightId);
    if (left) left.view.setBounds(bounds.left);
    if (right) right.view.setBounds(bounds.right);
    if (splitDividerView && !splitResizing) splitDividerView.setBounds(bounds.divider);
  } else if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) tab.view.setBounds(getContentBounds());
  }
  if (overlayMode && overlayView) {
    overlayView.setBounds(getOverlayBounds());
  }
  if (downloadToastView && mainWindow.getBrowserViews().includes(downloadToastView)) {
    downloadToastView.setBounds(getDownloadToastBounds());
  }
}

function sendDownloadUpdate(data) {
  sendChrome('download:update', data);
}

function getDownloadDir() {
  if (downloadDir && fs.existsSync(downloadDir)) return downloadDir;
  return app.getPath('downloads');
}

function setupDownloads(ses) {
  ses.on('will-download', (_e, item) => {
    const id = nextDownloadId++;
    // Skip the save dialog; save directly into the downloads folder with a
    // collision-free name (the "name (1).ext" pattern).
    const dir = getDownloadDir();
    const base = item.getFilename() || 'download';
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    let savePath = path.join(dir, base);
    for (let i = 1; fs.existsSync(savePath); i++) {
      savePath = path.join(dir, `${stem} (${i})${ext}`);
    }
    item.setSavePath(savePath);
    const entry = {
      item,
      // last measurement point and EMA-smoothed speed, for speed/ETA calculation
      lastTime: Date.now(),
      lastBytes: 0,
      speed: 0
    };
    downloads.set(id, entry);

    const snapshot = (state) => {
      const total = item.getTotalBytes();
      const received = item.getReceivedBytes();
      return {
        id,
        filename: item.getFilename(),
        received,
        total,
        state,
        paused: state === 'progressing' && item.isPaused(),
        speed: entry.speed,
        etaSec: entry.speed > 0 && total > 0 ? (total - received) / entry.speed : null,
        savePath: item.getSavePath()
      };
    };

    item.on('updated', (_ev, state) => {
      const now = Date.now();
      const received = item.getReceivedBytes();
      const dt = (now - entry.lastTime) / 1000;
      if (dt > 0.2) {
        const instant = (received - entry.lastBytes) / dt;
        entry.speed = entry.speed === 0 ? instant : entry.speed * 0.7 + instant * 0.3;
        entry.lastTime = now;
        entry.lastBytes = received;
      }
      if (item.isPaused()) entry.speed = 0;
      sendDownloadUpdate(snapshot(state));
    });

    item.once('done', (_ev, state) => {
      entry.speed = 0;
      sendDownloadUpdate(snapshot(state));
      if (state === 'completed') showDownloadToast('Download complete', item.getFilename());
    });

    sendDownloadUpdate(snapshot('progressing'));
    showDownloadToast('Download started', item.getFilename());
  });
}

function createOverlay() {
  overlayView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // Overlay is transparent so the page underneath stays visible while the panel slides.
  overlayView.setBackgroundColor('#00000000');
  overlayView.webContents.loadFile('overlay.html');
}

// Small in-window toast (not an OS-level always-on-top window) shown at the
// top-right of the content area when a download starts or finishes.
function createDownloadToast() {
  downloadToastView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'download-toast-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  downloadToastView.setBackgroundColor('#00000000');
  downloadToastView.webContents.loadFile('download-toast.html');
}

function getDownloadToastBounds() {
  const [width] = mainWindow.getContentSize();
  return {
    x: width - DOWNLOAD_TOAST_WIDTH - DOWNLOAD_TOAST_MARGIN,
    y: getTopOffset() + DOWNLOAD_TOAST_MARGIN,
    width: DOWNLOAD_TOAST_WIDTH,
    height: DOWNLOAD_TOAST_HEIGHT
  };
}

function showDownloadToast(status, filename) {
  if (!downloadToastView || !mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(downloadToastTimer);
  // Bring to front (above the active tab/overlay views) on every show.
  mainWindow.removeBrowserView(downloadToastView);
  mainWindow.addBrowserView(downloadToastView);
  downloadToastView.setBounds(getDownloadToastBounds());
  downloadToastView.webContents.send('download-toast:show', { status, filename });
  downloadToastTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeBrowserView(downloadToastView);
  }, DOWNLOAD_TOAST_TIMEOUT_MS);
}

// The draggable line between the two split-view panes. Lazily created (like
// the overlay/download-toast views) the first time a split is entered.
function createSplitDivider() {
  if (splitDividerView) return;
  splitDividerView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'split-divider-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  splitDividerView.setBackgroundColor('#00000000');
  splitDividerView.webContents.loadFile('split-divider.html');
}

// While idle the divider is just a thin strip at the seam. During an active
// drag it's widened to the full content width (same trick as the sidebar's
// tab-hover preview, widenOverlayForPreview) so its own webContents keeps
// receiving mousemove/mouseup no matter how far the cursor travels --
// BrowserViews only see input within their own bounds.
function widenSplitDivider() {
  if (!splitDividerView || !splitState) return;
  splitResizing = true;
  splitDividerView.setBounds(getContentBounds());
  const bounds = getSplitBounds();
  splitDividerView.webContents.send('split-divider:context', { dividerX: bounds.divider.x });
}

function shrinkSplitDivider() {
  splitResizing = false;
  if (!splitDividerView || !splitState) return;
  splitDividerView.setBounds(getSplitBounds().divider);
}

// Attaches exactly the two split panes + divider (detaching everything
// else first) and re-stacks the sidebar/popup overlay on top if it's open --
// without this, a sidebar that was already open (e.g. because the user just
// right-clicked a tab in it to start the split) would stay in its old
// z-order, buried underneath the freshly-attached split panes and unusable.
function attachSplitViews() {
  for (const t of tabs.values()) mainWindow.removeBrowserView(t.view);
  mainWindow.removeBrowserView(splitDividerView);
  mainWindow.addBrowserView(tabs.get(splitState.leftId).view);
  mainWindow.addBrowserView(tabs.get(splitState.rightId).view);
  mainWindow.addBrowserView(splitDividerView);
  if (overlayMode && overlayView) {
    mainWindow.removeBrowserView(overlayView);
    mainWindow.addBrowserView(overlayView);
    overlayView.setBounds(getOverlayBounds());
  }
  splitState.visible = true;
  updateActiveViewBounds();
}

// Detaches the two split panes + divider but keeps splitState around (with
// visible: false) so switchTab() can restore the exact same pairing later if
// the user clicks back on either of the two tabs -- see switchTab().
function detachSplitViews() {
  if (tabs.has(splitState.leftId)) mainWindow.removeBrowserView(tabs.get(splitState.leftId).view);
  if (tabs.has(splitState.rightId)) mainWindow.removeBrowserView(tabs.get(splitState.rightId).view);
  if (splitDividerView) mainWindow.removeBrowserView(splitDividerView);
  splitState.visible = false;
}

function enterSplitView(leftId, rightId) {
  if (leftId === rightId || !tabs.has(leftId) || !tabs.has(rightId)) return;
  if (splitState && splitState.visible) detachSplitViews(); // only one split visible at a time
  createSplitDivider();
  splitState = { leftId, rightId, ratio: 0.5, visible: false };
  attachSplitViews();
  activeTabId = leftId;
  sendChrome('split:changed', { active: true });
  sendChrome('tab:active', { id: leftId });
  sendTabState(leftId);
}

// Explicit "exit split view" (the toolbar button) fully forgets the pairing,
// unlike switching to a third tab (see switchTab()), which only hides it.
function exitSplitView() {
  if (!splitState) return;
  const { leftId, rightId, visible } = splitState;
  const keepId = activeTabId === rightId ? rightId : leftId;
  if (visible) detachSplitViews();
  splitState = null;
  activeTabId = null; // force switchTab below to do a real (re)attach
  if (tabs.has(keepId)) {
    switchTab(keepId);
  } else if (tabOrder.length > 0) {
    switchTab(tabOrder[tabOrder.length - 1]);
  } else {
    createTab();
  }
  sendChrome('split:changed', { active: false });
}

function showOverlay(mode, extra) {
  if (!overlayView) return;
  if (overlayMode === mode) return;
  overlayMode = mode;
  mainWindow.addBrowserView(overlayView);
  overlayView.setBounds(getOverlayBounds());
  overlayView.webContents.send('overlay:open', { mode, ...extra });
}

function hideOverlay() {
  if (!overlayView || !overlayMode) return;
  overlayMode = null;
  mainWindow.removeBrowserView(overlayView);
}

function showFindBar() {
  showOverlay('find');
}

function hideFindBar() {
  const tab = activeTabId !== null ? tabs.get(activeTabId) : null;
  if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage('clearSelection');
  hideOverlay();
}

function getAutocompleteBounds() {
  const rect = pendingAutocompleteRect || { x: 8, y: TOOLBAR_HEIGHT, width: AUTOCOMPLETE_MIN_WIDTH };
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(Math.max(rect.width, AUTOCOMPLETE_MIN_WIDTH)),
    height: 260
  };
}

// The dropdown's position tracks the address bar's own on-screen rect
// (reported by the toolbar on every keystroke), not a fixed corner like the
// other popups -- so updates while already open go straight to the view
// instead of through showOverlay(), which no-ops on an unchanged mode.
function showAutocomplete(results, rect) {
  pendingAutocompleteRect = rect;
  if (overlayMode === 'autocomplete') {
    overlayView.setBounds(getAutocompleteBounds());
    overlayView.webContents.send('autocomplete:data', results);
    return;
  }
  showOverlay('autocomplete', { results });
}

function hideAutocomplete() {
  if (overlayMode === 'autocomplete') hideOverlay();
}

// The sidebar's tab hover-preview is drawn in overlay.html but needs to
// visually extend past the sidebar's own 200px-wide BrowserView bounds (to
// sit over the page). Widen the view's hit area while the preview is up,
// same trick used for the LymoChat resize handle, then snap back to the
// normal sidebar-only bounds when the preview is dismissed.
function widenOverlayForPreview() {
  if (overlayMode !== 'sidebar' || !overlayView) return;
  overlayView.setBounds(getContentBounds());
}

function restoreOverlayBounds() {
  if (overlayMode !== 'sidebar' || !overlayView) return;
  overlayView.setBounds(getOverlayBounds());
}

// Ambient mode for LymoChat: recolors its grey chrome (background, header,
// input bar) to match the active page's sampled color, same source as the
// sidebar and toolbar (see sampleChromeColor/applyWindowChromeColor).
function applyLymoChatColor(hex, dark) {
  if (!lymochatWindow || lymochatWindow.isDestroyed()) return;
  const fg = dark ? '#e0e0e0' : '#1a1a1a';
  const js = `(() => {
    const root = document.documentElement.style;
    root.setProperty('--gray-900', ${JSON.stringify(hex)});
    root.setProperty('--gray-850', ${JSON.stringify(hex)});
    root.setProperty('--chat-fg', ${JSON.stringify(fg)});
  })()`;
  lymochatWindow.webContents.executeJavaScript(js).catch(() => {});
}

// LymoChat has no theme IPC, so the light/dark app theme (as opposed to
// ambient mode, above) is toggled by injecting a class directly.
function applyLymoChatTheme(dark) {
  if (!lymochatWindow || lymochatWindow.isDestroyed()) return;
  const js = `document.documentElement.classList.toggle('light-theme', ${!dark});`;
  lymochatWindow.webContents.executeJavaScript(js).catch(() => {});
}

// Broadcasts the light/dark app theme to every surface: the toolbar/overlay
// (via preload IPC), LymoChat (via injection, no preload), and any tab
// currently showing our own newtab.html (also via injection, since tab
// views have no preload either -- third-party pages simply ignore this).
function broadcastTheme() {
  // Sites like YouTube pick their own dark/light mode from the OS-level
  // prefers-color-scheme, not from Lymo's UI theme. Overriding Electron's
  // theme source makes every tab's prefers-color-scheme match our setting.
  nativeTheme.themeSource = darkTheme ? 'dark' : 'light';
  sendChrome('theme:changed', darkTheme);
  applyLymoChatTheme(darkTheme);
  for (const tab of tabs.values()) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) {
      wc.executeJavaScript(`window.__lymoSetTheme && window.__lymoSetTheme(${darkTheme})`).catch(() => {});
    }
  }
}

// Broadcasts the accent color to every surface: the toolbar/overlay (via
// preload IPC) and any tab currently showing our own newtab.html (via
// injection, since tab views have no preload -- third-party pages ignore this).
function broadcastAccent() {
  sendChrome('accent:changed', accentColor);
  for (const tab of tabs.values()) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) {
      wc.executeJavaScript(`window.__lymoSetAccent && window.__lymoSetAccent(${JSON.stringify(accentColor)})`).catch(() => {});
    }
  }
}

// Broadcasts the selected UI style (1 or 2) to every surface: the
// toolbar/overlay (via preload IPC) and any tab currently showing our own
// newtab.html/settings.html (via injection, since content tab views have no
// preload except the settings tab, which also gets it via preload IPC).
function broadcastStyle() {
  sendChrome('style:changed', uiStyle);
  for (const tab of tabs.values()) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) {
      wc.executeJavaScript(`window.__lymoSetStyle && window.__lymoSetStyle(${uiStyle})`).catch(() => {});
    }
  }
}

// LymoChat now lives in its own independent, resizable, movable window.
// It is created once (hidden) at app startup so its Firestore listeners keep
// running in the background: new messages trigger desktop notifications even
// while the window is closed (closing only hides it).
function createLymoChatWindow() {
  lymochatWindow = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: LYMOCHAT_MIN_WIDTH,
    minHeight: 400,
    show: false,
    title: 'LymoChat',
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'lymochat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The window lives hidden in the background; without this Chromium
      // throttles its timers/network wakeups and Firestore snapshot pushes
      // can arrive late or not at all while the window is hidden.
      backgroundThrottling: false
    }
  });
  lymochatWindow.setMenuBarVisibility(false);
  lymochatWindow.loadFile(LYMOCHAT_PATH);
  lymochatWindow.webContents.once('dom-ready', () => {
    if (lastChromeColor) applyLymoChatColor(lastChromeColor.hex, lastChromeColor.dark);
    applyLymoChatTheme(darkTheme);
  });
  // Closing hides the window so background listeners keep running; the
  // window is only really destroyed when the whole app quits.
  lymochatWindow.on('close', (e) => {
    if (app.isQuittingLymo) return;
    e.preventDefault();
    lymochatWindow.hide();
  });
  // Tell the page whether it's actually on screen: while hidden it must
  // treat every conversation as "not open" so all messages produce popups
  // and unread counters aren't silently zeroed.
  const sendVisibility = (visible) => {
    if (!lymochatWindow.isDestroyed()) {
      lymochatWindow.webContents.send('lymochat:visibility', visible);
    }
  };
  lymochatWindow.on('show', () => sendVisibility(true));
  lymochatWindow.on('hide', () => sendVisibility(false));
}

function showLymoChat() {
  if (!lymochatWindow || lymochatWindow.isDestroyed()) createLymoChatWindow();
  lymochatWindow.show();
  lymochatWindow.focus();
}

function hideLymoChat() {
  if (lymochatWindow && !lymochatWindow.isDestroyed()) lymochatWindow.hide();
}

function toggleLymoChat() {
  if (lymochatWindow && !lymochatWindow.isDestroyed() && lymochatWindow.isVisible()) hideLymoChat();
  else showLymoChat();
}

// In-app popup for a new message: a small frameless always-on-top window in
// the top-right corner of the screen, so it's visible even over fullscreen
// video. Clicking it opens the chat window and jumps to that conversation.
const NOTIF_POP_WIDTH = 280;
const NOTIF_POP_HEIGHT = 72;
const NOTIF_POP_MARGIN = 14;
const NOTIF_POP_TIMEOUT_MS = 3500;
let notifPopupWindow = null;
let notifPopupTimer = null;
let notifPopupPayload = null;

function createNotifPopupWindow() {
  notifPopupWindow = new BrowserWindow({
    width: NOTIF_POP_WIDTH,
    height: NOTIF_POP_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'notif-popup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 'screen-saver' level stays above fullscreen windows too.
  notifPopupWindow.setAlwaysOnTop(true, 'screen-saver');
  notifPopupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notifPopupWindow.loadFile('notif-popup.html');
}

function showNotifPopup(payload) {
  if (!notifPopupWindow || notifPopupWindow.isDestroyed()) createNotifPopupWindow();
  notifPopupPayload = payload;

  // Top-right corner of the display the browser window is on.
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  notifPopupWindow.setBounds({
    x: wa.x + wa.width - NOTIF_POP_WIDTH - NOTIF_POP_MARGIN,
    y: wa.y + NOTIF_POP_MARGIN,
    width: NOTIF_POP_WIDTH,
    height: NOTIF_POP_HEIGHT
  });
  notifPopupWindow.webContents.send('notif:show', { ...payload, sound: notifSound });
  notifPopupWindow.showInactive();

  clearTimeout(notifPopupTimer);
  notifPopupTimer = setTimeout(() => {
    if (notifPopupWindow && !notifPopupWindow.isDestroyed()) notifPopupWindow.hide();
  }, NOTIF_POP_TIMEOUT_MS);
}

const thumbTimers = new Map(); // tabId -> debounce timer, for hover-preview thumbnails

// Captures a small screenshot of the tab for the sidebar hover preview.
// Debounced per tab so rapid load/navigate events don't spam capturePage().
function scheduleThumbnailCapture(id, delay = 400) {
  clearTimeout(thumbTimers.get(id));
  thumbTimers.set(id, setTimeout(async () => {
    thumbTimers.delete(id);
    const tab = tabs.get(id);
    if (!tab) return;
    try {
      const bounds = tab.view.getBounds();
      if (bounds.width < 1 || bounds.height < 1) return;
      const img = await tab.view.webContents.capturePage();
      const resized = img.resize({ width: 200 });
      tab.thumbnail = resized.toDataURL();
      sendChrome('tab:thumbnail', { id, thumbnail: tab.thumbnail });
    } catch {
      // tab may have navigated away or closed mid-capture; skip this round
    }
  }, delay));
}

function sendTabState(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !mainWindow) return;
  const wc = tab.view.webContents;
  sendChrome('tab:update', {
    id: tabId,
    url: wc.getURL(),
    title: wc.getTitle() || 'New Tab',
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    isLoading: wc.isLoading(),
    favicon: tab.favicon || null,
    pinned: !!tab.pinned,
    incognito: !!tab.incognito,
    audible: !!tab.audible,
    muted: wc.isAudioMuted()
  });
}

// Pinned tabs always sort before unpinned ones, preserving relative order
// within each group -- this is re-run after every create/close/pin/reorder
// so a drag that crosses the pinned/unpinned boundary self-corrects.
function normalizeTabOrder() {
  const pinned = tabOrder.filter((id) => tabs.get(id) && tabs.get(id).pinned);
  const rest = tabOrder.filter((id) => !tabs.get(id) || !tabs.get(id).pinned);
  tabOrder = [...pinned, ...rest];
}

function broadcastTabOrder() {
  sendChrome('tab:order', tabOrder);
}

function savePinnedTabsFromState() {
  pinnedTabs = tabOrder
    .map((id) => tabs.get(id))
    .filter((tab) => tab && tab.pinned)
    .map((tab) => ({ url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() || tab.view.webContents.getURL() }));
  saveSettings();
}

function togglePinTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  normalizeTabOrder();
  broadcastTabOrder();
  sendTabState(id);
  savePinnedTabsFromState();
}

function showTabContextMenu(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const template = [
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', click: () => togglePinTab(id) },
    { label: 'Open in split view', enabled: id !== activeTabId, click: () => enterSplitView(activeTabId, id) }
  ];
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

// Right-click on empty sidebar space (not a tab row).
function showSidebarContextMenu() {
  const template = [
    { label: 'New Incognito Tab', click: () => createTab(null, { incognito: true }) }
  ];
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function createTab(url, opts = {}) {
  const isSettingsTab = opts.kind === 'settings';
  const isIncognito = !!opts.incognito;
  const id = nextTabId++;
  // Incognito tabs get their own per-tab partition with no "persist:" prefix,
  // so Electron keeps cookies/storage in memory only (never touches disk) and
  // it's never shared with any other tab, incognito or not.
  const partition = isIncognito ? `incognito-${id}` : SESSION_PARTITION;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
      v8CacheOptions: 'code',
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      ...(isSettingsTab ? { preload: path.join(__dirname, 'preload.js') } : {})
    }
  });

  const tab = {
    view, favicon: null, thumbnail: null, kind: isSettingsTab ? 'settings' : null,
    pinned: !!opts.pinned, incognito: isIncognito, audible: false
  };
  tabs.set(id, tab);
  tabOrder.push(id);
  normalizeTabOrder();
  applyZoomToView(view);

  const wc = view.webContents;
  wc.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  // Chromium keeps zoom per-origin, so it resets when navigating to a
  // different site; we reapply the current zoom on every navigation and
  // once loading finishes.
  wc.on('did-finish-load', () => {
    applyZoomToView(view);
    if (id === activeTabId) scheduleChromeColor();
    scheduleThumbnailCapture(id);
    wc.executeJavaScript(`window.__lymoSetTheme && window.__lymoSetTheme(${darkTheme})`).catch(() => {});
    wc.executeJavaScript(`window.__lymoSetAccent && window.__lymoSetAccent(${JSON.stringify(accentColor)})`).catch(() => {});
    wc.executeJavaScript(`window.__lymoSetShortcuts && window.__lymoSetShortcuts(${JSON.stringify(shortcuts)})`).catch(() => {});
    wc.executeJavaScript(`window.__lymoSetBookmarks && window.__lymoSetBookmarks(${JSON.stringify({ folders: bookmarkFolders, bookmarks })})`).catch(() => {});
    try {
      if (/(^|\.)youtube\.com$/.test(new URL(wc.getURL()).hostname)) {
        wc.executeJavaScript(YOUTUBE_ADBLOCK_SCRIPT).catch(() => {});
      }
    } catch {}
  });
  wc.on('did-navigate', () => {
    applyZoomToView(view);
    tab.favicon = null; // clear stale icon from the previous page until the new one reports in
    sendTabState(id);
    if (!tab.incognito) addHistoryEntry(wc.getURL(), wc.getTitle());
    if (id === activeTabId) scheduleChromeColor();
    if (tab.pinned) savePinnedTabsFromState();
  });
  wc.on('focus', () => {
    if (overlayMode === 'autocomplete') hideOverlay();
  });
  // Query the webContents directly (rather than trusting the event's own
  // payload shape, which has varied across Electron versions) for whether
  // the page is currently producing audio.
  wc.on('audio-state-changed', () => {
    tab.audible = wc.isCurrentlyAudible();
    sendTabState(id);
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0] || null;
    sendTabState(id);
  });
  wc.on('did-navigate-in-page', () => {
    sendTabState(id);
    scheduleThumbnailCapture(id);
  });
  wc.on('page-title-updated', (_e, title) => {
    sendTabState(id);
    updateLastHistoryTitle(wc.getURL(), title);
  });
  wc.on('did-start-loading', () => sendTabState(id));
  wc.on('did-stop-loading', () => sendTabState(id));
  wc.on('found-in-page', (_e, result) => {
    if (id === activeTabId && overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.send('find:result', { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal });
    }
  });
  wc.on('before-input-event', handleGlobalShortcut);
  wc.on('will-navigate', bypassGoogleRedirect);
  wc.on('context-menu', (_e, params) => {
    const isLink = !!params.linkURL;
    const isImage = params.mediaType === 'image';
    const hasSelection = !!params.selectionText;
    const template = [];

    if (isLink) {
      template.push(
        { label: 'Open link in new tab', click: () => createTab(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      );
    }

    if (hasSelection) template.push({ label: 'Copy', role: 'copy' });
    template.push({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste });

    if (isImage) {
      template.push(
        { type: 'separator' },
        { label: 'Save image as...', click: () => wc.downloadURL(params.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) }
      );
    }

    template.push(
      { type: 'separator' },
      { label: 'Back', enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'View page source', click: () => createTab('view-source:' + wc.getURL()) }
    );

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // Middle-click / window.open / target=_blank should open a new tab instead of a new window.
  wc.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl && targetUrl !== 'about:blank') createTab(targetUrl);
    return { action: 'deny' };
  });

  // In-page fullscreen (e.g. video): hide chrome and switch the window to
  // real fullscreen too; restore the previous state on exit.
  wc.on('enter-html-full-screen', () => {
    htmlFullScreen = true;
    wasFullScreenBeforeHtml = mainWindow.isFullScreen();
    if (!wasFullScreenBeforeHtml) mainWindow.setFullScreen(true);
    updateActiveViewBounds();
  });
  wc.on('leave-html-full-screen', () => {
    htmlFullScreen = false;
    if (!wasFullScreenBeforeHtml) mainWindow.setFullScreen(false);
    updateActiveViewBounds();
  });

  if (isSettingsTab) {
    wc.loadFile('settings.html');
  } else if (url) {
    wc.loadURL(url);
  } else {
    wc.loadFile('newtab.html');
  }

  sendChrome('tab:created', { id, url: url || null, pinned: tab.pinned, incognito: tab.incognito });
  broadcastTabOrder();
  switchTab(id);
  return id;
}

function showSettingsTab() {
  if (settingsTabId !== null && tabs.has(settingsTabId)) {
    switchTab(settingsTabId);
    return;
  }
  settingsTabId = createTab(null, { kind: 'settings' });
}

function switchTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  if (splitState && (id === splitState.leftId || id === splitState.rightId)) {
    if (!splitState.visible) {
      // Clicked back on one of a remembered (currently hidden) pair --
      // restore the split showing both tabs together, not just this one.
      attachSplitViews();
      sendChrome('split:changed', { active: true });
    }
    // Both BrowserViews stay attached either way -- only the toolbar's
    // notion of "active" tab (address bar, back/forward, etc.) moves.
    activeTabId = id;
    sendChrome('tab:active', { id });
    sendTabState(id);
    scheduleChromeColor();
    scheduleThumbnailCapture(id, 250);
    return;
  }

  if (splitState && splitState.visible) {
    // Navigating to a tab outside the split hides it (not destroys it) --
    // clicking back on either of its two tabs later restores it.
    detachSplitViews();
    sendChrome('split:changed', { active: false });
  }

  const prev = activeTabId !== null ? tabs.get(activeTabId) : null;
  activeTabId = id;
  if (prev && prev !== tab) mainWindow.removeBrowserView(prev.view);
  mainWindow.addBrowserView(tab.view);
  // Keep the overlay on top of the tab view if it's open.
  if (overlayMode && overlayView) {
    mainWindow.removeBrowserView(overlayView);
    mainWindow.addBrowserView(overlayView);
    overlayView.setBounds(getOverlayBounds());
  }
  updateActiveViewBounds();
  sendChrome('tab:active', { id });
  sendTabState(id);
  scheduleChromeColor();
  scheduleThumbnailCapture(id, 250);
}

function closeTab(id) {
  const tab = tabs.get(id);
  // Pinned tabs can't be closed accidentally (no close button, Ctrl+W no-ops
  // here too) -- unpin first via the tab's right-click menu, then close.
  if (!tab || tab.pinned) return;

  if (splitState && (id === splitState.leftId || id === splitState.rightId)) {
    // Half the remembered pair is about to be gone, so the pairing itself
    // is no longer valid -- forget it instead of leaving a dangling half.
    if (splitState.visible) detachSplitViews();
    splitState = null;
    sendChrome('split:changed', { active: false });
  }

  if (activeTabId === id) {
    mainWindow.removeBrowserView(tab.view);
  }
  tab.view.webContents.close();
  if (tab.incognito) {
    session.fromPartition(`incognito-${id}`).clearStorageData().catch(() => {});
  }
  tabs.delete(id);
  tabOrder = tabOrder.filter((x) => x !== id);
  clearTimeout(thumbTimers.get(id));
  thumbTimers.delete(id);
  if (settingsTabId === id) settingsTabId = null;

  if (activeTabId === id) {
    activeTabId = null;
    if (tabOrder.length > 0) {
      switchTab(tabOrder[tabOrder.length - 1]);
    } else {
      createTab();
    }
  }
  sendChrome('tab:closed', { id });
  broadcastTabOrder();
}

function normalizeUrl(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  if (/^localhost(:\d+)?/.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/\s/.test(trimmed) || !trimmed.includes('.')) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
  return `https://${trimmed}`;
}

// Small frameless always-on-top window showing the Lymo logo draw-in/fill
// animation (see splash.html) while mainWindow loads in the background
// (created with show: false in createWindow()). Torn down once both the
// animation and the main window are ready -- see maybeShowMainWindow().
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    center: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  splashWindow.setAlwaysOnTop(true, 'screen-saver');
  splashWindow.loadFile('splash.html');
}

function maybeShowMainWindow() {
  if (!splashDone || !mainWindowReady) return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#252525',
    // Stays hidden until the splash screen's animation finishes (see
    // createSplashWindow/maybeShowMainWindow) -- it still loads and builds
    // its tabs in the background the whole time, so it's ready the instant
    // the splash is done.
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // Hidden native titlebar with a colored overlay is the only way Electron
    // lets us recolor the caption buttons live to match ambient mode; the
    // default frame is drawn by the OS and can't be recolored at all.
    titleBarStyle: 'hidden',
    // One pixel shorter than the toolbar so the overlay's opaque background
    // doesn't paint over our toolbar's bottom border line under the caption
    // buttons -- that last row is left for the border to show through.
    titleBarOverlay: {
      color: '#252525',
      symbolColor: '#e0e0e0',
      height: TOOLBAR_HEIGHT - 1
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('before-input-event', handleGlobalShortcut);
  mainWindow.once('ready-to-show', () => {
    mainWindowReady = true;
    maybeShowMainWindow();
  });

  mainWindow.on('resize', updateActiveViewBounds);
  mainWindow.on('maximize', updateActiveViewBounds);
  mainWindow.on('unmaximize', updateActiveViewBounds);
  mainWindow.on('restore', updateActiveViewBounds);
  mainWindow.on('enter-full-screen', updateActiveViewBounds);
  mainWindow.on('leave-full-screen', updateActiveViewBounds);

  // Alt-Tab back into the app otherwise leaves keyboard focus on the
  // (invisible) toolbar webContents, so keys like Space hit toolbar buttons
  // instead of reaching the page. Refocus the active tab's BrowserView.
  mainWindow.on('focus', () => {
    if (activeTabId === null) return;
    const tab = tabs.get(activeTabId);
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
  });

  createOverlay();
  createDownloadToast();

  // There's no visible trigger strip on the left while the panel is closed;
  // the BrowserView covers the full width so hover can't be detected from
  // HTML. Instead we poll the cursor position and open the tab panel when it
  // touches the first few pixels of the window's left edge.
  const edgeWatcher = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (overlayMode || !mainWindow.isFocused()) return;
    const cursor = screen.getCursorScreenPoint();
    const b = mainWindow.getContentBounds();
    const atLeftEdge =
      cursor.x >= b.x && cursor.x <= b.x + EDGE_TRIGGER &&
      cursor.y >= b.y + getTopOffset() && cursor.y <= b.y + b.height;
    if (atLeftEdge) showOverlay('sidebar');
  }, 100);

  mainWindow.on('closed', () => {
    clearInterval(edgeWatcher);
    // The hidden LymoChat window would otherwise keep the app alive after
    // the browser window is gone.
    app.isQuittingLymo = true;
    if (lymochatWindow && !lymochatWindow.isDestroyed()) lymochatWindow.destroy();
    if (notifPopupWindow && !notifPopupWindow.isDestroyed()) notifPopupWindow.destroy();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    // Pinned tabs are restored first (in their saved order) so they land at
    // the front of the sidebar; the fresh New Tab page opens last and becomes
    // the active tab, matching a normal cold start.
    for (const p of pinnedTabs) {
      createTab(p.url, { pinned: true });
    }
    createTab();
  });
}

ipcMain.handle('tabs:create', (_e, url) => createTab(url));
ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
ipcMain.handle('tabs:switch', (_e, id) => switchTab(id));
ipcMain.handle('tabs:reorder', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return;
  const valid = orderedIds.filter((id) => tabs.has(id));
  for (const id of tabOrder) {
    if (!valid.includes(id)) valid.push(id); // keep any tab the client's list missed
  }
  tabOrder = valid;
  normalizeTabOrder();
  broadcastTabOrder();
});
ipcMain.handle('tabs:context-menu', (_e, id) => showTabContextMenu(id));
ipcMain.handle('sidebar:context-menu', () => showSidebarContextMenu());
ipcMain.handle('tabs:toggle-mute', (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return;
  const wc = tab.view.webContents;
  wc.setAudioMuted(!wc.isAudioMuted());
  sendTabState(id);
});

ipcMain.handle('split:exit', () => exitSplitView());
ipcMain.handle('split:resize-start', () => widenSplitDivider());
ipcMain.handle('split:resize-move', (_e, ratio) => {
  if (!splitState) return;
  splitState.ratio = Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, ratio));
  const bounds = getSplitBounds();
  const left = tabs.get(splitState.leftId);
  const right = tabs.get(splitState.rightId);
  if (left) left.view.setBounds(bounds.left);
  if (right) right.view.setBounds(bounds.right);
});
ipcMain.handle('split:resize-end', () => shrinkSplitDivider());

ipcMain.handle('nav:go', (_e, { id, url }) => {
  const tab = tabs.get(id);
  if (tab) tab.view.webContents.loadURL(normalizeUrl(url));
});

ipcMain.handle('nav:back', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
});

ipcMain.handle('nav:forward', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
});

ipcMain.handle('nav:reload', (_e, id) => {
  const tab = tabs.get(id);
  if (tab) tab.view.webContents.reload();
});

ipcMain.handle('downloads:pause', (_e, id) => {
  const d = downloads.get(id);
  if (d && d.item.getState() === 'progressing') d.item.pause();
});

ipcMain.handle('downloads:resume', (_e, id) => {
  const d = downloads.get(id);
  if (d && d.item.canResume()) d.item.resume();
});

ipcMain.handle('downloads:cancel', (_e, id) => {
  const d = downloads.get(id);
  if (d && d.item.getState() === 'progressing') d.item.cancel();
});

ipcMain.handle('downloads:open-file', (_e, id) => {
  const d = downloads.get(id);
  if (d && d.item.getSavePath()) shell.openPath(d.item.getSavePath());
});

ipcMain.handle('downloads:open-folder', (_e, id) => {
  const d = downloads.get(id);
  if (d && d.item.getSavePath()) shell.showItemInFolder(d.item.getSavePath());
});

ipcMain.handle('history:get-all', () => history);

ipcMain.handle('history:delete', (_e, id) => {
  history = history.filter((h) => h.id !== id);
  saveHistory();
});

ipcMain.handle('history:clear', () => {
  history = [];
  saveHistory();
});

ipcMain.handle('history:open', (_e, url) => {
  const tab = activeTabId !== null ? tabs.get(activeTabId) : null;
  if (tab) tab.view.webContents.loadURL(url);
  hideOverlay();
});

ipcMain.handle('settings:get-zoom', () => currentZoom);
ipcMain.handle('settings:set-zoom', (_e, percent) => setZoomLevel(percent));

ipcMain.handle('settings:get-theme', () => darkTheme);
ipcMain.handle('settings:set-theme', (_e, enabled) => {
  darkTheme = Boolean(enabled);
  saveSettings();
  broadcastTheme();
});

ipcMain.handle('settings:get-accent-color', () => accentColor);
ipcMain.handle('settings:set-accent-color', (_e, color) => {
  if (!ACCENT_COLORS.includes(color)) return accentColor;
  accentColor = color;
  saveSettings();
  broadcastAccent();
  return accentColor;
});

ipcMain.handle('settings:get-style', () => uiStyle);
ipcMain.handle('settings:set-style', (_e, style) => {
  uiStyle = style === 2 ? 2 : 1;
  saveSettings();
  broadcastStyle();
  return uiStyle;
});


ipcMain.handle('settings:get-shortcuts', () => shortcuts);
ipcMain.handle('settings:add-shortcut', (_e, { name, url }) => {
  const trimmedName = String(name || '').trim();
  if (!trimmedName || !url) return shortcuts;
  shortcuts.push({ id: nextShortcutId++, name: trimmedName, url: normalizeShortcutUrl(url) });
  saveSettings();
  broadcastShortcuts();
  return shortcuts;
});
ipcMain.handle('settings:update-shortcut', (_e, { id, name, url }) => {
  const shortcut = shortcuts.find((s) => s.id === id);
  if (!shortcut) return shortcuts;
  if (typeof name === 'string' && name.trim()) shortcut.name = name.trim();
  if (typeof url === 'string' && url.trim()) shortcut.url = normalizeShortcutUrl(url);
  saveSettings();
  broadcastShortcuts();
  return shortcuts;
});
ipcMain.handle('settings:delete-shortcut', (_e, id) => {
  shortcuts = shortcuts.filter((s) => s.id !== id);
  saveSettings();
  broadcastShortcuts();
  return shortcuts;
});
ipcMain.handle('settings:reorder-shortcuts', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return shortcuts;
  const byId = new Map(shortcuts.map((s) => [s.id, s]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Keep any shortcut missing from orderedIds (shouldn't normally happen) so nothing is silently dropped.
  for (const s of shortcuts) {
    if (!reordered.includes(s)) reordered.push(s);
  }
  shortcuts = reordered;
  saveSettings();
  broadcastShortcuts();
  return shortcuts;
});

ipcMain.handle('bookmarks:get-all', () => ({ folders: bookmarkFolders, bookmarks }));
ipcMain.handle('bookmarks:is-bookmarked', (_e, url) => bookmarks.some((b) => b.url === url));

ipcMain.handle('bookmarks:add', (_e, { name, url, folderId }) => {
  if (!url) return { folders: bookmarkFolders, bookmarks };
  const trimmedName = String(name || '').trim() || url;
  const targetFolder = bookmarkFolders.some((f) => f.id === folderId) ? folderId : bookmarkFolders[0].id;
  bookmarks.push({ id: nextBookmarkId++, name: trimmedName, url, folderId: targetFolder });
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks };
});

ipcMain.handle('bookmarks:update', (_e, { id, name, url, folderId }) => {
  const b = bookmarks.find((x) => x.id === id);
  if (!b) return { folders: bookmarkFolders, bookmarks };
  if (typeof name === 'string' && name.trim()) b.name = name.trim();
  if (typeof url === 'string' && url.trim()) b.url = normalizeShortcutUrl(url);
  if (typeof folderId === 'number' && bookmarkFolders.some((f) => f.id === folderId)) b.folderId = folderId;
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks };
});

ipcMain.handle('bookmarks:delete', (_e, id) => {
  bookmarks = bookmarks.filter((b) => b.id !== id);
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks };
});

ipcMain.handle('bookmarks:delete-by-url', (_e, url) => {
  bookmarks = bookmarks.filter((b) => b.url !== url);
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks };
});

ipcMain.handle('bookmarks:add-folder', (_e, name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { folders: bookmarkFolders, bookmarks, folder: null };
  const folder = { id: nextFolderId++, name: trimmed };
  bookmarkFolders.push(folder);
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks, folder };
});

ipcMain.handle('bookmarks:rename-folder', (_e, { id, name }) => {
  const folder = bookmarkFolders.find((f) => f.id === id);
  if (folder && typeof name === 'string' && name.trim()) folder.name = name.trim();
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks };
});

ipcMain.handle('bookmarks:delete-folder', (_e, id) => {
  // Always keep at least one folder so there's somewhere for existing bookmarks to live.
  if (bookmarkFolders.length <= 1) return { folders: bookmarkFolders, bookmarks };
  bookmarkFolders = bookmarkFolders.filter((f) => f.id !== id);
  const fallbackId = bookmarkFolders[0].id;
  bookmarks = bookmarks.map((b) => (b.folderId === id ? { ...b, folderId: fallbackId } : b));
  saveBookmarksFile();
  broadcastBookmarks();
  return { folders: bookmarkFolders, bookmarks };
});

ipcMain.handle('settings:get-download-dir', () => getDownloadDir());
ipcMain.handle('settings:choose-download-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose download folder',
    defaultPath: getDownloadDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    downloadDir = result.filePaths[0];
    saveSettings();
  }
  return getDownloadDir();
});

ipcMain.handle('overlay:show-settings', () => showSettingsTab());
ipcMain.handle('overlay:show-downloads', () => showOverlay('downloads'));
ipcMain.handle('overlay:show-history', () => showOverlay('history'));
ipcMain.handle('overlay:show-bookmark-picker', (_e, { url, title }) => showOverlay('bookmark-picker', { url, title }));

ipcMain.handle('find:query', (_e, { text, forward, findNext }) => {
  const tab = activeTabId !== null ? tabs.get(activeTabId) : null;
  if (!tab || tab.view.webContents.isDestroyed()) return;
  if (!text) {
    tab.view.webContents.stopFindInPage('clearSelection');
    return;
  }
  tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: !!findNext });
});
ipcMain.handle('find:stop', () => hideFindBar());

ipcMain.handle('autocomplete:show', (_e, { query, rect }) => {
  const results = searchHistory(query);
  showAutocomplete(results, rect);
  return results;
});
ipcMain.handle('autocomplete:hide', () => hideAutocomplete());
ipcMain.on('autocomplete:highlight', (_e, index) => {
  if (overlayView && !overlayView.webContents.isDestroyed()) overlayView.webContents.send('autocomplete:highlight', index);
});
ipcMain.handle('overlay:hide', () => hideOverlay());
ipcMain.handle('overlay:preview-show', () => widenOverlayForPreview());
ipcMain.handle('overlay:preview-hide', () => restoreOverlayBounds());
ipcMain.handle('overlay:toggle-lymochat', () => toggleLymoChat());
ipcMain.handle('overlay:hide-lymochat', () => hideLymoChat());
ipcMain.on('splash:done', () => {
  splashDone = true;
  maybeShowMainWindow();
});

ipcMain.on('lymochat:new-message', () => sendChrome('lymochat:notify'));
// Renderer asks for a new-message popup; skipped when the chat window is the
// focused foreground window (the user is already looking at the chat).
ipcMain.on('lymochat:popup', (_e, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const chatFocused = lymochatWindow && !lymochatWindow.isDestroyed() &&
    lymochatWindow.isVisible() && lymochatWindow.isFocused();
  if (!chatFocused) showNotifPopup(payload);
});
ipcMain.handle('lymochat:get-sound', () => notifSound);
ipcMain.handle('lymochat:set-sound', (_e, enabled) => {
  notifSound = Boolean(enabled);
  saveSettings();
  return notifSound;
});
// Click on the popup: hide it, open the chat window and jump to the chat.
ipcMain.on('notif:clicked', () => {
  clearTimeout(notifPopupTimer);
  if (notifPopupWindow && !notifPopupWindow.isDestroyed()) notifPopupWindow.hide();
  showLymoChat();
  if (notifPopupPayload && lymochatWindow && !lymochatWindow.isDestroyed()) {
    lymochatWindow.webContents.send('lymochat:open-chat', notifPopupPayload);
  }
});
// Legacy panel-resize IPC (overlay.html may still call these); no-ops now
// that LymoChat is its own window.
ipcMain.handle('lymochat:resize-start', () => {});
ipcMain.handle('lymochat:resize-move', () => {});
ipcMain.handle('lymochat:resize-end', () => {});
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  createSplashWindow(); // shows immediately; mainWindow loads behind it in the meantime
  const settings = loadSettings();
  currentZoom = settings.zoom;
  downloadDir = settings.downloadDir;
  lymochatPanelWidth = settings.lymochatPanelWidth;
  darkTheme = settings.darkTheme;
  accentColor = settings.accentColor;
  uiStyle = settings.uiStyle;
  shortcuts = settings.shortcuts;
  nextShortcutId = shortcuts.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  pinnedTabs = settings.pinnedTabs;
  notifSound = settings.notifSound;
  nativeTheme.themeSource = darkTheme ? 'dark' : 'light';
  history = loadHistory();

  const bookmarkData = loadBookmarksFile();
  bookmarkFolders = bookmarkData.folders;
  bookmarks = bookmarkData.bookmarks;
  nextFolderId = bookmarkFolders.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  nextBookmarkId = bookmarks.reduce((max, b) => Math.max(max, b.id), 0) + 1;

  // The system's "auto-detect settings" (WPAD) behavior makes Chromium scan
  // for a proxy on every navigation, adding seconds of delay. We disable it
  // and connect directly for the tabs' shared session; this also lets the
  // disk cache and DNS/connection pool persist across tabs and app restarts.
  const ses = session.fromPartition(SESSION_PARTITION);
  await ses.setProxy({ mode: 'direct' });

  setupDownloads(ses);

  // Google is the most frequently visited search engine, so we pre-warm DNS
  // resolution, the TCP connection, and the TLS handshake while the window
  // opens; the first search and later result-page navigations then reuse
  // the connection pool without waiting for these steps again.
  try {
    ses.preconnect({ url: 'https://www.google.com', numSockets: 4 });
  } catch {
    // keep the app starting normally even if preconnect fails
  }

  createWindow();
  // Created hidden right away so its Firestore listeners run in the
  // background and desktop notifications work with the window "closed".
  createLymoChatWindow();
});

app.on('before-quit', () => {
  app.isQuittingLymo = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
