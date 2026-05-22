const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("soundcoreDesktop", {
  platform: process.platform,
  bluetooth: {
    getState: () => ipcRenderer.invoke("ble:get-state"),
    scan: () => ipcRenderer.invoke("ble:scan"),
    getConnectedDevices: () => ipcRenderer.invoke("ble:get-connected-devices"),
    connect: (deviceId) => ipcRenderer.invoke("ble:connect", deviceId),
    disconnectSession: () => ipcRenderer.invoke("ble:disconnect-session"),
    disconnect: () => ipcRenderer.invoke("ble:disconnect"),
    getConnectedDevice: () => ipcRenderer.invoke("ble:get-connected-device"),
    resolveConnectedName: () => ipcRenderer.invoke("ble:resolve-connected-name"),
    write: (payload) => ipcRenderer.invoke("ble:write", payload),
    getProfile: () => ipcRenderer.invoke("ble:profile:get"),
    updateProfile: (profile) => ipcRenderer.invoke("ble:profile:update", profile),
    sendModeCommand: (mode, ancScene, windEnabled) => ipcRenderer.invoke("ble:command:mode", { mode, ancScene, windEnabled }),
    sendEqCommand: (eq, bands) => ipcRenderer.invoke("ble:command:eq", eq, bands),
    sendDolbyCommand: (enabled, currentPresetId) => ipcRenderer.invoke("ble:command:dolby", enabled, currentPresetId),
    getBattery: () => ipcRenderer.invoke("ble:get-battery"),
    onBattery:      (cb) => ipcRenderer.on("battery-update", (_, d) => cb(d)),
    onModeUpdate:   (cb) => ipcRenderer.on("mode-update",    (_, d) => cb(d)),
    openBtSettings: ()   => ipcRenderer.invoke("shell:open-bt-settings"),
  }
});
