const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { buildDeviceInfoQuery, parseSoundcoreFrames, extractBattery, extractMode, extractDeviceInfo } = require('./device-protocol');

function resolveUnpacked(filePath) {
  return filePath.replace('app.asar', 'app.asar.unpacked');
}

function normalizeDeviceId(id = '') {
  return String(id).trim().toUpperCase();
}

function parseMacFromInstanceId(instanceId = '') {
  // BTHENUM\DEV_AABBCCDDEEFF\... or similar
  const m = /DEV_([0-9A-Fa-f]{12})/i.exec(instanceId);
  if (!m) return null;
  return m[1].toUpperCase().match(/.{2}/g).join(':');
}

function inferFormFactor(name = '') {
  const n = String(name || '').toLowerCase();
  if (/(q\d{2}\b|life q|space one|headphone)/i.test(n)) return 'over-ear';
  if (/(liberty|earbud|a3\d{3}|a39\d{2}|p3i|a40|a30i|a20i)/i.test(n)) return 'in-ear';
  return 'unknown';
}

class WindowsBackend extends EventEmitter {
  constructor() {
    super();
    this.knownDevices = new Map();
    this.connectedDeviceId = null;
    this._rfcommProc = null;
    this._rfcommReady = false;
    this._rfcommQueue = [];
    this._rxBuffer = Buffer.alloc(0);
    this._batteryCache = null;
    this._modeCache = null;
    this._batteryPollTimer = null;
    this._queryTimer = null;
    this._lastInfoQueryAt = 0;
    this._lastProtocolFrameAt = 0;
    this._legacyBatteryPollInFlight = false;
    this._legacyBatteryChannel = 17;
    this._deviceInfoCache = null;
  }

