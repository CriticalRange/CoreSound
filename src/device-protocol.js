// Soundcore BR/EDR RFCOMM protocol — channel 15
// Format: [0x08 0xEE 0x00 0x00 0x00] [cat:1] [type:1] [total_len:2LE] [payload:N] [checksum:1]
// total_len = 10 + payload.length  (counts every byte from 0x08 through checksum)
// checksum  = sum of bytes from 0x08 through end of payload, mod 256

const RFCOMM_CHANNEL = 15;

function buildCommand(category, type, payload) {
  const p = Buffer.from(payload);
  const totalLen = 10 + p.length;
  const body = Buffer.from([
    0x08, 0xEE, 0x00, 0x00, 0x00,
    category, type,
    totalLen & 0xFF, (totalLen >> 8) & 0xFF,
    ...p
  ]);
  const checksum = body.reduce((s, b) => (s + b) & 0xFF, 0);
  return Buffer.concat([body, Buffer.from([checksum])]);
}

// Mode mapping can vary across Soundcore firmware families.
// For this device/firmware, ANC and Normal are inverted versus the older mapping:
// 0x00=ANC, 0x01=Transparency, 0x02=Normal
const MODES = { normal: 0x02, anc: 0x00, transparent: 0x01, transparency: 0x01 };
const MODES_REVERSE = { 0x00: 'anc', 0x01: 'transparency', 0x02: 'normal' };

// scene_byte = (anc_sub_mode << 4) | transparency_sub_mode
// High nibble = ANC sub-mode (active when mode=anc):
//   0x1–0x5 = Manual levels 1–5 (Minimum to Maximum) — 0x5 confirmed from btsnoop
//   0x6 = Plane (transportation) — unverified
//   0x7 = Car (transportation) — unverified
const ANC_SCENES = {
  level1: 0x1,
  level2: 0x2,
  level3: 0x3,
  level4: 0x4,
  level5: 0x5,
  plane:  0x6,
  car:    0x7,
};

// Low nibble = Transparency sub-mode (active when mode=transparency):
const TRANSPARENCY_SCENES = {
  fully: 0x0,
  vocal: 0x1,  // confirmed from btsnoop
};

// payload[4]: wind noise reduction toggle (0x01=on, 0x00=off)
function buildModeCommand(mode, ancScene = 'level5', transparencyScene = 'vocal', windEnabled = false) {
  const modeVal = MODES[mode];
  if (modeVal === undefined) throw new Error(`Unknown mode: ${mode}`);
  const ancVal = ANC_SCENES[ancScene] ?? ANC_SCENES.level5;
  const transVal = TRANSPARENCY_SCENES[transparencyScene] ?? TRANSPARENCY_SCENES.vocal;
  const sceneByte = (ancVal << 4) | transVal;
  const windByte = windEnabled ? 0x01 : 0x00;
  return buildCommand(0x06, 0x81, [modeVal, sceneByte, 0x01, 0x00, windByte, 0x00, 0x03]);
}

function buildDeviceInfoQuery() {
  return buildCommand(0x01, 0x01, []);
}

// Parse all complete Soundcore frames from a raw Buffer (device response header: 09 FF 00 00 01)
// Returns { frames: [{cat, type, payload}], remaining: Buffer } — remaining holds incomplete tail
function parseSoundcoreFrames(buf) {
  const frames = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 10 > buf.length) break;
    if (buf[i] !== 0x09 || buf[i+1] !== 0xFF || buf[i+2] !== 0x00 ||
        buf[i+3] !== 0x00 || buf[i+4] !== 0x01) { i++; continue; }
    const totalLen = buf[i+7] | (buf[i+8] << 8);
    if (totalLen < 10) { i++; continue; }
    if (i + totalLen > buf.length) break;
    frames.push({ cat: buf[i+5], type: buf[i+6], payload: buf.slice(i+9, i+9+totalLen-10) });
    i += totalLen;
  }
  return { frames, remaining: buf.slice(i) };
}

// Extract battery from cat=01 type=01 payload.
// Btsnoop analysis across firmware versions confirms L/R/Case at fixed payload offsets 40/41/42.
// The 3-byte marker at offsets 37-39 changed between firmware versions (02 02 00 → 01 fe fe)
// but battery position is stable.
function normalizeBatteryValue(v) {
  if (v >= 0 && v <= 100) return v;
  // Common sentinel/invalid values seen in some firmware states.
  if (v === 0xFF || v === 0xFE || v === 0x7F) return null;
  return null;
}

