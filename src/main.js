const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { BluezBackend } = require('./bluez-backend');
const { buildModeCommand, buildEqCommand, buildCustomEqCommand, buildDolbyCommand } = require('./soundcore-protocol');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

const ble = new BluezBackend();
let win = null;

function createWindow() {
  const windowIcon =
    process.platform === 'win32'
      ? path.join(__dirname, 'renderer', 'assets', 'windows-icons', 'icon.ico')
      : process.platform === 'linux'
        ? path.join(__dirname, 'renderer', 'assets', 'linux-icons', '256x256.png')
        : undefined;
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'CoreSound',
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ble.on('battery', batteryData => { if (win) win.webContents.send('battery-update', batteryData); });
ble.on('mode',    modeData => { if (win) win.webContents.send('mode-update', modeData); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.handle('ble:get-state', () => ble.getState());
  ipcMain.handle('ble:scan', async () => ble.scan());
  ipcMain.handle('ble:get-connected-devices', async () => ble.getConnectedDevices());
  ipcMain.handle('ble:connect', async (_e, deviceId) => ble.connect(deviceId));
  ipcMain.handle('ble:disconnect-session', async () => ble.disconnectSession());
  ipcMain.handle('ble:disconnect', async () => ble.disconnect());
  ipcMain.handle('ble:get-connected-device', async () => ble.getConnectedDevice());
  ipcMain.handle('ble:resolve-connected-name', async () => ble.resolveConnectedName());
  ipcMain.handle('ble:write', async (_e, payload) => ble.write(payload.valueHex || payload));

  ipcMain.handle('ble:command:mode', async (_e, params) => {
    const { mode, ancScene, windEnabled } = typeof params === 'string'
      ? { mode: params }
      : params;
    const cmd = buildModeCommand(mode, ancScene, undefined, windEnabled);
    return ble.write(cmd.toString('hex'));
  });

  ipcMain.handle('ble:get-battery', () => ble.getBattery());
  ipcMain.handle('shell:open-bt-settings', () => {
    const { exec } = require('child_process');
    exec('kcmshell6 kcm_bluetooth || kcmshell5 kcm_bluetooth || gnome-control-center bluetooth');
  });

  // Profile stubs — kept so renderer doesn't throw on load
  ipcMain.handle('ble:profile:get', () => ({}));
  ipcMain.handle('ble:profile:update', () => ({}));
  ipcMain.handle('ble:command:eq', async (_e, presetId, bands) => {
    const packet = Array.isArray(bands)
      ? buildCustomEqCommand(bands)
      : buildEqCommand(presetId);
    return ble.write(packet.toString('hex'));
  });

  ipcMain.handle('ble:command:dolby', async (_e, enabled, currentPresetId) => {
    if (enabled) {
      return ble.write(buildDolbyCommand().toString('hex'));
    } else {
      return ble.write(buildEqCommand(currentPresetId ?? 0).toString('hex'));
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Check for updates after window is ready
  app.on('browser-window-created', (_, w) => {
    w.webContents.once('did-finish-load', () => {
      autoUpdater.checkForUpdates().catch(() => {});
    });
  });

  autoUpdater.on('update-available', (info) => {
    if (win) win.webContents.send('update-available', info.version);
  });

  ipcMain.handle('updater:download', () => {
    shell.openExternal('https://github.com/CriticalRange/CoreSound/releases/latest');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
