const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopConfig", {
  get: () => ipcRenderer.invoke("desktop-config:get"),
  set: (serverUrl) => ipcRenderer.invoke("desktop-config:set", { serverUrl }),
  retry: () => ipcRenderer.invoke("desktop-app:retry"),
  openFolder: () => ipcRenderer.invoke("desktop-config:open-folder")
});
