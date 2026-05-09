# Soundcore PC (MVP)

Desktop starter app inspired by the Soundcore Android app flow.

## What is implemented

- Real BLE scan/connect in Electron main process via BlueZ D-Bus (`dbus-next`)
- Device connect/disconnect
- Device list and active device selection
- Profile-driven mode/EQ command sending over BLE characteristic write
- Generic IPC write path for custom service/characteristic hex payloads
- Local persistence with `localStorage`
- Responsive desktop layout

## Run

1. Install Node.js 20+.
2. Install dependencies:
   `npm install`
3. Start app:
   `npm start`

Name resolution note:
- Some devices advertise without `localName` and appear as `Unnamed BLE Device`.
- The app resolves names only for the currently connected device by reading GAP name (`0x1800/0x2A00`).
- No background probing/connection attempts are made to other nearby devices.

## Project structure

- `src/main.js`: Electron main process
- `src/preload.js`: Renderer bridge
- `src/renderer/index.html`: UI skeleton
- `src/renderer/styles.css`: UI theme
- `src/renderer/renderer.js`: App state and interactions

## Next steps for Android parity

- Map Soundcore GATT services/characteristics and write commands
- Implement per-model feature maps
- Add firmware update flow
- Port HearID / custom EQ profile logic
- Persist settings per device in a local database

## BLE connection flow

1. Renderer calls `window.soundcoreDesktop.bluetooth.scan()`.
2. Main process starts BLE scan and returns discovered devices.
3. Clicking a device calls `connect(deviceId)` through IPC.
4. Main process connects and discovers services.
5. Mode/EQ UI is ready; the next step is writing real bytes to Soundcore characteristics.

## Command profile

- The app can load profile mappings from `config/soundcore-command-profile.json`.
- Example template: `config/soundcore-command-profile.example.json`
- Required per command:
  - `serviceUuid`
  - `characteristicUuid`
  - `valueHex`
  - `withResponse` (boolean)

If a mapping is missing, mode/EQ actions will fail with a clear error in the UI status line.

## Windows notes

- Bluetooth must be enabled.
- Target device should be in pairing mode.
- Some devices expose control only after OS-level pairing.