  async getState() {
    return new Promise((resolve) => {
      const ps = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        '(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Measure-Object).Count'
      ]);
      let out = '';
      ps.stdout.on('data', d => { out += d; });
      ps.on('close', () => {
        resolve(parseInt(out.trim(), 10) > 0 ? 'poweredOn' : 'poweredOff');
      });
      ps.on('error', () => resolve('poweredOn'));
    });
  }

  async _listPairedDevices() {
    return new Promise((resolve) => {
      // Simple single-line command — avoid complex where-clauses that can fail silently.
      // Windows creates multiple PnP nodes per device (one per adapter instance), so we
      // deduplicate by MAC and prefer the Status=OK entry to mark as connected.
      const ps = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object FriendlyName,InstanceId,Status | ConvertTo-Json -Compress -Depth 1'
      ]);
      let out = '';
      ps.stdout.on('data', d => { out += d; });
      ps.stderr.on('data', d => { console.error('[windows-bt]', d.toString().trim()); });
      ps.on('close', () => {
        try {
          const text = out.trim();
          if (!text) return resolve([]);
          const raw = JSON.parse(text);
          const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
          // Build set of MACs that have AVRCP service entries — only audio devices get these.
          // InstanceId ends with <12-hex-MAC>_C00000000 for AVRCP service nodes.
          const avrcpMacs = new Set();
          for (const d of items) {
            const id = d.InstanceId || '';
            if (!id.includes('{0000110C-') && !id.includes('{0000110E-')) continue;
            const m = /([0-9A-Fa-f]{12})_C00000000$/i.exec(id);
            if (m) avrcpMacs.add(m[1].toUpperCase());
          }

          // Deduplicate DEV_ entries by MAC, prefer Status=OK, keep only AVRCP-capable devices.
          const byMac = new Map();
          for (const d of items) {
            const mac = parseMacFromInstanceId(d.InstanceId || '');
            if (!mac) continue;
            if (!avrcpMacs.has(mac.replace(/:/g, ''))) continue;
            const existing = byMac.get(mac);
            if (!existing || d.Status === 'OK') {
              byMac.set(mac, {
                id: normalizeDeviceId(mac),
                name: d.FriendlyName || 'Unknown Device',
                connected: d.Status === 'OK',
                rssi: null,
                formFactor: inferFormFactor(d.FriendlyName || '')
              });
            }
          }
          resolve(Array.from(byMac.values()));
        } catch (e) {
          console.error('[windows-bt] parse error:', e);
          resolve([]);
        }
      });
      ps.on('error', (e) => { console.error('[windows-bt] spawn error:', e); resolve([]); });
    });
  }

  async scan() {
    const devices = await this._listPairedDevices();
    for (const d of devices) this.knownDevices.set(d.id, d);
    return devices;
  }

  async getConnectedDevices() {
    const devices = await this._listPairedDevices();
    for (const d of devices) this.knownDevices.set(d.id, d);
    // Return all OS-level connected devices (Status=OK in PnP) so the user can pick one.
    // This mirrors what BlueZ getConnectedDevices returns on Linux.
    return devices.filter(d => d.connected);
  }

  _openRfcomm(mac, channel = 15) {
    return new Promise((resolve, reject) => {
      const helperPath = resolveUnpacked(path.join(__dirname, 'rfcomm-helper.py'));
      const proc = spawn('python', [helperPath, mac, String(channel)], {
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
              this._queryTimer = setTimeout(() => {
                if (this._rfcommReady && !this._batteryCache) {
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
        if (!settled) { settled = true; reject(new Error(`rfcomm-helper exited (${code})`)); }
      });

      setTimeout(() => {
        if (!settled) { settled = true; proc.kill(); reject(new Error('RFCOMM connect timeout')); }
      }, 12000);
    });
  }

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
    console.log(`[windows-bt] RFCOMM channel sweep: ${candidates.join(',')}`);
    let lastErr;
    for (const ch of candidates) {
      try {
        await this._openRfcomm(mac, ch);
        const probeStart = Date.now();
        for (let i = 0; i < 3; i++) {
          try { this._sendRfcomm(buildDeviceInfoQuery().toString('hex')); } catch {}
          await new Promise(r => setTimeout(r, 750));
          if (this._lastProtocolFrameAt > probeStart) {
            console.log(`[windows-bt] RFCOMM protocol confirmed on ch${ch}`);
            return;
          }
        }
        try { this._rfcommProc?.stdin.write(JSON.stringify({ type: 'close' }) + '\n'); } catch {}
        this._rfcommProc = null;
        this._rfcommReady = false;
        throw new Error('RFCOMM channel connected but no Soundcore protocol response');
      } catch (err) {
        const msg = String(err.message || err);
        const refused =
          msg.includes('Connection refused') ||
          msg.includes('10061') ||  // WSAECONNREFUSED
          msg.includes('Connection reset by peer') ||
          msg.includes('10054') ||  // WSAECONNRESET
          msg.includes('Host is down') ||
          msg.includes('10065');    // WSAEHOSTUNREACH
        const silentWrong = msg.includes('no Soundcore protocol response');
        if (!refused && !silentWrong) throw err;
        if (silentWrong) console.warn(`[windows-bt] ch${ch} connected but silent`);
        else console.warn(`[windows-bt] ch${ch} rejected (${msg})`);
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
      'All RFCOMM channels refused. Make sure the device is paired in Windows Bluetooth settings ' +
      'and within range. If multipoint mode is on, disconnect from your phone first.'
    );
  }

  _sendRfcomm(hex) {
    if (!this._rfcommProc) throw new Error('No RFCOMM connection');
    this._rfcommProc.stdin.write(JSON.stringify({ type: 'write', hex }) + '\n');
  }

  _requestDeviceInfo(force = false) {
    const now = Date.now();
    if (!force && now - this._lastInfoQueryAt < 2000) return;
    if (!this._rfcommReady || !this.connectedDeviceId) return;
    this._lastInfoQueryAt = now;
    try { this._sendRfcomm(buildDeviceInfoQuery().toString('hex')); } catch {}
  }

  _parseLegacyShortFrames(buf) {
    const frames = [];
    let i = 0;
    while (i + 4 <= buf.length) {
      const cat = buf[i], type = buf[i + 1], sep = buf[i + 2], len = buf[i + 3];
      if (sep !== 0x00 || len > 64) { i++; continue; }
      if (i + 4 + len > buf.length) break;
      frames.push({ cat, type, payload: buf.slice(i + 4, i + 4 + len) });
      i += 4 + len;
    }
    return frames;
  }

  _extractLegacyBattery(frames) {
    for (const f of frames) {
      if (f.cat !== 0x03 || f.type !== 0x03 || f.payload.length !== 3) continue;
      const [left, right, casePct] = f.payload;
      if ([left, right, casePct].every(v => v >= 0 && v <= 100))
        return { left, right, case: casePct, source: `legacy_ch${this._legacyBatteryChannel}` };
    }
    return null;
  }

  async _pollLegacyBatteryOnce(force = false) {
    if (!this.connectedDeviceId) return null;
    if (!force && this._legacyBatteryPollInFlight) return null;
    this._legacyBatteryPollInFlight = true;
    const mac = this.connectedDeviceId;
    const channel = this._legacyBatteryChannel;

    try {
      const helperPath = resolveUnpacked(path.join(__dirname, 'rfcomm-helper.py'));
      const proc = spawn('python', [helperPath, mac, String(channel)], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let settled = false;
      let stdoutBuf = '';
      let raw = Buffer.alloc(0);

      const finish = () => {
        if (settled) return;
        settled = true;
        try { proc.kill(); } catch {}
        this._legacyBatteryPollInFlight = false;
      };

      return await new Promise((resolve) => {
        const timeout = setTimeout(() => { finish(); resolve(null); }, 9000);

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
              finish();
              resolve(null);
            }
          }
        });

        proc.on('close', () => {
          clearTimeout(timeout);
          finish();
          const batt = this._extractLegacyBattery(this._parseLegacyShortFrames(raw));
          if (batt) {
            this._batteryCache = batt;
            this.emit('battery', { deviceId: this.connectedDeviceId, battery: batt });
          }
          resolve(batt || null);
        });
      });
    } catch {
      this._legacyBatteryPollInFlight = false;
      return null;
    }
  }

  _startBatteryPolling() {
    if (this._batteryPollTimer) clearInterval(this._batteryPollTimer);
    this._batteryPollTimer = setInterval(() => {
      this._requestDeviceInfo(false);
      this._pollLegacyBatteryOnce(false).catch(() => {});
    }, 60000);
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
      console.log('[soundcore] device ready signal, sending info query');
      this._requestDeviceInfo(true);
    } else if (cat === 0x01 && type === 0x01) {
      const info = extractDeviceInfo(payload);
      if (info && !this._deviceInfoCache) {
        this._deviceInfoCache = info;
        console.log(`[device-info] model=${info.modelNum} fw=${info.firmwareLeft}/${info.firmwareRight} mac=${info.mac} hw=${info.hardwareRev}`);
        this.emit('device-info', { deviceId: this.connectedDeviceId, ...info });
      }
      const batt = extractBattery(payload);
      if (batt) {
        const normalized = this._normalizeBattery(batt);
        if (normalized) {
          this._batteryCache = normalized;
          this.emit('battery', { deviceId: this.connectedDeviceId, battery: normalized });
        }
      }
    } else if (cat === 0x06 && type === 0x01) {
      const mode = extractMode(payload);
      if (mode) { this._modeCache = mode; this.emit('mode', mode); }
    }
  }

  _normalizeBattery(batt) {
    if (!batt) return null;
    const hasLeft = batt.left != null;
    const hasRight = batt.right != null;
    if (hasLeft && hasRight) return { left: batt.left, right: batt.right, case: batt.case ?? null, source: 'protocol' };
    if (batt.case != null && !hasLeft && !hasRight) return { single: batt.case, source: 'protocol' };
    return null;
  }

  async connect(deviceId) {
    const normalized = normalizeDeviceId(deviceId);
    if (!this.knownDevices.size) await this.scan();
    let target = this.knownDevices.get(normalized);
    if (!target) {
      await this.scan();
      target = this.knownDevices.get(normalized);
    }
    if (!target) throw new Error('Device not found. Make sure it is paired in Windows Bluetooth settings.');

    if (this.connectedDeviceId === normalized && this._rfcommReady) {
      return { device: { ...target } };
    }
    if (this.connectedDeviceId && this.connectedDeviceId !== normalized) {
      await this.disconnectSession();
    }

    await this._openRfcommAny(normalized);
    this.connectedDeviceId = normalized;
    this._requestDeviceInfo(true);
    this._pollLegacyBatteryOnce(true).catch(() => {});
    this._startBatteryPolling();
    return { device: { ...target } };
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
    this.connectedDeviceId = null;
    this._batteryCache = null;
    this._modeCache = null;
    this._deviceInfoCache = null;
    this._lastInfoQueryAt = 0;
    this._rxBuffer = Buffer.alloc(0);
    return { disconnected: Boolean(id), id };
  }

  getDeviceInfo() {
    return this._deviceInfoCache;
  }

  async disconnect() {
    return this.disconnectSession();
  }

  async write(hexString) {
    if (!this.connectedDeviceId) throw new Error('No connected device');
    const hex = hexString.replace(/\s+/g, '').toLowerCase();
    if (!this._rfcommReady) {
      if (!this._rfcommProc) throw new Error('RFCOMM not connected. Reconnect the device.');
      this._rfcommQueue.push(hex);
    } else {
      this._sendRfcomm(hex);
    }
    return { ok: true, bytes: hex.length / 2 };
  }

  getBattery() {
    this._requestDeviceInfo(false);
    return this._batteryCache;
  }

  async getConnectedDevice() {
    if (!this.connectedDeviceId) return null;
    const rec = this.knownDevices.get(this.connectedDeviceId);
    return rec ? { ...rec } : null;
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

module.exports = { WindowsBackend };
