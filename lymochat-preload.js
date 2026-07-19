const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the LymoChat window and the main process:
// - newMessage: lights the toolbar chat button's notification dot
// - popup: asks main to show the always-on-top new-message popup;
//   payload: { type, id, otherUid, senderName, preview }
// - onOpenChat: fired when the user clicks the popup, so the page can
//   navigate straight to that conversation
contextBridge.exposeInMainWorld('lymoNotify', {
  newMessage: () => ipcRenderer.send('lymochat:new-message'),
  popup: (payload) => ipcRenderer.send('lymochat:popup', payload),
  onOpenChat: (cb) => ipcRenderer.on('lymochat:open-chat', (_e, payload) => cb(payload)),
  onVisibility: (cb) => ipcRenderer.on('lymochat:visibility', (_e, visible) => cb(visible)),
  getNotifSound: () => ipcRenderer.invoke('lymochat:get-sound'),
  setNotifSound: (enabled) => ipcRenderer.invoke('lymochat:set-sound', enabled)
});
