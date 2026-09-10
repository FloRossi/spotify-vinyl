const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  setHideWelcome: () => ipcRenderer.send('set-hide-welcome'),
  toggleWidgetMode: () => ipcRenderer.send('toggle-widget-mode'),
  toggleMoveMode: () => ipcRenderer.send('toggle-move-mode'),
  getWidgetMoveMode: () => ipcRenderer.invoke('get-widget-move-mode'),
  onWidgetMoveMode: (callback) => ipcRenderer.on('widget-move-mode', (event, value) => callback(value)),
  setupComplete: (data) => ipcRenderer.send('setup-complete', data),
  getSetupInfo: () => ipcRenderer.invoke('get-setup-info'),
  checkPort: (port) => ipcRenderer.invoke('check-port', port),
  setDockVisibility: (visible) => ipcRenderer.send('set-dock-visibility', visible)
});