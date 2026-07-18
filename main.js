const { app, BrowserWindow, BrowserView, ipcMain, Menu, session, screen, net, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const SIDEBAR_WIDTH = 200;
const EDGE_TRIGGER = 3;
const TOOLBAR_HEIGHT = 48;
const DOWNLOADS_POP_WIDTH = 340;
const DOWNLOADS_POP_HEIGHT = 320;
const SETTINGS_POP_WIDTH = 280;
const SETTINGS_POP_HEIGHT = 285;
const HISTORY_POP_WIDTH = 380;
const HISTORY_POP_HEIGHT = 420;
const HISTORY_MAX_ENTRIES = 5000;
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

let mainWindow;
let overlayView = null;
let overlayMode = null; // 'sidebar' | 'settings' | 'downloads' | 'history' | 'lymochat' | null
let lymochatView = null;
let lymochatOpen = false;
let lymochatPanelWidth = null; // null = use default (1/3 of window width)
let lymochatResizing = false;
const tabs = new Map();
let activeTabId = null;
let nextTabId = 1;
let currentZoom = DEFAULT_ZOOM;
let chromeColorTimer = null;
let lastChromeColor = null; // { hex, dark } - last ambient color sampled, reapplied to LymoChat on (re)open
let htmlFullScreen = false; // whether in-page (video) fullscreen is active
let wasFullScreenBeforeHtml = false;
const downloads = new Map();
let nextDownloadId = 1;
let darkTheme = true;
let accentColor = DEFAULT_ACCENT_COLOR;
let downloadDir = null; // null = system Downloads folder
let history = []; // newest first
let lastHistoryId = null; // used to update the latest entry once the page title arrives late

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
  // jumping the player straight to the end of it.
  setInterval(function() {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video');
    if (player && video && player.classList.contains('ad-showing') && isFinite(video.duration)) {
      video.currentTime = video.duration;
    }
  }, 100);
})();
`;

// Chrome UI is split across two webContents (toolbar window + overlay view);
// tab/zoom state events are broadcast to both.
function sendChrome(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  if (overlayView && !overlayView.webContents.isDestroyed()) overlayView.webContents.send(channel, data);
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
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
      accentColor: ACCENT_COLORS.includes(parsed.accentColor) ? parsed.accentColor : DEFAULT_ACCENT_COLOR
    };
  } catch {
    return { zoom: DEFAULT_ZOOM, downloadDir: null, lymochatPanelWidth: null, darkTheme: true, accentColor: DEFAULT_ACCENT_COLOR };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ zoom: currentZoom, downloadDir, lymochatPanelWidth, darkTheme, accentColor }));
  } catch {
    // keep the app running even if persistence fails
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

function handleGlobalShortcut(event, input) {
  if (input.type === 'keyDown' && input.key === 'F11') {
    event.preventDefault();
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return;
  }
  // ESC only exits F11 fullscreen; Chromium itself handles ESC behavior for
  // in-page (video) fullscreen.
  if (input.type === 'keyDown' && input.key === 'Escape' && !htmlFullScreen && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    return;
  }
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

function getOverlayBounds() {
  const [width, height] = mainWindow.getContentSize();
  const top = getTopOffset();
  if (overlayMode === 'settings') {
    return {
      x: width - SETTINGS_POP_WIDTH,
      y: top,
      width: SETTINGS_POP_WIDTH,
      height: SETTINGS_POP_HEIGHT
    };
  }
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
  if (overlayMode === 'lymochat') {
    return getLymoChatPanelBounds();
  }
  return { x: 0, y: top, width: SIDEBAR_WIDTH, height: height - top };
}

function clampLymoChatWidth(width, requested) {
  const maxWidth = Math.round(width * LYMOCHAT_MAX_WIDTH_RATIO);
  return Math.min(maxWidth, Math.max(LYMOCHAT_MIN_WIDTH, Math.round(requested)));
}

function getLymoChatPanelBounds() {
  const [width, height] = mainWindow.getContentSize();
  const top = getTopOffset();
  const defaultWidth = Math.round(width / 3);
  const panelWidth = clampLymoChatWidth(width, lymochatPanelWidth || defaultWidth);
  return { x: width - panelWidth, y: top, width: panelWidth, height: height - top };
}

function getLymoChatContentBounds() {
  const panel = getLymoChatPanelBounds();
  return {
    x: panel.x + LYMOCHAT_HANDLE_WIDTH,
    y: panel.y + LYMOCHAT_HEADER_HEIGHT,
    width: panel.width - LYMOCHAT_HANDLE_WIDTH,
    height: panel.height - LYMOCHAT_HEADER_HEIGHT
  };
}

function updateActiveViewBounds() {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) tab.view.setBounds(getContentBounds());
  }
  if (overlayMode && overlayView && !lymochatResizing) {
    overlayView.setBounds(getOverlayBounds());
  }
  if (lymochatOpen && lymochatView) {
    lymochatView.setBounds(getLymoChatContentBounds());
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
    });

    sendDownloadUpdate(snapshot('progressing'));
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

function showOverlay(mode) {
  if (!overlayView) return;
  if (lymochatOpen) hideLymoChat();
  if (overlayMode === mode) return;
  overlayMode = mode;
  mainWindow.addBrowserView(overlayView);
  overlayView.setBounds(getOverlayBounds());
  overlayView.webContents.send('overlay:open', { mode });
}

function hideOverlay() {
  if (!overlayView || !overlayMode) return;
  overlayMode = null;
  mainWindow.removeBrowserView(overlayView);
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
  if (!lymochatView || lymochatView.webContents.isDestroyed()) return;
  const fg = dark ? '#e0e0e0' : '#1a1a1a';
  const js = `(() => {
    const root = document.documentElement.style;
    root.setProperty('--gray-900', ${JSON.stringify(hex)});
    root.setProperty('--gray-850', ${JSON.stringify(hex)});
    root.setProperty('--chat-fg', ${JSON.stringify(fg)});
  })()`;
  lymochatView.webContents.executeJavaScript(js).catch(() => {});
}

// LymoChat has no preload, so the light/dark app theme (as opposed to
// ambient mode, above) is toggled by injecting a class directly.
function applyLymoChatTheme(dark) {
  if (!lymochatView || lymochatView.webContents.isDestroyed()) return;
  const js = `document.documentElement.classList.toggle('light-theme', ${!dark});`;
  lymochatView.webContents.executeJavaScript(js).catch(() => {});
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

function createLymoChatView() {
  lymochatView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'lymochat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  lymochatView.setBackgroundColor('#0a0a0a');
  lymochatView.webContents.loadFile(LYMOCHAT_PATH);
  lymochatView.webContents.once('dom-ready', () => {
    if (lastChromeColor) applyLymoChatColor(lastChromeColor.hex, lastChromeColor.dark);
    applyLymoChatTheme(darkTheme);
  });
}

function showLymoChat() {
  if (!lymochatView) createLymoChatView();
  if (lymochatOpen) return;
  if (overlayMode && overlayMode !== 'lymochat') hideOverlay();
  lymochatOpen = true;
  overlayMode = 'lymochat';
  mainWindow.addBrowserView(overlayView);
  overlayView.setBounds(getOverlayBounds());
  overlayView.webContents.send('overlay:open', { mode: 'lymochat', width: getLymoChatPanelBounds().width });
  mainWindow.addBrowserView(lymochatView);
  lymochatView.setBounds(getLymoChatContentBounds());
  if (lastChromeColor) applyLymoChatColor(lastChromeColor.hex, lastChromeColor.dark);
}

function hideLymoChat() {
  if (!lymochatOpen) return;
  lymochatResizing = false;
  lymochatOpen = false;
  if (lymochatView) mainWindow.removeBrowserView(lymochatView);
  if (overlayMode === 'lymochat') hideOverlay();
}

function toggleLymoChat() {
  if (lymochatOpen) hideLymoChat();
  else showLymoChat();
}

function startLymoChatResize() {
  if (!overlayView || !lymochatOpen) return;
  lymochatResizing = true;
  // Temporarily cover the whole content area so the overlay page keeps
  // receiving mousemove/mouseup no matter how far the user drags.
  overlayView.setBounds(getContentBounds());
}

function moveLymoChatResize(requestedWidth) {
  if (!lymochatResizing) return;
  const [width] = mainWindow.getContentSize();
  lymochatPanelWidth = clampLymoChatWidth(width, requestedWidth);
  if (lymochatView) lymochatView.setBounds(getLymoChatContentBounds());
}

function endLymoChatResize() {
  if (!lymochatResizing) return;
  lymochatResizing = false;
  if (overlayMode === 'lymochat' && overlayView) {
    overlayView.setBounds(getOverlayBounds());
  }
  saveSettings();
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
    favicon: tab.favicon || null
  });
}

function createTab(url) {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: SESSION_PARTITION,
      v8CacheOptions: 'code',
      allowRunningInsecureContent: true,
      experimentalFeatures: true
    }
  });

  const tab = { view, favicon: null, thumbnail: null };
  tabs.set(id, tab);
  applyZoomToView(view);

  const wc = view.webContents;
  // Chromium keeps zoom per-origin, so it resets when navigating to a
  // different site; we reapply the current zoom on every navigation and
  // once loading finishes.
  wc.on('did-finish-load', () => {
    applyZoomToView(view);
    if (id === activeTabId) scheduleChromeColor();
    scheduleThumbnailCapture(id);
    wc.executeJavaScript(`window.__lymoSetTheme && window.__lymoSetTheme(${darkTheme})`).catch(() => {});
    wc.executeJavaScript(`window.__lymoSetAccent && window.__lymoSetAccent(${JSON.stringify(accentColor)})`).catch(() => {});
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
    addHistoryEntry(wc.getURL(), wc.getTitle());
    if (id === activeTabId) scheduleChromeColor();
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
  wc.on('before-input-event', handleGlobalShortcut);
  wc.on('will-navigate', bypassGoogleRedirect);
  wc.on('context-menu', (_e, params) => {
    const template = [
      { label: 'Geri', enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: 'İleri', enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: 'Yenile', click: () => wc.reload() },
      { type: 'separator' },
      {
        label: 'Resim içinde resim',
        click: () => {
          wc.executeJavaScript(`
            (function() {
              const video = document.querySelector('video');
              if (video) {
                if (document.pictureInPictureElement) {
                  document.exitPictureInPicture().catch(() => {});
                } else if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
                  video.requestPictureInPicture().catch(() => {});
                }
              }
            })();
          `, true).catch(() => {});
        }
      },
      { type: 'separator' },
      { label: 'Kopyala', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Yapıştır', role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Öğeyi İncele', click: () => wc.inspectElement(params.x, params.y) }
    ];
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

  if (url) {
    wc.loadURL(url);
  } else {
    wc.loadFile('newtab.html');
  }

  sendChrome('tab:created', { id, url: url || null });
  switchTab(id);
  return id;
}

function switchTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
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
  if (!tab) return;

  if (activeTabId === id) {
    mainWindow.removeBrowserView(tab.view);
  }
  tab.view.webContents.close();
  tabs.delete(id);
  clearTimeout(thumbTimers.get(id));
  thumbTimers.delete(id);

  if (activeTabId === id) {
    activeTabId = null;
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      createTab();
    }
  }
  sendChrome('tab:closed', { id });
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#252525',
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

  mainWindow.on('resize', updateActiveViewBounds);
  mainWindow.on('maximize', updateActiveViewBounds);
  mainWindow.on('unmaximize', updateActiveViewBounds);
  mainWindow.on('restore', updateActiveViewBounds);
  mainWindow.on('enter-full-screen', updateActiveViewBounds);
  mainWindow.on('leave-full-screen', updateActiveViewBounds);

  createOverlay();

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

  mainWindow.on('closed', () => clearInterval(edgeWatcher));

  mainWindow.webContents.on('did-finish-load', () => {
    createTab();
  });
}

ipcMain.handle('tabs:create', (_e, url) => createTab(url));
ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
ipcMain.handle('tabs:switch', (_e, id) => switchTab(id));

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

ipcMain.handle('overlay:show-settings', () => showOverlay('settings'));
ipcMain.handle('overlay:show-downloads', () => showOverlay('downloads'));
ipcMain.handle('overlay:show-history', () => showOverlay('history'));
ipcMain.handle('overlay:hide', () => hideOverlay());
ipcMain.handle('overlay:preview-show', () => widenOverlayForPreview());
ipcMain.handle('overlay:preview-hide', () => restoreOverlayBounds());
ipcMain.handle('overlay:toggle-lymochat', () => toggleLymoChat());
ipcMain.handle('overlay:hide-lymochat', () => hideLymoChat());
ipcMain.on('lymochat:new-message', () => sendChrome('lymochat:notify'));
ipcMain.handle('lymochat:resize-start', () => startLymoChatResize());
ipcMain.handle('lymochat:resize-move', (_e, width) => moveLymoChatResize(width));
ipcMain.handle('lymochat:resize-end', () => endLymoChatResize());
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const settings = loadSettings();
  currentZoom = settings.zoom;
  downloadDir = settings.downloadDir;
  lymochatPanelWidth = settings.lymochatPanelWidth;
  darkTheme = settings.darkTheme;
  accentColor = settings.accentColor;
  nativeTheme.themeSource = darkTheme ? 'dark' : 'light';
  history = loadHistory();

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