function batteryTripletStats(triplet) {
  const values = [triplet.left, triplet.right, triplet.case];
  const validCount = values.filter(v => v != null).length;
  const nonZeroCount = values.filter(v => v != null && v > 0).length;
  const aboveFiveCount = values.filter(v => v != null && v >= 5).length;
  const total = values.reduce((s, v) => s + (v ?? 0), 0);
  return { validCount, nonZeroCount, aboveFiveCount, total };
}

function compareBatteryCandidates(a, b) {
  // Prefer more plausible real-world battery triplets.
  const sa = batteryTripletStats(a);
  const sb = batteryTripletStats(b);
  if (sa.aboveFiveCount !== sb.aboveFiveCount) return sa.aboveFiveCount - sb.aboveFiveCount;
  if (sa.nonZeroCount !== sb.nonZeroCount) return sa.nonZeroCount - sb.nonZeroCount;
  if (sa.validCount !== sb.validCount) return sa.validCount - sb.validCount;
  return sa.total - sb.total;
}

function extractBatteryAfterMarkers(payload) {
  const markers = [
    [0x01, 0xFE, 0xFE],
    [0x02, 0x02, 0x00],
    [0x01, 0xFF, 0xFF],
    [0x00, 0xFE, 0xFE],
  ];
  for (let i = 0; i <= payload.length - 6; i++) {
    for (const marker of markers) {
      if (payload[i] !== marker[0] || payload[i + 1] !== marker[1] || payload[i + 2] !== marker[2]) continue;
      const triplet = {
        left: normalizeBatteryValue(payload[i + 3]),
        right: normalizeBatteryValue(payload[i + 4]),
        case: normalizeBatteryValue(payload[i + 5]),
      };
      const stats = batteryTripletStats(triplet);
      if (stats.validCount >= 2) return triplet;
    }
  }
  return null;
}

function extractUnifiedBattery(payload) {
  // Liberty-family firmware variant can expose a single battery byte in a
  // tail config block: 02 00 <pct> 01 00 00 00 00 ff 00 00 01 ...
  // This appears to be a single aggregate/case-like value, not explicit L/R.
  for (let i = 0; i <= payload.length - 12; i++) {
    if (
      payload[i] === 0x02 &&
      payload[i + 1] === 0x00 &&
      payload[i + 3] === 0x01 &&
      payload[i + 4] === 0x00 &&
      payload[i + 5] === 0x00 &&
      payload[i + 6] === 0x00 &&
      payload[i + 7] === 0x00 &&
      payload[i + 8] === 0xFF &&
      payload[i + 9] === 0x00 &&
      payload[i + 10] === 0x00 &&
      payload[i + 11] === 0x01
    ) {
      const pct = normalizeBatteryValue(payload[i + 2]);
      if (pct != null) return { left: null, right: null, case: pct };
    }
  }
  return null;
}

function extractBattery(payload) {
  if (!payload || payload.length < 3) return null;

  // Primary mapping for TWS models (most reliable for Soundcore earbuds families).
  if (payload.length >= 43) {
    const fixed = {
      left: normalizeBatteryValue(payload[40]),
      right: normalizeBatteryValue(payload[41]),
      case: normalizeBatteryValue(payload[42]),
    };
    const fixedStats = batteryTripletStats(fixed);
    if (fixedStats.validCount >= 2) return fixed;
  }

  const unified = extractUnifiedBattery(payload);
  if (unified) return unified;

  const markerTriplet = extractBatteryAfterMarkers(payload);
  if (markerTriplet) return markerTriplet;

  return null;
}

// Extract mode state from cat=06 type=01 payload
function extractMode(payload) {
  if (payload.length < 5) return null;
  const sceneByte = payload[1];
  const ancVal    = sceneByte >> 4;
  const transVal  = sceneByte & 0x0F;
  return {
    mode:         MODES_REVERSE[payload[0]] ?? 'normal',
    ancScene:     Object.entries(ANC_SCENES).find(([, v]) => v === ancVal)?.[0]   ?? 'level5',
    transScene:   Object.entries(TRANSPARENCY_SCENES).find(([, v]) => v === transVal)?.[0] ?? 'vocal',
    windEnabled:  payload[4] === 0x01
  };
}

