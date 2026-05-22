const dbus = require('dbus-next');
const { Variant } = dbus;
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { buildDeviceInfoQuery, parseSoundcoreFrames, extractMode } = require('./soundcore-protocol');

function variantValue(v, fallback = null) {
  if (!v || typeof v !== 'object' || !('value' in v)) return fallback;
  return v.value;
}

function parseRssi(v) {
  const value = variantValue(v, null);
  return value === null ? null : Number(value);
}

function normalizeUuid(uuid = '') {
  return String(uuid).toLowerCase().replace(/-/g, '');
}

function normalizeDeviceId(id = '') {
  return String(id).trim().toUpperCase();
}

class BluezBackend extends EventEmitter {
  constructor() {
    super();
    this.bus = dbus.systemBus();
    this.adapterPath = null;
    this.knownDevices = new Map();
    this.connectedDevicePath = null;
    this.connectedDeviceId = null;
    this._rfcommProc = null;
    this._rfcommReady = false;
    this._rfcommQueue = [];
    this._rxBuffer = Buffer.alloc(0);
    this._batteryCache = null;
    this._modeCache = null;
    this._batteryPollTimer = null;
    this._lastInfoQueryAt = 0;
    this._lastProtocolFrameAt = 0;
    this._legacyBatteryPollInFlight = false;
    this._legacyBatteryChannel = 17;
  }

  async _rootManager() {
    const root = await this.bus.getProxyObject('org.bluez', '/');
    return root.getInterface('org.freedesktop.DBus.ObjectManager');
  }

  async _managedObjects() {
    const manager = await this._rootManager();
    return manager.GetManagedObjects();
  }

  async _ensureAdapter() {
    if (this.adapterPath) return this.adapterPath;
    const objects = await this._managedObjects();
    for (const [p, ifaces] of Object.entries(objects)) {
      if (ifaces['org.bluez.Adapter1']) { this.adapterPath = p; return p; }
    }
    throw new Error('No BlueZ adapter found');
  }

  _deviceIdFromProps(p, props = {}) {
    const addr = variantValue(props.Address, null);
    if (addr) return normalizeDeviceId(addr);
    const m = /dev_(.*)$/.exec(p);
    return m ? normalizeDeviceId(m[1].replace(/_/g, ':')) : p;
  }

  _deviceNameFromProps(props = {}) {
    return variantValue(props.Name, null) || variantValue(props.Alias, null) || 'Unknown Device';
  }

  _inferFormFactor(name = '') {
    const n = String(name || '').toLowerCase();
    if (/(q\d{2}\b|life q|space one|headphone)/i.test(n)) return 'over-ear';
    if (/(liberty|earbud|a3\d{3}|a39\d{2}|p3i|a40|a30i|a20i)/i.test(n)) return 'in-ear';
    return 'unknown';
  }

  _deviceRecord(p, props = {}, batteryProps = null) {
    const name = this._deviceNameFromProps(props);
    const bluezBatteryPercent = batteryProps ? variantValue(batteryProps.Percentage, null) : null;
    const formFactor = this._inferFormFactor(name);
    return {
      id: this._deviceIdFromProps(p, props),
      name,
      rssi: parseRssi(props.RSSI),
      connected: Boolean(variantValue(props.Connected, false)),
      formFactor,
      bluezBatteryPercent: bluezBatteryPercent == null ? null : Number(bluezBatteryPercent),
      path: p
    };
  }

  async _refreshDevices() {
    const adapterPath = await this._ensureAdapter();
    const objects = await this._managedObjects();
    const next = new Map();
    for (const [p, ifaces] of Object.entries(objects)) {
      const dev = ifaces['org.bluez.Device1'];
      if (!dev || !p.startsWith(`${adapterPath}/dev_`)) continue;
      const battery = ifaces['org.bluez.Battery1'] || null;
      const record = this._deviceRecord(p, dev, battery);
      next.set(record.id, record);
    }
    this.knownDevices = next;
    return next;
  }

