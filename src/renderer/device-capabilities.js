// Per-model feature capabilities for Soundcore devices.
// Keys are model codes matched by extractModelCode().
// Any device not listed falls back to FALLBACK_CAPS.

const DEVICE_CAPS = {
  // ── Liberty series ──────────────────────────────────────────
  "a3957": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: true  }, // Liberty 5
  "a3954": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: true  }, // Liberty 4 Pro
  "a3951": { anc: true,  ancLevels: 5, transportModes: false, windNoise: true,  ldac: true  }, // Liberty 4 NC
  "a3947": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: true  }, // Liberty 4
  "a3939": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: false }, // Liberty 3 Pro
  "a3952": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: true  }, // Liberty 3 Pro (alt)
  "a3935": { anc: true,  ancLevels: 5, transportModes: false, windNoise: false, ldac: false }, // Liberty Air 2 Pro
  "a3933": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Liberty Air 2
  "a3931": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Liberty Air
  "a3909": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: false }, // Liberty 2 Pro
  "a3913": { anc: true,  ancLevels: 5, transportModes: false, windNoise: false, ldac: false }, // Liberty Neo 2

  // ── Life Q / over-ear series ─────────────────────────────────
  "a3040": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: false }, // Space One
  "a3035": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: false }, // Space One (alt)
  "a3062": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: true  }, // Space One Pro
  "a3029": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: false }, // Q45
  "a3028": { anc: true,  ancLevels: 5, transportModes: false, windNoise: false, ldac: false }, // Q30
  "a3028cc": { anc: true, ancLevels: 5, transportModes: false, windNoise: false, ldac: false }, // Q30 (CN)
  "a3027": { anc: true,  ancLevels: 5, transportModes: true,  windNoise: true,  ldac: false }, // Q35
  "a3025": { anc: true,  ancLevels: 2, transportModes: false, windNoise: false, ldac: false }, // Q20
  "a3045": { anc: true,  ancLevels: 2, transportModes: false, windNoise: false, ldac: false }, // Q20+
  "a3033": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Life Q10
  "a3031": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Life Q10+

  // ── Life dot / budget TWS ────────────────────────────────────
  "a3004": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3005": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3012": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3925": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3926": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3927": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },

  // ── Mid-range TWS ────────────────────────────────────────────
  "a3945": { anc: true,  ancLevels: 3, transportModes: false, windNoise: false, ldac: false }, // Liberty Neo
  "a3948": { anc: true,  ancLevels: 3, transportModes: false, windNoise: false, ldac: false },
  "a3949": { anc: true,  ancLevels: 3, transportModes: false, windNoise: false, ldac: false },
  "a3944": { anc: true,  ancLevels: 5, transportModes: false, windNoise: true,  ldac: false },
  "a3943": { anc: true,  ancLevels: 5, transportModes: false, windNoise: true,  ldac: false },

  // ── Sport / neckband ─────────────────────────────────────────
  "a3301": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3302": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3330": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3331": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },

  // ── Speakers ─────────────────────────────────────────────────
  "a3117": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Motion Boom
  "a3118": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Motion Boom Plus
  "a3119": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3125": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3126": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3127": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3130": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false }, // Motion X600
  "a3131": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3133": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3135": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3136": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3388": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3390": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3391": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3392": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3393": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3395": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "a3396": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },

  // ── D-series (soundbars / desktop) ───────────────────────────
  "d1101": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "d1200": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "d1202": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "d1301": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "d3200": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
  "d5100": { anc: false, ancLevels: 0, transportModes: false, windNoise: false, ldac: false },
};

// Unknown devices: assume mid-range ANC headphones (safe middle ground)
const FALLBACK_CAPS = {
  anc: true,
  ancLevels: 5,
  transportModes: false,
  windNoise: false,
  ldac: false,
};

window.getDeviceCaps = function(modelCode) {
  return DEVICE_CAPS[modelCode] || FALLBACK_CAPS;
};
