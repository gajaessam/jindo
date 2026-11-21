'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jindoTrack', {
  getState: () => ipcRenderer.invoke('track:state'),
  getImage: (idx) => ipcRenderer.invoke('track:image', idx),
  onState: (cb) => ipcRenderer.on('track:state', (_e, state) => cb(state)),
  setInteractive: (on) => ipcRenderer.send('track:interactive', Boolean(on)),
  click: (idx, rect) => ipcRenderer.send('track:click', idx, rect),
  context: (idx, rect) => ipcRenderer.send('track:context', idx, rect),
  pickImage: (idx) => ipcRenderer.send('track:pick-image', idx),
  press: () => ipcRenderer.send('track:press'),
  flag: () => ipcRenderer.send('track:flag'),
  hintSeen: (kind) => ipcRenderer.send('track:hint-seen', String(kind)),
  updateOpen: () => ipcRenderer.send('track:update-open'),
  updateDismiss: () => ipcRenderer.send('track:update-dismiss'),
  onRectRequest: (cb) => ipcRenderer.on('track:rect-request', (_e, idx) => cb(idx)),
  sendRect: (idx, rect) => ipcRenderer.send('track:rect', idx, rect),
  imageFailed: (idx, message) => ipcRenderer.send('track:image-failed', idx, message),
});