  async _adapterInterface() {
    const adapterPath = await this._ensureAdapter();
    const obj = await this.bus.getProxyObject('org.bluez', adapterPath);
    return obj.getInterface('org.bluez.Adapter1');
  }

  async getState() {
    const adapterPath = await this._ensureAdapter();
    const obj = await this.bus.getProxyObject('org.bluez', adapterPath);
    const props = obj.getInterface('org.freedesktop.DBus.Properties');
    const powered = await props.Get('org.bluez.Adapter1', 'Powered');
    return powered.value ? 'poweredOn' : 'poweredOff';
  }

  async scan(durationMs = 6000) {
    const adapter = await this._adapterInterface();
    try {
      // BR/EDR scan to find Soundcore classic BT devices
      await adapter.SetDiscoveryFilter({ Transport: new Variant('s', 'bredr') });
    } catch (_) {}
    await adapter.StartDiscovery();
    await new Promise((r) => setTimeout(r, durationMs));
    await adapter.StopDiscovery();
    const devices = await this._refreshDevices();
    return Array.from(devices.values()).map(({ path: _p, ...d }) => d);
  }

  async getConnectedDevices() {
    const devices = await this._refreshDevices();
    return Array.from(devices.values())
      .filter((d) => d && d.connected)
      .map(({ path: _p, ...d }) => d);
  }

  async _resolveDevice(deviceId) {
    if (!this.knownDevices.size) await this._refreshDevices();
    let rec = this.knownDevices.get(deviceId);
    if (!rec) { await this._refreshDevices(); rec = this.knownDevices.get(deviceId); }
    if (!rec) throw new Error('Device not found. Scan again.');
    return rec;
  }

  async _deviceInterface(devicePath) {
    const obj = await this.bus.getProxyObject('org.bluez', devicePath);
    return obj.getInterface('org.bluez.Device1');
  }

  async _devicePropertiesInterface(devicePath) {
    const obj = await this.bus.getProxyObject('org.bluez', devicePath);
    return obj.getInterface('org.freedesktop.DBus.Properties');
  }

  async _isBluezConnected(devicePath) {
    try {
      const props = await this._devicePropertiesInterface(devicePath);
      const connected = await props.Get('org.bluez.Device1', 'Connected');
      return Boolean(connected.value);
    } catch {
      return false;
    }
  }