// 114-byte EQ curve payloads captured from btsnoop logs.
// Indexed by preset ID (matches EQ_PRESETS in eq-presets.js).
// Unmapped presets fall back to a minimal packet with only the preset ID byte.
const EQ_CURVES = {
  0:  '0000000078787878787878787800787878787878787878000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c780078007800780078007800780078007800000078007800780078007800780078007800780000000000',
  1:  '01000000a0828c8ca0a0a08c7800a0828c8ca0a0a08c78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3ca00082008c008c00a000a000a0008c0078000000a00082008c008c00a000a000a0008c00780000000000',
  2:  '02000000a0968278787878787800a09682787878787878000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3ca000960082007800780078007800780078000000a000960082007800780078007800780078 0000000000',
  3:  '03000000505a6e78787878787800505a6e787878787878000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c50005a006e00780078007800780078007800000050005a006e0078007800780078007800780000000000',
  4:  '0400000096966464788c96a0780096966464788c96a078000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c960096006400640078008c009600a00078000000960096006400640078008c009600a000780000000000',
  5:  '050000005a8ca0a0968c786478005a8ca0a0968c786478000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c5a008c00a000a00096008c0078006400780000005a008c00a000a00096008c0078006400780000000000',
  6:  '060000008c5a6e828c8c825a78008c5a6e828c8c825a78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c8c005a006e0082008c008c0082005a00780000008c005a006e0082008c008c0082005a00780000000000',
  7:  '070000008c8296968c64504678008c8296968c64504678000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c8c008200960096008c00640050004600780000008c008200960096008c00640050004600780000000000',
  8:  '08000000968c648c828c96967800968c648c828c969678000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c96008c0064008c0082008c00960096007800000096008c0064008c0082008c0096009600780000000000',
  9:  '0900000064646e7878786464780064646e787878646478000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c640064006e007800780078006400640078000000640064006e0078007800780064006400780000000000',
  10: '0a0000008c966e6e8c6e8c9678008c966e6e8c6e8c9678000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c8c0096006e006e008c006e008c009600780000008c0096006e006e008c006e008c009600780000000000',
  11: '0b0000008c8c6464788c96a078008c8c6464788c96a078000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c8c008c006400640078008c009600a000780000008c008c006400640078008c009600a000780000000000',
  12: '0c00000078786464647896aa780078786464647896aa78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c7800780064006400640078009600aa00780000007800780064006400640078009600aa00780000000000',
  13: '0d0000006e8ca09678648c8278006e8ca09678648c8278000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c6e008c00a0009600780064008c008200780000006e008c00a0009600780064008c008200780000000000',
  14: '0e0000007896968ca0aa96a078007896968ca0aa96a078000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c7800960096008c00a000aa009600a000780000007800960096008c00a000aa009600a000780000000000',
  15: '0f0000006e829696826e645a78006e829696826e645a78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c6e0082009600960082006e0064005a00780000006e0082009600960082006e0064005a00780000000000',
  16: '10000000b48c64648c9696a07800b48c64648c9696a078000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3cb4008c00640064008c0096009600a00078000000b4008c00640064008c0096009600a000780000000000',
  17: '11000000968c6e6e8296a0aa7800968c6e6e8296a0aa78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c96008c006e006e0082009600a000aa007800000096008c006e006e0082009600a000aa00780000000000',
  18: '12000000a0968278645a50507800a0968278645a505078000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3ca00096008200780064005a005000500078000000a00096008200780064005a0050005000780000000000',
  19: '130000005a64828c8c82785a78005a64828c8c82785a78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c5a00640082008c008c00820078005a00780000005a00640082008c008c00820078005a00780000000000',
  20: '140000006464646e828c8ca078006464646e828c8ca078000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c6400640064006e0082008c008c00a000780000006400640064006e0082008c008c00a000780000000000',
  21: '15000000787878645a50503c7800787878645a50503c78000001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c78007800780064005a00500050003c007800000078007800780064005a00500050003c00780000000000',
};

