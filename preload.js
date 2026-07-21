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
  onTabOrder: (cb) => ipcRenderer.on('tab:order', (_e, order) => cb(order)),
  reorderTabs: (orderedIds) => ipcRenderer.invoke('tabs:reorder', orderedIds),
  showTabContextMenu: (id) => ipcRenderer.invoke('tabs:context-menu', id),
  showSidebarContextMenu: () => ipcRenderer.invoke('sidebar:context-menu'),
  toggleTabMute: (id) => ipcRenderer.invoke('tabs:toggle-mute', id),

  exitSplitView: () => ipcRenderer.invoke('split:exit'),
  onSplitChanged: (cb) => ipcRenderer.on('split:changed', (_e, data) => cb(data)),

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

  getAccentColor: () => ipcRenderer.invoke('settings:get-accent-color'),
  setAccentColor: (color) => ipcRenderer.invoke('settings:set-accent-color', color),
  onAccentColorChanged: (cb) => ipcRenderer.on('accent:changed', (_e, color) => cb(color)),

  getZoom: () => ipcRenderer.invoke('settings:get-zoom'),
  setZoom: (percent) => ipcRenderer.invoke('settings:set-zoom', percent),
  onZoomChanged: (cb) => ipcRenderer.on('zoom:changed', (_e, percent) => cb(percent)),

  getStyle: () => ipcRenderer.invoke('settings:get-style'),
  setStyle: (style) => ipcRenderer.invoke('settings:set-style', style),
  onStyleChanged: (cb) => ipcRenderer.on('style:changed', (_e, style) => cb(style)),

  getShortcuts: () => ipcRenderer.invoke('settings:get-shortcuts'),
  addShortcut: (name, url) => ipcRenderer.invoke('settings:add-shortcut', { name, url }),
  updateShortcut: (id, name, url) => ipcRenderer.invoke('settings:update-shortcut', { id, name, url }),
  deleteShortcut: (id) => ipcRenderer.invoke('settings:delete-shortcut', id),
  reorderShortcuts: (orderedIds) => ipcRenderer.invoke('settings:reorder-shortcuts', orderedIds),
  onShortcutsChanged: (cb) => ipcRenderer.on('shortcuts:changed', (_e, list) => cb(list)),

  getBookmarks: () => ipcRenderer.invoke('bookmarks:get-all'),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks:is-bookmarked', url),
  addBookmark: (name, url, folderId) => ipcRenderer.invoke('bookmarks:add', { name, url, folderId }),
  updateBookmark: (id, name, url, folderId) => ipcRenderer.invoke('bookmarks:update', { id, name, url, folderId }),
  deleteBookmark: (id) => ipcRenderer.invoke('bookmarks:delete', id),
  deleteBookmarkByUrl: (url) => ipcRenderer.invoke('bookmarks:delete-by-url', url),
  addBookmarkFolder: (name) => ipcRenderer.invoke('bookmarks:add-folder', name),
  renameBookmarkFolder: (id, name) => ipcRenderer.invoke('bookmarks:rename-folder', { id, name }),
  deleteBookmarkFolder: (id) => ipcRenderer.invoke('bookmarks:delete-folder', id),
  onBookmarksChanged: (cb) => ipcRenderer.on('bookmarks:changed', (_e, data) => cb(data)),
  showBookmarkPicker: (url, title) => ipcRenderer.invoke('overlay:show-bookmark-picker', { url, title }),

  onChromeColor: (cb) => ipcRenderer.on('chrome:color', (_e, data) => cb(data)),

  onAddressBarFocus: (cb) => ipcRenderer.on('address-bar:focus', () => cb()),

  findQuery: (text, forward, findNext) => ipcRenderer.invoke('find:query', { text, forward, findNext }),
  closeFind: () => ipcRenderer.invoke('find:stop'),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, data) => cb(data)),

  showAutocomplete: (query, rect) => ipcRenderer.invoke('autocomplete:show', { query, rect }),
  hideAutocomplete: () => ipcRenderer.invoke('autocomplete:hide'),
  highlightAutocomplete: (index) => ipcRenderer.send('autocomplete:highlight', index),
  onAutocompleteData: (cb) => ipcRenderer.on('autocomplete:data', (_e, results) => cb(results)),
  onAutocompleteHighlight: (cb) => ipcRenderer.on('autocomplete:highlight', (_e, index) => cb(index)),

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
