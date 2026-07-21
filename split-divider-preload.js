const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the small draggable divider between the two split-view panes.
contextBridge.exposeInMainWorld('splitDivider', {
  dragStart: () => ipcRenderer.invoke('split:resize-start'),
  dragMove: (ratio) => ipcRenderer.invoke('split:resize-move', ratio),
  dragEnd: () => ipcRenderer.invoke('split:resize-end'),
  onContext: (cb) => ipcRenderer.on('split-divider:context', (_e, data) => cb(data))
});