// Captured Dolby Audio EQ packet — preset ID 0x0000FEFE, boosted highs curve
const DOLBY_EQ_HEX = 'fefe0000646464738e9fa1af7878646464738e9fa1af78780001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c64006400640073008e009f00a100af007800780064006400640073008e009f00a100af00780078000000';

function buildEqCommand(presetId) {
  const curveHex = EQ_CURVES[presetId];
  if (curveHex) {
    return buildCommand(0x03, 0x87, Buffer.from(curveHex.replace(/\s/g, ''), 'hex'));
  }
  const payload = Buffer.alloc(114);
  payload[0] = presetId & 0xFF;
  return buildCommand(0x03, 0x87, payload);
}

function buildDolbyCommand() {
  return buildCommand(0x03, 0x87, Buffer.from(DOLBY_EQ_HEX, 'hex'));
}

// Fixed block bytes 24-71 — identical across all captured EQ packets
const _CEQ_FIXED = Buffer.from(
  '0001007b7776788c9592963c3c7b7776788c9592963c3c69fa0964017b7776788c9592963c3c7b7776788c9592963c3c',
  'hex'
); // 48 bytes

function buildCustomEqCommand(bands) {
  const buf = Buffer.alloc(114, 0);

  // Bytes 0-3: preset ID — 0xFF signals "custom"
  buf[0] = 0xFF;

  // Bytes 4-11: L-channel bands, byte 12: neutral 0x78
  for (let i = 0; i < 8; i++) buf[4 + i] = bands[i];
  buf[12] = 0x78;

  // Bytes 14-21: R-channel bands (mirror L), byte 22: neutral 0x78
  for (let i = 0; i < 8; i++) buf[14 + i] = bands[i];
  buf[22] = 0x78;

  // Bytes 24-71: fixed firmware block (48 bytes)
  _CEQ_FIXED.copy(buf, 24);

  // Bytes 72-89: bands interleaved [band 00 band 00 ...] + 0x78 neutral
  for (let i = 0; i < 8; i++) {
    buf[72 + i * 2] = bands[i];
    buf[73 + i * 2] = 0x00;
  }
  buf[88] = 0x78; // bytes 90-91 stay 0x00

  // Bytes 92-109: duplicate interleaved block
  for (let i = 0; i < 8; i++) {
    buf[92 + i * 2] = bands[i];
    buf[93 + i * 2] = 0x00;
  }
  buf[108] = 0x78; // bytes 110-113 stay 0x00

  return buildCommand(0x03, 0x87, buf);
}

// Parse the firmware/model/MAC string from the cat=01 type=01 device-info response.
// The response contains a 31-byte ASCII block: <fw:5><fw:5><modelNum:4><mac:12><hwRev:5>
// Example: "04.9004.9039577CE9135E50D400.00"
//          fw=04.90 fw=04.90 model=3957 mac=7CE9135E50D4 hw=00.00
function extractDeviceInfo(payload) {
  if (!payload || payload.length < 37) return null;
  for (let start = 0; start + 30 < payload.length; start++) {
    let ok = true;
    for (let i = start; i < start + 31; i++) {
      if (payload[i] < 0x20 || payload[i] >= 0x7F) { ok = false; break; }
    }
    if (!ok) continue;
    const str = payload.slice(start, start + 31).toString('ascii');
    if (!/^\d{2}\.\d{2}/.test(str)) continue;                       // must start with fw version
    const modelNum = str.slice(10, 14);
    const macRaw   = str.slice(14, 26);
    if (!/^[0-9a-fA-F]{4}$/.test(modelNum)) continue;
    if (!/^[0-9a-fA-F]{12}$/.test(macRaw))  continue;
    return {
      firmwareLeft:  str.slice(0, 5),
      firmwareRight: str.slice(5, 10),
      modelNum:      modelNum.toLowerCase(),
      mac:           macRaw.match(/.{2}/g).join(':').toUpperCase(),
      hardwareRev:   str.slice(26, 31),
    };
  }
  return null;
}

module.exports = {
  buildModeCommand, buildEqCommand, buildCustomEqCommand, buildDolbyCommand, buildDeviceInfoQuery,
  parseSoundcoreFrames, extractBattery, extractMode, extractDeviceInfo,
  RFCOMM_CHANNEL, ANC_SCENES, TRANSPARENCY_SCENES, MODES_REVERSE
};