  async _waitBluezConnected(devicePath, desired, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this._isBluezConnected(devicePath);
      if (ok === desired) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  async _ensureBluezDeviceConnected(devicePath) {
    if (await this._isBluezConnected(devicePath)) return;
    const device = await this._deviceInterface(devicePath);
    await device.Connect();
    const ok = await this._waitBluezConnected(devicePath, true, 8000);
    if (!ok) throw new Error('BlueZ device link did not come up in time.');
  }

  async _forceBluezReconnect(devicePath) {
    const device = await this._deviceInterface(devicePath);
    try { await device.Disconnect(); } catch {}
    await this._waitBluezConnected(devicePath, false, 4000).catch(() => false);
    await new Promise(r => setTimeout(r, 350));
    await device.Connect();
    const ok = await this._waitBluezConnected(devicePath, true, 9000);
    if (!ok) throw new Error('BlueZ reconnect failed.');
  }

  // Open RFCOMM connection via Python helper subprocess
  _openRfcomm(mac, channel = 15) {
    return new Promise((resolve, reject) => {
      const helperPath = path.join(__dirname, 'rfcomm-helper.py');
      const proc = spawn('python3', [helperPath, mac, String(channel)], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let settled = false;

      proc.stdout.setEncoding('utf8');
      let buf = '';
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (!settled) {
            if (msg.type === 'connected') {
              settled = true;
              this._rxBuffer = Buffer.alloc(0);
              this._rfcommProc = proc;
              this._rfcommReady = true;
              for (const hex of this._rfcommQueue) this._sendRfcomm(hex);
              this._rfcommQueue = [];
              // Device sends a 01:7F ready signal before it's ready for queries.
              // _handleSoundcoreFrame will send the info query on that signal.
              // Fallback: if device skips the ready signal, query after 2s anyway.
              this._queryTimer = setTimeout(() => {
                if (this._rfcommReady && !this._batteryCache) {
                  console.log('[soundcore] fallback: sending device info query');
                  try { this._sendRfcomm(buildDeviceInfoQuery().toString('hex')); } catch {}
                }
              }, 2000);
              resolve(proc);
            } else if (msg.type === 'error') {
              settled = true;
              reject(new Error(msg.message));
            }
          } else {
            if (msg.type === 'disconnected') console.error('[rfcomm] socket disconnected');
            else if (msg.type === 'data') this._onRfcommData(msg.hex);
            else if (msg.type === 'error') console.error('[rfcomm] error:', msg.message);
          }
        }
      });

      proc.stderr.on('data', (d) => console.error('[rfcomm]', d.toString().trim()));

      proc.on('close', (code) => {
        this._rfcommProc = null;
        this._rfcommReady = false;
        console.error(`[rfcomm] process exited (code ${code})`);
        if (!settled) { settled = true; reject(new Error(`rfcomm-helper exited (${code})`)); }
      });

      setTimeout(() => {
        if (!settled) { settled = true; proc.kill(); reject(new Error('RFCOMM connect timeout')); }
      }, 12000);
    });
  }

  // Try ch15 first; if refused scan fallback channels (multipoint mode may use a different channel)
  async _openRfcommAny(mac) {
    const priority = [15, 16, 17, 19, 20, 12, 13, 14];
    const candidates = [];
    const seen = new Set();
    for (const ch of priority) {
      if (ch < 1 || ch > 30 || seen.has(ch)) continue;
      seen.add(ch);
      candidates.push(ch);
    }
    for (let ch = 1; ch <= 30; ch++) {
      if (seen.has(ch)) continue;
      candidates.push(ch);
    }
    console.log(`[bluez] RFCOMM channel sweep: ${candidates.join(',')}`);
    let lastErr;
    for (const ch of candidates) {
      try {
        await this._openRfcomm(mac, ch);
        const probeStart = Date.now();
        // Probe this channel: Soundcore control channel should answer quickly.
        for (let i = 0; i < 3; i++) {
          try { this._sendRfcomm(buildDeviceInfoQuery().toString('hex')); } catch {}
          await new Promise(r => setTimeout(r, 750));
          if (this._lastProtocolFrameAt > probeStart) {
            console.log(`[bluez] RFCOMM protocol confirmed on ch${ch}`);
            return;
          }
        }
        // Connected but wrong/silent channel.
        try { this._rfcommProc?.stdin.write(JSON.stringify({ type: 'close' }) + '\n'); } catch {}
        this._rfcommProc = null;
        this._rfcommReady = false;
        throw new Error('RFCOMM channel connected but no Soundcore protocol response');
      } catch (err) {
        const msg = String(err.message || err);
        const refused =
          msg.includes('Connection refused') ||
          msg.includes('111') ||
          msg.includes('Connection reset by peer') ||
          msg.includes('Errno 104') ||
          msg.includes('Host is down') ||
          msg.includes('Errno 112');
        const silentWrong = msg.includes('no Soundcore protocol response');
        if (!refused && !silentWrong) throw err;
        if (silentWrong) console.warn(`[bluez] ch${ch} connected but silent for protocol`);
        else console.warn(`[bluez] ch${ch} rejected (${msg})`);
        lastErr = err;
      }
    }
    if (lastErr && String(lastErr.message || lastErr).includes('no Soundcore protocol response')) {
      throw new Error(
        'RFCOMM connected but no Soundcore control response on tested channels. ' +
        'Device may be busy with another host or in incompatible mode.'
      );
    }
    throw new Error(
      'All RFCOMM channels refused. If multipoint mode is on and your phone is connected, ' +
      'disconnect from your phone first or disable multipoint mode, then try again.'
    );
  }

  _requestDeviceInfo(force = false) {
    const now = Date.now();
    if (!force && now - this._lastInfoQueryAt < 2000) return;
    if (!this._rfcommReady || !this.connectedDeviceId) return;
    this._lastInfoQueryAt = now;
    console.log(`[soundcore] tx device-info query (force=${force}) for ${this.connectedDeviceId}`);
    try { this._sendRfcomm(buildDeviceInfoQuery().toString('hex')); } catch {}
  }

  _startBatteryPolling() {
    if (this._batteryPollTimer) clearInterval(this._batteryPollTimer);
    this._batteryPollTimer = setInterval(async () => {
      await this._refreshDevices().catch(() => {});
      this._emitBluezBatteryIfAvailable();
      this._requestDeviceInfo(false);
      this._pollLegacyBatteryOnce(false).catch(() => {});
    }, 60000);
  }

  _sendRfcomm(hex) {
    if (!this._rfcommProc) throw new Error('No RFCOMM connection');
    this._rfcommProc.stdin.write(JSON.stringify({ type: 'write', hex }) + '\n');
  }

  _parseLegacyShortFrames(buf) {
    const frames = [];
    let i = 0;
    while (i + 4 <= buf.length) {
      const cat = buf[i];
      const type = buf[i + 1];
      const sep = buf[i + 2];
      const len = buf[i + 3];
      if (sep !== 0x00 || len > 64) { i++; continue; }
      if (i + 4 + len > buf.length) break;
      const payload = buf.slice(i + 4, i + 4 + len);
      frames.push({ cat, type, payload });
      i += 4 + len;
    }
    return frames;
  }

  _extractLegacyBattery(frames) {
    // Observed on this device family:
    // 03 03 00 03 <left> <right> <case>  e.g. 50 50 64 -> 80/80/100
    for (const f of frames) {
      if (f.cat !== 0x03 || f.type !== 0x03 || f.payload.length !== 3) continue;
      const [left, right, casePct] = f.payload;
      const valid = [left, right, casePct].every(v => v >= 0 && v <= 100);
      if (!valid) continue;
      return { left, right, case: casePct, source: `legacy_ch${this._legacyBatteryChannel}` };
    }
    return null;
  }

  _connectedDeviceName() {
    if (!this.connectedDeviceId) return '';
    const rec = this.knownDevices.get(this.connectedDeviceId);
    return (rec?.name || '').toLowerCase();
  }

  _isConnectedSingleBatteryDevice() {
    if (!this.connectedDeviceId) return false;
    const rec = this.knownDevices.get(this.connectedDeviceId);
    if (rec?.formFactor === 'over-ear') return true;
    return this._isSingleBatteryDeviceName(rec?.name || '');
  }

  _isSingleBatteryDeviceName(name) {
    // Over-ear / single-pack battery families.
    return /(q\d{2}\b|life q|space one|headphone)/i.test(name || '');
  }

  _emitBluezBatteryIfAvailable() {
    if (!this.connectedDeviceId) return null;
    if (!this._isConnectedSingleBatteryDevice()) return null;
    const rec = this.knownDevices.get(this.connectedDeviceId);
    const pct = rec?.bluezBatteryPercent;
    if (pct == null || Number.isNaN(Number(pct))) return null;
    const batt = { single: Number(pct), source: 'bluez_battery1' };
    this._batteryCache = batt;
    this.emit('battery', { deviceId: this.connectedDeviceId, battery: batt });
    return batt;
  }

  _normalizeBatteryForDevice(batt) {
    if (!batt) return null;
    if (this._isConnectedSingleBatteryDevice()) {
      // For single-battery devices, prefer BlueZ Battery1. Protocol-derived case-only
      // fields are often static config bytes and should not be trusted.
      const fromBluez = this._emitBluezBatteryIfAvailable();
      if (fromBluez) return fromBluez;
      return null;
    }
    const hasLeft = batt.left != null;
    const hasRight = batt.right != null;
    if (hasLeft && hasRight) return { left: batt.left, right: batt.right, case: batt.case ?? null, source: batt.source };

    // Treat unresolved case-only values as untrusted on TWS devices.
    return null;
  }

  async _pollLegacyBatteryOnce(force = false) {
    if (!this.connectedDeviceId) return null;
    if (this._isConnectedSingleBatteryDevice()) return null;
    if (!force && this._legacyBatteryPollInFlight) return null;
    this._legacyBatteryPollInFlight = true;
    const mac = this.connectedDeviceId;
    const channel = this._legacyBatteryChannel;

    try {
      const helperPath = path.join(__dirname, 'rfcomm-helper.py');
      const proc = spawn('python3', [helperPath, mac, String(channel)], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let settled = false;
      let stdoutBuf = '';
      let raw = Buffer.alloc(0);

      const finish = (result) => {
        if (settled) return;
        settled = true;
        try { proc.kill(); } catch {}
        this._legacyBatteryPollInFlight = false;
        return result;
      };

      return await new Promise((resolve) => {
        const done = (res) => resolve(finish(res));

        const timeout = setTimeout(() => done(null), 9000);

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => {
          stdoutBuf += chunk;
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }

            if (msg.type === 'connected') {
              try { proc.stdin.write(JSON.stringify({ type: 'write', hex: buildDeviceInfoQuery().toString('hex') }) + '\n'); } catch {}
              setTimeout(() => {
                try { proc.stdin.write(JSON.stringify({ type: 'close' }) + '\n'); } catch {}
              }, 1200);
            } else if (msg.type === 'data' && msg.hex) {
              try { raw = Buffer.concat([raw, Buffer.from(msg.hex, 'hex')]); } catch {}
            } else if (msg.type === 'error') {
              clearTimeout(timeout);
              done(null);
            }
          }
        });

        proc.on('close', () => {
          clearTimeout(timeout);
          const frames = this._parseLegacyShortFrames(raw);
          const batt = this._extractLegacyBattery(frames);
          if (batt) {
            console.log('[soundcore] legacy battery result:', batt);
            this._batteryCache = batt;
            this.emit('battery', { deviceId: this.connectedDeviceId, battery: batt });
          }
          done(batt || null);
        });
      });
    } catch {
      this._legacyBatteryPollInFlight = false;
      return null;
    }
  }

  async connect(deviceId) {
    const target = await this._resolveDevice(deviceId);

    // Already connected and RFCOMM ready: reuse current session.
    if (this.connectedDevicePath === target.path && this._rfcommReady) {
      await this._refreshDevices();
      const rec = this.knownDevices.get(target.id) || target;
      return { device: this._toPublicDevice(rec) };
    }

    if (this.connectedDevicePath && this.connectedDevicePath !== target.path) {
      await this.disconnectSession();
    }

    await this._ensureBluezDeviceConnected(target.path);
    try {
      await this._openRfcommAny(target.id);
    } catch (err) {
      const msg = String(err?.message || err);
      const transportStale =
        msg.includes('Host is down') ||
        msg.includes('Errno 112') ||
        msg.includes('Connection reset by peer') ||
        msg.includes('Errno 104');
      if (!transportStale) throw err;
      console.warn('[bluez] RFCOMM stale transport; forcing BlueZ reconnect and retrying once');
      await this.disconnectSession();
      await this._forceBluezReconnect(target.path);
      await this._openRfcommAny(target.id);
    }

    this.connectedDevicePath = target.path;
    this.connectedDeviceId = target.id;
    this._requestDeviceInfo(true);
    this._pollLegacyBatteryOnce(true).catch(() => {});
    this._startBatteryPolling();

    await this._refreshDevices();
    this._emitBluezBatteryIfAvailable();
    const rec = this.knownDevices.get(target.id) || target;
    return { device: this._toPublicDevice(rec) };
  }

  _toPublicDevice(record) {
    const { path: _p, ...d } = record;
    return d;
  }

  async disconnectSession() {
    if (this._queryTimer) { clearTimeout(this._queryTimer); this._queryTimer = null; }
    if (this._batteryPollTimer) { clearInterval(this._batteryPollTimer); this._batteryPollTimer = null; }
    if (this._rfcommProc) {
      try { this._rfcommProc.stdin.write(JSON.stringify({ type: 'close' }) + '\n'); } catch {}
      this._rfcommProc = null;
      this._rfcommReady = false;
    }

    const id = this.connectedDeviceId;
    this.connectedDevicePath = null;
    this.connectedDeviceId = null;
    this._batteryCache = null;
    this._modeCache = null;
    this._lastInfoQueryAt = 0;
    this._rxBuffer = Buffer.alloc(0);
    await this._refreshDevices();
    return { disconnected: Boolean(id), id };
  }

  async disconnect() {
    const path = this.connectedDevicePath;
    const id = this.connectedDeviceId;
    await this.disconnectSession();
    if (!path) return { disconnected: false };

    const device = await this._deviceInterface(path);
    try { await device.Disconnect(); } catch {}
    await this._refreshDevices();
    return { disconnected: true, id };
  }

  async write(hexString) {
    if (!this.connectedDevicePath) throw new Error('No connected device');
    const hex = hexString.replace(/\s+/g, '').toLowerCase();
    if (!this._rfcommReady) {
      if (!this._rfcommProc) throw new Error('RFCOMM not connected. Reconnect the device.');
      this._rfcommQueue.push(hex);
    } else {
      this._sendRfcomm(hex);
    }
    return { ok: true, bytes: hex.length / 2 };
  }

  async getConnectedDevice() {
    await this._refreshDevices();
    if (!this.connectedDeviceId) return null;
    const rec = this.knownDevices.get(this.connectedDeviceId);
    return rec ? this._toPublicDevice(rec) : null;
  }

  _onRfcommData(hexStr) {
    console.log('[soundcore] rx raw:', hexStr.slice(0, 80));
    this._rxBuffer = Buffer.concat([this._rxBuffer, Buffer.from(hexStr, 'hex')]);
    const { frames, remaining } = parseSoundcoreFrames(this._rxBuffer);
    this._rxBuffer = remaining;
    for (const { cat, type, payload } of frames) this._handleSoundcoreFrame(cat, type, payload);
  }

  _handleSoundcoreFrame(cat, type, payload) {
    this._lastProtocolFrameAt = Date.now();
    const c = cat.toString(16).padStart(2, '0');
    const t = type.toString(16).padStart(2, '0');
    console.log(`[soundcore] frame 0x${c}:0x${t} len=${payload.length}`);

    if (cat === 0x01 && type === 0x7F) {
      // Device ready — now safe to request device info
      console.log('[soundcore] device ready signal, sending info query');
      this._requestDeviceInfo(true);
    } else if (cat === 0x06 && type === 0x01) {
      const mode = extractMode(payload);
      if (mode) { this._modeCache = mode; this.emit('mode', mode); }
    }
  }

  getBattery() {
    this._requestDeviceInfo(false);
    return this._batteryCache;
  }

  async resolveConnectedName() {
    const connected = await this.getConnectedDevice();
    if (!connected) throw new Error('No connected device. Connect first, then resolve name.');
    if (!connected.name || connected.name === 'Unknown Device') {
      throw new Error('Connected device did not expose a resolvable name.');
    }
    return { id: connected.id, name: connected.name };
  }
}

module.exports = { BluezBackend, normalizeUuid };
