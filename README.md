# CoreSound

Desktop Bluetooth audio controller for compatible headphones and earbuds, built with Electron and BlueZ.

## What is implemented

- Real Bluetooth scan/connect via BlueZ D-Bus (`dbus-next`)
- Device connect/disconnect
- Device list and active device selection
- Profile-driven mode/EQ command sending over RFCOMM/BLE characteristic write
- Generic IPC write path for custom service/characteristic hex payloads
- Local persistence with `localStorage`
- Responsive desktop layout

## Run

1. Install Node.js 20+.
2. Install dependencies:
   `npm install`
3. Start app:
   `npm start`

## Build

```
npm run dist:linux   # AppImage
npm run dist:win     # zip (x64)
```

Name resolution note:
- Some devices advertise without `localName` and appear as `Unnamed BLE Device`.
- The app resolves names only for the currently connected device by reading GAP name (`0x1800/0x2A00`).
- No background probing/connection attempts are made to other nearby devices.

## Project structure

- `src/main.js`: Electron main process
- `src/preload.js`: Renderer bridge
- `src/bluez-backend.js`: BlueZ D-Bus backend
- `src/renderer/index.html`: UI skeleton
- `src/renderer/styles.css`: UI theme
- `src/renderer/renderer.js`: App state and interactions
- `src/renderer/apk-code-name-map.js`: Device code name mappings

## Next steps

- Map GATT services/characteristics and write commands per device model
- Implement per-model feature maps
- Add firmware update flow
- Port HearID / custom EQ profile logic
- Persist settings per device in a local database

## Bluetooth connection flow

1. Renderer calls `window.coresound.bluetooth.scan()`.
2. Main process starts a Bluetooth scan and returns discovered devices.
3. Clicking a device calls `connect(deviceId)` through IPC.
4. Main process connects and discovers services.
5. Mode/EQ UI is ready for writing commands.

## Command profile

- The app can load profile mappings from `config/command-profile.json`.
- Example template: `config/command-profile.example.json`
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
