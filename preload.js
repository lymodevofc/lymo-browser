const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  switchTab: (id) => ipcRenderer.invoke('tabs:switch', id),
  go: (id, url) => ipcRenderer.invoke('nav:go', { id, url }),
  back: (id) => ipcRenderer.invoke('nav:back', id),
  forward: (id) => ipcRenderer.invoke('nav:forward', id),
  reload: (id) => ipcRenderer.invoke('nav:reload', id),

  onTabCreated: (cb) => ipcRenderer.on('tab:created', (_e, data) => cb(data)),
  onTabUpdate: (cb) => ipcRenderer.on('tab:update', (_e, data) => cb(data)),
  onTabThumbnail: (cb) => ipcRenderer.on('tab:thumbnail', (_e, data) => cb(data)),
  onTabClosed: (cb) => ipcRenderer.on('tab:closed', (_e, data) => cb(data)),
  onTabActive: (cb) => ipcRenderer.on('tab:active', (_e, data) => cb(data)),

  pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  openDownloadFile: (id) => ipcRenderer.invoke('downloads:open-file', id),
  openDownloadFolder: (id) => ipcRenderer.invoke('downloads:open-folder', id),
  onDownloadUpdate: (cb) => ipcRenderer.on('download:update', (_e, data) => cb(data)),
  showDownloads: () => ipcRenderer.invoke('overlay:show-downloads'),

  getHistory: () => ipcRenderer.invoke('history:get-all'),
  deleteHistoryEntry: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openHistoryUrl: (url) => ipcRenderer.invoke('history:open', url),
  onHistoryAdded: (cb) => ipcRenderer.on('history:added', (_e, data) => cb(data)),
  onHistoryUpdated: (cb) => ipcRenderer.on('history:updated', (_e, data) => cb(data)),
  showHistory: () => ipcRenderer.invoke('overlay:show-history'),

  getDownloadDir: () => ipcRenderer.invoke('settings:get-download-dir'),
  chooseDownloadDir: () => ipcRenderer.invoke('settings:choose-download-dir'),

  getTheme: () => ipcRenderer.invoke('settings:get-theme'),
  setTheme: (enabled) => ipcRenderer.invoke('settings:set-theme', enabled),
  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', (_e, dark) => cb(dark)),

  getZoom: () => ipcRenderer.invoke('settings:get-zoom'),
  setZoom: (percent) => ipcRenderer.invoke('settings:set-zoom', percent),
  onZoomChanged: (cb) => ipcRenderer.on('zoom:changed', (_e, percent) => cb(percent)),

  onChromeColor: (cb) => ipcRenderer.on('chrome:color', (_e, data) => cb(data)),

  showSettings: () => ipcRenderer.invoke('overlay:show-settings'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  tabPreviewShow: () => ipcRenderer.invoke('overlay:preview-show'),
  tabPreviewHide: () => ipcRenderer.invoke('overlay:preview-hide'),
  toggleLymoChat: () => ipcRenderer.invoke('overlay:toggle-lymochat'),
  hideLymoChat: () => ipcRenderer.invoke('overlay:hide-lymochat'),
  lymochatResizeStart: () => ipcRenderer.invoke('lymochat:resize-start'),
  lymochatResizeMove: (width) => ipcRenderer.invoke('lymochat:resize-move', width),
  lymochatResizeEnd: () => ipcRenderer.invoke('lymochat:resize-end'),
  onOverlayOpen: (cb) => ipcRenderer.on('overlay:open', (_e, data) => cb(data)),
  onLymoChatNotify: (cb) => ipcRenderer.on('lymochat:notify', () => cb())
});
