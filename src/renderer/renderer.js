const state = {
  devices:       [],
  connectedDeviceId: null,
  connectingDeviceId: null,
  lastConnectedDeviceId: null,
  activeDeviceId: null,
  mode:          "normal",
  ancScene:      "level5",
  windEnabled:   false,
  eq:            0,
  scanState:     "",
  scanOverlayOpen: false,
  scanOverlayMode: "searching",
  scanResults:   [],
  profile:       null,
  eqExpanded:    false,
  soundEffectsOpen:  false,
  dolbyEnabled:      false,
  allPresetsOpen:    false,
  presetOrder:       null,
  customEqOpen:      false,
  customPresets:     [],
  activeCustomId:    null,
};

const supportsDiscreteDisplayTransition = Boolean(
  globalThis.CSS?.supports?.("transition-behavior: allow-discrete") &&
  ("CSSStartingStyleRule" in globalThis)
);
let detailFirstOpenAnimated = false;

function setViewOpen(el, open) {
  if (!el) return;
  el.classList.toggle("is-open", Boolean(open));
  el.setAttribute("aria-hidden", open ? "false" : "true");
}

// ── Battery icons (Lucide) ───────────────────────────────────────────────────

const ICON_BATT_L = `<i data-lucide="battery-medium" aria-hidden="true"></i>`;
const ICON_BATT_R = `<i data-lucide="battery-medium" aria-hidden="true"></i>`;
const ICON_BATT_CASE = `<i data-lucide="battery-charging" aria-hidden="true"></i>`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function battItemHTML(icon, pct, hero = false) {
  const label    = pct != null ? `${pct}%` : "--";
  const fill     = pct != null ? pct : 0;
  const pfx      = hero ? "hero-" : "";
  const lowColor = pct != null && pct < 30 ? "background:var(--danger)" : "";
  return `
    <div class="${pfx}batt-item">
      <div class="${pfx}batt-top">
        <span class="${pfx}batt-icon">${icon}</span>
        <span class="${pfx}batt-pct"${pct != null && pct < 30 ? ' style="color:var(--danger)"' : ""}>${label}</span>
      </div>
      <div class="${pfx}batt-bar"><div class="${pfx}batt-fill" style="width:${fill}%;${lowColor}"></div></div>
    </div>`;
}

function isSingleBatteryDevice(device) {
  const ff = (device?.formFactor || "").toLowerCase();
  if (ff === "over-ear") return true;
  const name = String(device?.name || "").toLowerCase();
  return /(q\d{2}\b|life q|space one|headphone)/i.test(name);
}

function singleBatteryValue(batt) {
  if (!batt) return null;
  return batt.single ?? batt.case ?? batt.left ?? batt.right ?? null;
}

function batteryRowHTML(device, hero = false) {
  const batt = device?.battery || {};
  if (isSingleBatteryDevice(device)) {
    const pct = singleBatteryValue(batt);
    return battItemHTML(ICON_BATT_CASE, pct, hero);
  }
  return (
    battItemHTML(ICON_BATT_L, batt.left ?? null, hero) +
    battItemHTML(ICON_BATT_R, batt.right ?? null, hero) +
    battItemHTML(ICON_BATT_CASE, batt.case ?? null, hero)
  );
}

function deviceCardHTML(device, isActive, isConnected, isConnecting) {
  const connected = isConnected;
  const shortId = (device.id || "").slice(-8);
  const visualName = resolveDeviceVisualName(device);
  const batteryClass = isSingleBatteryDevice(device) ? "card-battery-row single" : "card-battery-row";
  const statusLabel = isConnecting ? "Connecting..." : (connected ? "Connected" : "Available");
  const statusIcon = isConnecting
    ? '<span class="status-spinner" aria-hidden="true"></span>'
    : `<span class="status-dot${connected ? ' connected' : ''}"></span>`;

  return `
    <div class="${batteryClass}">
      <div class="card-label-status">
        <div class="card-device-label" data-label="${visualName}" aria-hidden="true">${visualName}</div>
        <div class="card-status card-status-inline">
          ${statusIcon}
          <span>${statusLabel}</span>
        </div>
      </div>
      ${batteryRowHTML(device, false)}
    </div>
    <div class="card-body">
      <div class="card-device-info">
        <div class="card-device-name">${device.name || "Unknown"}</div>
        <button class="card-remove-btn" data-action="remove" title="Remove device">
          Remove Device
        </button>
        ${!connected && !isConnecting ? `<div class="card-device-meta">${shortId}</div>` : ""}
      </div>
    </div>`;
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const refs = {
  cards:         $("deviceCards"),
  scanBtn:       $("scanBtn"),
  resolveBtn:    $("resolveNamesBtn"),
  scanState:     $("scanState"),
  scanOverlay:   $("scanOverlay"),
  scanOverlayTitle: $("scanOverlayTitle"),
  scanOverlayBack: $("scanOverlayBack"),
  scanSearchingState: $("scanSearchingState"),
  scanFoundState: $("scanFoundState"),
  scanNotFoundState: $("scanNotFoundState"),
  scanBluetoothOffState: $("scanBluetoothOffState"),
  scanResultsList: $("scanResultsList"),
  scanNotFoundBtn: $("scanNotFoundBtn"),
  scanRetryBtn: $("scanRetryBtn"),
  scanBtDoneBtn:          $("scanBtDoneBtn"),
  scanConnectFailedState: $("scanConnectFailedState"),
  scanConnectRetryBtn:    $("scanConnectRetryBtn"),
  confirmBackdrop: $("confirmBackdrop"),
  confirmOk:       $("confirmOk"),
  confirmCancel:   $("confirmCancel"),
  disconnectBtn: $("disconnectBtn"),
  noDeviceState: $("noDeviceState"),
  deviceDetail:  $("deviceDetail"),
  heroImg:       $("heroImg"),
  heroName:      $("heroName"),
  heroLdac:      $("heroLdac"),
  heroBattery:   $("heroBatteryRow"),
  heroWatermark: $("heroWatermark"),
  ancSubPanel:   $("ancSubPanel"),
  transSubPanel: $("transSubPanel"),
  eqSubtitle:       $("eqSubtitle"),
  modeState:        $("modeState"),
  backBtn:          $("backBtn"),
  soundEffectsScreen: $("soundEffectsScreen"),
  seBackBtn:        $("seBackBtn"),
  sePresetName:     $("sePresetName"),
  seEqPath:         $("seEqPath"),
  seEqFill:         $("seEqFill"),
  sePresetChips:    $("sePresetChips"),
  dolbyToggle:        $("dolbyToggle"),
  allPresetsScreen:   $("allPresetsScreen"),
  allPresetsBackBtn:  $("allPresetsBackBtn"),
  allPresetsTitle:    $("allPresetsTitle"),
  allPresetsList:     $("allPresetsList"),
};

const EQ_PRESETS = window.SOUNDCORE_EQ_PRESETS || [];

function buildEqCurvePath(bands) {
  const W = 280, H = 56, flat = 120, span = 70;
  const clamp = v => Math.max(0, Math.min(H, H - ((v - (flat - span)) / (span * 2)) * H));
  const pts = bands.map((v, i) => [i / (bands.length - 1) * W, clamp(v)]);
  let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let fill = `M ${pts[0][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cpx = (x0 + x1) / 2;
    line += ` C ${cpx.toFixed(1)} ${y0.toFixed(1)}, ${cpx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    fill += ` C ${cpx.toFixed(1)} ${y0.toFixed(1)}, ${cpx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  fill += ` L ${pts[pts.length - 1][0].toFixed(1)} ${H} Z`;
  return { line, fill };
}

const PRESET_GRADIENT_BY_COLOR_ASSET = {
  "a3909_eq_image_acoustic_color.webp":      ["#D09864", "#DAAE6E", "#E2C177"],
  "a3909_eq_image_bassbooster_color.webp":   ["#3064E8", "#6162E8", "#9360E7"],
  "a3909_eq_image_bassreducer_color.webp":   ["#03D1DA", "#02A0E8", "#016FF6"],
  "a3909_eq_image_classical_color.webp":     ["#3E3835", "#7B5D40", "#B9814B"],
  "a3909_eq_image_custom_color.webp":        ["#02E4CE", "#08AADB", "#0E6FE7"],
  "a3909_eq_image_dance_color.webp":         ["#7F32D2", "#AB36B1", "#D83B90"],
  "a3909_eq_image_deep_color.webp":          ["#41C0FE", "#2AA1FE", "#1284FE"],
  "a3909_eq_image_default_color.webp":       ["#DA50D5", "#9A49E2", "#5A41EF"],
  "a3909_eq_image_electronic_color.webp":    ["#D36FCA", "#9B58C3", "#6241BD"],
  "a3909_eq_image_flat_color.webp":          ["#2B85F2", "#3AA9EC", "#49CCE6"],
  "a3909_eq_image_grammy_color.webp":        ["#E68755", "#EBA05E", "#EFB965"],
  "a3909_eq_image_hearid_color.webp":        ["#339DFD", "#618EFE", "#8275FE"],
  "a3909_eq_image_hiphop_color.webp":        ["#FE7906", "#FC9211", "#F9AC1A"],
  "a3909_eq_image_jazz_color.webp":          ["#4A82C6", "#7494B8", "#9EA6AB"],
  "a3909_eq_image_latin_color.webp":         ["#BE9A6E", "#AA7F5C", "#966549"],
  "a3909_eq_image_lounge_color.webp":        ["#7DBBEA", "#A5BAC4", "#CEBA9C"],
  "a3909_eq_image_piano_color.webp":         ["#CBAA86", "#8B7258", "#4B3A2A"],
  "a3909_eq_image_pop_color.webp":           ["#CF2698", "#7C67C1", "#2AA9EA"],
  "a3909_eq_image_preset_color.webp":        ["#D7CAF9", "#D0A0F6", "#CA72DC"],
  "a3909_eq_image_rb_color.webp":            ["#02ABFB", "#0286FB", "#0162FB"],
  "a3909_eq_image_rock_color.webp":          ["#951681", "#D8195A", "#FF1944"],
  "a3909_eq_image_smallspeaker_color.webp":  ["#3250EB", "#773BCD", "#BD26AF"],
  "a3909_eq_image_spokenword_color.webp":    ["#29DADE", "#28C0EA", "#26A5F7"],
  "a3909_eq_image_treblebooster_color.webp": ["#D82E4C", "#AB2477", "#7E1BA2"],
  "a3909_eq_image_treblereducer_color.webp": ["#8D79C1", "#626FC6", "#3866CA"],
  "a3909_eq_image_vocalbooster_color.webp":  ["#FA8631", "#F06732", "#E54834"]
};

function presetGradient(preset) {
  const stops = PRESET_GRADIENT_BY_COLOR_ASSET[preset?.img_color];
  if (!stops) return "linear-gradient(120deg, #34c759 0%, #17d2a3 100%)";
  return `linear-gradient(120deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 100%)`;
}

async function selectPreset(id) {
  state.eq = id;
  const p = EQ_PRESETS.find(p => p.id === id) || EQ_PRESETS[0];
  if (refs.eqSubtitle) refs.eqSubtitle.textContent = p?.name || "Signature";
  saveState();
  renderSoundEffects();
  renderAllPresets();
  try { await window.soundcoreDesktop.bluetooth.sendEqCommand(id); }
  catch (err) { console.error("EQ command failed:", err); }
}

function renderSoundEffects() {
  setViewOpen(refs.soundEffectsScreen, state.soundEffectsOpen);
  if (!state.soundEffectsOpen) return;

  const preset = EQ_PRESETS.find(p => p.id === state.eq) || EQ_PRESETS[0];
  refs.sePresetName.textContent = "Default";

  const bands = preset?.bands || Array(8).fill(120);
  const { line, fill } = buildEqCurvePath(bands);
  refs.seEqPath.setAttribute("d", line);
  refs.seEqFill.setAttribute("d", fill);

  if (refs.dolbyToggle) refs.dolbyToggle.checked = state.dolbyEnabled;

  // Radio buttons
  const isCustomActive = state.activeCustomId != null && state.customPresets.length > 0 && state.eq === -1;
  const isDefaultPreset = EQ_PRESETS.some(p => p.id === state.eq) && !isCustomActive;
  document.getElementById("seRadioDefault")?.classList.toggle("active", isDefaultPreset);
  document.getElementById("seRadioHearId")?.classList.toggle("active", false);
  document.getElementById("seRadioCustom")?.classList.toggle("active", isCustomActive);

  // Update custom EQ subtitle
  const activeCustom = state.customPresets.find(p => p.id === state.activeCustomId);
  const sub = $("ceqNavSub");
  if (sub) sub.textContent = activeCustom?.name || "Custom";

  // Chips — first 5 presets, text-only (no branded image assets)
  const CHIP_LIMIT = 5;
  refs.sePresetChips.innerHTML = getOrderedPresets().slice(0, CHIP_LIMIT).map(p => {
    const active = p.id === state.eq;
    return `<button class="se-chip${active ? ' active' : ''}" data-id="${p.id}" style="background-image:${presetGradient(p)}">${p.name}</button>`;
  }).join("") + `<button class="se-chip more-btn" data-action="more">More &rsaquo;</button>`;

  refs.sePresetChips.onclick = e => {
    const chip = e.target.closest(".se-chip");
    if (!chip) return;
    if (chip.dataset.action === "more") {
      state.allPresetsOpen = true;
      renderAllPresets();
    } else if (chip.dataset.id) {
      selectPreset(parseInt(chip.dataset.id));
    }
  };
}

function getOrderedPresets() {
  if (!state.presetOrder || state.presetOrder.length !== EQ_PRESETS.length) return EQ_PRESETS;
  return state.presetOrder.map(id => EQ_PRESETS.find(p => p.id === id)).filter(Boolean);
}

function renderAllPresets() {
  setViewOpen(refs.allPresetsScreen, state.allPresetsOpen);
  if (!state.allPresetsOpen) return;

  const ordered = getOrderedPresets();
  const PINNED  = 5;
  const pinned  = ordered.slice(0, PINNED);
  const rest    = ordered.slice(PINNED);

  function rowHTML(p) {
    const active = p.id === state.eq;
    const signatureClass = p.id === 0 ? " signature-flatline" : "";
    const check = active
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : '';
    return `<div class="ap-row${signatureClass}" data-id="${p.id}" draggable="false">
      <div class="ap-check">${check}</div>
      <div class="ap-thumb-wrap" style="background-image:${presetGradient(p)}"><i data-lucide="audio-lines"></i></div>
      <span class="ap-name">${p.name}</span>
      <div class="ap-drag" data-handle="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/>
        </svg>
      </div>
    </div>`;
  }

  refs.allPresetsList.innerHTML = `
    <div class="ap-card" id="apPinnedCard">${pinned.map(rowHTML).join("")}</div>
    <div class="ap-section-label">More options</div>
    <div class="ap-card" id="apRestCard">${rest.map(rowHTML).join("")}</div>
  `;

  // Click to select (only when not dragging)
  refs.allPresetsList.querySelectorAll(".ap-row").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("[data-handle]")) return;
      selectPreset(parseInt(row.dataset.id));
    });
  });

  // Drag-to-reorder via handle
  let dragSrc = null;

  refs.allPresetsList.querySelectorAll(".ap-row").forEach(row => {
    const handle = row.querySelector("[data-handle]");

    handle.addEventListener("mousedown", () => { row.setAttribute("draggable", "true"); });
    handle.addEventListener("mouseup",   () => { row.setAttribute("draggable", "false"); });

    row.addEventListener("dragstart", e => {
      dragSrc = row;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.id);
      setTimeout(() => row.classList.add("ap-row-dragging"), 0);
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("ap-row-dragging");
      row.setAttribute("draggable", "false");
      refs.allPresetsList.querySelectorAll(".ap-row").forEach(r => r.classList.remove("ap-row-over"));
    });

    row.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (row !== dragSrc) row.classList.add("ap-row-over");
    });

    row.addEventListener("dragleave", () => row.classList.remove("ap-row-over"));

    row.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("ap-row-over");
      if (!dragSrc || dragSrc === row) return;

      const cur = getOrderedPresets();
      const srcId = parseInt(dragSrc.dataset.id);
      const tgtId = parseInt(row.dataset.id);
      const srcIdx = cur.findIndex(p => p.id === srcId);
      const tgtIdx = cur.findIndex(p => p.id === tgtId);
      const reordered = [...cur];
      reordered.splice(srcIdx, 1);
      reordered.splice(tgtIdx, 0, cur[srcIdx]);
      state.presetOrder = reordered.map(p => p.id);
      saveState();
      renderAllPresets();
      renderSoundEffects();
    });
  });
}

const ANC_LABELS = {
  level1: "Level 1 (Min)", level2: "Level 2", level3: "Level 3",
  level4: "Level 4",       level5: "Level 5 (Max)",
  plane:  "Plane",         car:    "Car"
};

const DEVICE_IMAGE_MANIFEST = window.SOUNDCORE_DEVICE_IMAGE_MANIFEST || {};
const DEVICE_NAME_ALIASES = window.SOUNDCORE_DEVICE_NAME_ALIASES || {};
const APK_CODE_NAME_MAP = window.APK_CODE_NAME_MAP || {};
const DEVICE_IMAGE_FALLBACK = "";
const DEVICE_ALIAS_KEYS = Object.keys(DEVICE_NAME_ALIASES).sort((a, b) => b.length - a.length);

function normalizeDeviceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/soundcore/g, " ")
    .replace(/anker/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function extractModelCode(device) {
  const pieces = [
    device?.modelCode,
    device?.name,
    device?.id
  ].filter(Boolean).map(v => String(v).toLowerCase());

  for (const text of pieces) {
    const direct = text.match(/[adz][0-9]{4}[a-z0-9]{0,4}/g) || [];
    for (const token of direct) {
      if (DEVICE_IMAGE_MANIFEST[token]) return token;
    }
    const compact = text.replace(/[^a-z0-9]/g, "");
    const compactMatches = compact.match(/[adz][0-9]{4}[a-z0-9]{0,4}/g) || [];
    for (const token of compactMatches) {
      if (DEVICE_IMAGE_MANIFEST[token]) return token;
    }

    const normalized = normalizeDeviceName(text);
    if (normalized && DEVICE_NAME_ALIASES[normalized]) {
      const code = DEVICE_NAME_ALIASES[normalized];
      if (DEVICE_IMAGE_MANIFEST[code]) return code;
    }
    for (const alias of DEVICE_ALIAS_KEYS) {
      if (!normalized.includes(alias)) continue;
      const code = DEVICE_NAME_ALIASES[alias];
      if (DEVICE_IMAGE_MANIFEST[code]) return code;
    }
  }
  return null;
}

function resolveDeviceImage(device) {
  if (device?.image) return device.image;
  const code = extractModelCode(device);
  if (code && DEVICE_IMAGE_MANIFEST[code]?.image) return DEVICE_IMAGE_MANIFEST[code].image;
  return DEVICE_IMAGE_FALLBACK;
}

function resolveDeviceVisualName(device) {
  const code = extractModelCode(device);
  if (code) return APK_CODE_NAME_MAP[code.toLowerCase()] || code.toUpperCase();
  return String(device?.name || "UNKNOWN").toUpperCase();
}

// ── Persistence ───────────────────────────────────────────────────────────────

function loadState() {
  try {
    const p = JSON.parse(localStorage.getItem("soundcore-pc-state") || "{}");
    if (p.mode)              state.mode        = p.mode;
    if (p.ancScene)          state.ancScene    = p.ancScene;
    if (p.windEnabled != null) state.windEnabled = p.windEnabled;
    if (p.eq != null)        state.eq          = p.eq;
    if (Array.isArray(p.presetOrder)) state.presetOrder = p.presetOrder;
    if (p.profile)           state.profile     = p.profile;
    if (typeof p.lastConnectedDeviceId === "string" && p.lastConnectedDeviceId.length) {
      state.lastConnectedDeviceId = p.lastConnectedDeviceId;
    }
    if (Array.isArray(p.devices)) {
      state.devices = p.devices
        .filter(d => d && typeof d.id === "string" && d.id.length)
        .map(d => ({
          id: d.id,
          name: d.name || "Unknown",
          formFactor: d.formFactor || null,
          battery: null
        }));
    }
    if (Array.isArray(p.customPresets)) state.customPresets = p.customPresets;
    if (p.activeCustomId != null)       state.activeCustomId = p.activeCustomId;
  } catch (_) {}
}

function saveState() {
  localStorage.setItem("soundcore-pc-state", JSON.stringify({
    mode: state.mode, ancScene: state.ancScene,
    windEnabled: state.windEnabled, eq: state.eq, profile: state.profile,
    presetOrder: state.presetOrder,
    lastConnectedDeviceId: state.lastConnectedDeviceId,
    customPresets: state.customPresets,
    activeCustomId: state.activeCustomId,
    devices: state.devices.map(d => ({
      id: d.id,
      name: d.name || "Unknown",
      formFactor: d.formFactor || null
    }))
  }));
}

function mergeDevices(base, incoming) {
  const canonicalId = (id) => String(id || "").trim().toUpperCase();
  const map = new Map();
  (base || []).forEach(d => {
    if (!d?.id) return;
    map.set(canonicalId(d.id), { ...d, id: canonicalId(d.id) });
  });
  (incoming || []).forEach(d => {
    if (!d?.id) return;
    const id = canonicalId(d.id);
    const prev = map.get(id) || {};
    map.set(id, { ...prev, ...d, id });
  });
  return Array.from(map.values());
}

function hasAnyBatteryValue(batt) {
  return Boolean(
    batt &&
    (batt.single != null || batt.left != null || batt.right != null || batt.case != null)
  );
}

function shouldShowScanResultDevice(device) {
  if (!device?.id) return false;
  if (state.connectedDeviceId && device.id === state.connectedDeviceId) return false;
  const name = String(device.name || "").trim().toLowerCase();
  if (!name) return true;
  if (name.includes("set up in our app")) return false;
  if (name.includes("setup in our app")) return false;
  if (name.includes("set up device in app")) return false;
  return true;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderDeviceCards() {
  refs.cards.innerHTML = "";
  const active = state.devices.find(d => d.id === state.activeDeviceId);
  const sorted = active
    ? [active, ...state.devices.filter(d => d.id !== state.activeDeviceId)]
    : state.devices;

  if (!sorted.length) {
    refs.cards.innerHTML = `<p class="no-devices-msg">No devices yet — tap "Add Device" to check connected devices.</p>`;
    return;
  }

  sorted.forEach(device => {
    const isActive = device.id === state.activeDeviceId;
    const isConnected = device.id === state.connectedDeviceId;
    const isConnecting = device.id === state.connectingDeviceId;
    const card = document.createElement("div");
    card.className =
      "device-card" +
      (isActive ? " active" : "") +
      (isConnected ? " connected" : " disconnected");
    card.innerHTML = deviceCardHTML(device, isActive, isConnected, isConnecting);
    card.onclick = (e) => {
      const removeBtn = e.target.closest('[data-action="remove"]');
      if (removeBtn) {
        e.stopPropagation();
        removeDevice(device.id);
        return;
      }
      connectDevice(device);
    };
    refs.cards.appendChild(card);
  });
}

function renderDetail() {
  const active = state.devices.find(d => d.id === state.activeDeviceId);

  if (!active) {
    setViewOpen(refs.deviceDetail, false);
    refs.noDeviceState.style.display = "";
    return;
  }

  refs.noDeviceState.style.display = "none";
  setViewOpen(refs.deviceDetail, true);
  if (!detailFirstOpenAnimated && !supportsDiscreteDisplayTransition) {
    detailFirstOpenAnimated = true;
    refs.deviceDetail.classList.remove("fallback-enter");
    requestAnimationFrame(() => refs.deviceDetail.classList.add("fallback-enter"));
    setTimeout(() => refs.deviceDetail.classList.remove("fallback-enter"), 280);
  }

  // Hero
  const name = active.name || "Unknown";
  refs.heroName.textContent = name;
  // Extract numeric model number for watermark (e.g. "Liberty 5" → "5")
  const numMatch = name.match(/\d+/);
  refs.heroWatermark.textContent = numMatch ? numMatch[0] : "";
  refs.heroWatermark.classList.add("center-only");

  // Hero battery
  refs.heroBattery.classList.toggle("single", isSingleBatteryDevice(active));
  refs.heroBattery.innerHTML = batteryRowHTML(active, true);

  // Device capabilities
  const modelCode = extractModelCode(active);
  const caps = window.getDeviceCaps(modelCode);

  // LDAC badge
  refs.heroLdac.style.display = caps.ldac ? "" : "none";

  // Mode circles — hide ANC circle if device has no ANC
  $("modeAnc").closest(".mode-circle-item").style.display = caps.anc ? "" : "none";
  $("modeTrans").closest(".mode-circle-item").style.display = caps.anc ? "" : "none";
  document.querySelectorAll(".mode-circle").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });

  // Sub panels
  refs.ancSubPanel.style.display   = (state.mode === "anc"          && caps.anc) ? "" : "none";
  refs.transSubPanel.style.display = (state.mode === "transparency" && caps.anc) ? "" : "none";

  // Level buttons — show only up to caps.ancLevels
  document.querySelectorAll(".level-btn").forEach(btn => {
    const n = parseInt(btn.dataset.anc?.replace("level", "") || "0");
    btn.style.display = n <= caps.ancLevels ? "" : "none";
    btn.classList.toggle("active", btn.dataset.anc === state.ancScene);
  });

  // Transport buttons (plane/car)
  const transportRow = document.querySelector(".transport-row");
  if (transportRow) transportRow.style.display = caps.transportModes ? "" : "none";
  document.querySelectorAll(".transport-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.anc === state.ancScene);
  });

  // Wind toggle row
  const wt = $("windToggle");
  if (wt) {
    wt.checked = state.windEnabled;
    wt.closest(".toggle-row").style.display = caps.windNoise ? "" : "none";
  }

  const currentPreset = EQ_PRESETS.find(p => p.id === state.eq) || EQ_PRESETS[0];
  refs.eqSubtitle.textContent = currentPreset?.name || "Signature";

}

function renderScanState() {
  if (!refs.scanState) return;
  refs.scanState.textContent = state.scanState;
}

function renderScanOverlay() {
  if (!refs.scanOverlay) return;

  refs.scanOverlay.classList.toggle("open", state.scanOverlayOpen);
  refs.scanOverlay.setAttribute("aria-hidden", state.scanOverlayOpen ? "false" : "true");

  if (!state.scanOverlayOpen) return;

  const mode = state.scanOverlayMode;
  refs.scanSearchingState.style.display = mode === "searching" ? "" : "none";
  refs.scanFoundState.style.display = mode === "found" ? "" : "none";
  refs.scanNotFoundState.style.display = mode === "not-found" ? "" : "none";
  refs.scanBluetoothOffState.style.display  = mode === "bluetooth-off"    ? "" : "none";
  if (refs.scanConnectFailedState)
    refs.scanConnectFailedState.style.display = mode === "connect-failed" ? "" : "none";

  if (refs.scanOverlayTitle) {
    if (mode === "bluetooth-off")    refs.scanOverlayTitle.textContent = "Turn On Bluetooth";
    else if (mode === "connect-failed") refs.scanOverlayTitle.textContent = "Connection Failed";
    else if (mode === "found")       refs.scanOverlayTitle.textContent = "Set up your device";
    else                             refs.scanOverlayTitle.textContent = "Searching...";
  }

  if (mode === "found") {
    refs.scanResultsList.innerHTML = "";
    (state.scanResults || []).forEach(device => {
      const isConnecting = device.id === state.connectingDeviceId;
      const isBusy = Boolean(state.connectingDeviceId && state.connectingDeviceId !== device.id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "scan-result-item";
      row.disabled = isConnecting || isBusy;
      row.innerHTML = `
        <div class="scan-result-label">${resolveDeviceVisualName(device)}</div>
        <div class="scan-result-meta">
          <div class="scan-result-name">${device.name || "Unknown"}</div>
          <div class="scan-result-sub${isConnecting ? " connecting" : ""}">
            ${isConnecting ? '<span class="status-spinner" aria-hidden="true"></span>Connecting...' : "Tap to connect"}
          </div>
        </div>
      `;
      row.onclick = async () => {
        await connectDevice(device, { openOnSuccess: false });
        if (state.connectedDeviceId === device.id) {
          state.scanOverlayOpen = false;
          renderScanOverlay();
        }
      };
      refs.scanResultsList.appendChild(row);
    });
  }
}

function render() {
  renderDeviceCards();
  renderDetail();
  renderScanState();
  renderScanOverlay();
  renderSoundEffects();
  renderAllPresets();
  renderCustomEqScreen();
  if (window.lucide?.createIcons) {
    window.lucide.createIcons();
  }
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function confirmChangeConnection() {
  return new Promise(resolve => {
    refs.confirmBackdrop.classList.add("open");
    const cleanup = (result) => {
      refs.confirmBackdrop.classList.remove("open");
      refs.confirmOk.removeEventListener("click", onOk);
      refs.confirmCancel.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);
    refs.confirmOk.addEventListener("click", onOk);
    refs.confirmCancel.addEventListener("click", onCancel);
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function connectDevice(device, options = {}) {
  const { openOnSuccess = true } = options;
  if (!device?.id) return;
  if (state.connectingDeviceId && state.connectingDeviceId === device.id) return;
  if (state.connectingDeviceId && state.connectingDeviceId !== device.id) return;

  if (device.id === state.connectedDeviceId) {
    if (openOnSuccess) state.activeDeviceId = device.id;
    render();
    return;
  }

  if (state.connectedDeviceId && state.connectedDeviceId !== device.id) {
    const confirmed = await confirmChangeConnection();
    if (!confirmed) return;
    const previousConnectedId = state.connectedDeviceId;
    try { await window.soundcoreDesktop.bluetooth.disconnectSession(); } catch {}
    state.connectedDeviceId = null;
    if (state.activeDeviceId === previousConnectedId) {
      state.activeDeviceId = null;
    }
  }

  state.connectingDeviceId = device.id;

  state.scanState = `Connecting to ${device.name}…`;
  render();
  try {
    const result = await window.soundcoreDesktop.bluetooth.connect(device.id);
    state.connectedDeviceId = device.id;
    state.lastConnectedDeviceId = device.id;
    if (openOnSuccess) state.activeDeviceId = device.id;
    else if (state.activeDeviceId === device.id) state.activeDeviceId = null;

    const connectedName = result?.device?.name || device.name || "Unknown";
    state.devices = mergeDevices(state.devices, [{
      ...device,
      id: device.id,
      name: connectedName
    }]);
    if (result?.device?.name) {
      state.devices = state.devices.map(d => d.id === device.id ? { ...d, name: result.device.name } : d);
    }
    saveState();
    state.scanState = `Connected: ${connectedName}`;
    // Battery arrives asynchronously via onBattery push, but also poll as fallback
    let polls = 0;
    const pollId = setInterval(async () => {
      if (++polls > 20 || state.connectedDeviceId !== device.id) { clearInterval(pollId); return; }
      const batt = await window.soundcoreDesktop.bluetooth.getBattery().catch(() => null);
      if (hasAnyBatteryValue(batt)) {
        clearInterval(pollId);
        state.devices = state.devices.map(d =>
          d.id === device.id ? { ...d, battery: batt } : d
        );
        saveState();
        render();
      }
    }, 500);
  } catch (err) {
    if (err.message?.includes('No BlueZ adapter') || err.message?.includes('adapter')) {
      state.scanOverlayOpen = true;
      state.scanOverlayMode = "bluetooth-off";
      state.scanState = "";
    } else if (err.message?.includes('RFCOMM channels refused') || err.message?.includes('RFCOMM')) {
      state.scanOverlayOpen = true;
      state.scanOverlayMode = "connect-failed";
      state.scanState = "";
    } else if (err.message?.includes('br-connection-key-missing')) {
      state.scanState = 'Connection failed: Bluetooth pairing key missing. Re-pair the device in your Bluetooth settings, then try again.';
    } else {
      state.scanState = `Connect failed: ${err.message}`;
    }
  } finally {
    if (state.connectingDeviceId === device.id) state.connectingDeviceId = null;
  }
  render();
}

async function removeDevice(deviceId) {
  if (!deviceId) return;
  const target = state.devices.find(d => d.id === deviceId);
  if (!target) return;

  if (state.connectedDeviceId === deviceId || state.connectingDeviceId === deviceId) {
    try { await window.soundcoreDesktop.bluetooth.disconnectSession(); } catch {}
    state.connectedDeviceId = null;
    state.connectingDeviceId = null;
  }

  if (state.activeDeviceId === deviceId) state.activeDeviceId = null;
  if (state.lastConnectedDeviceId === deviceId) state.lastConnectedDeviceId = null;
  state.devices = state.devices.filter(d => d.id !== deviceId);
  saveState();
  state.scanState = `Removed: ${target.name || deviceId}`;
  render();
}

async function syncConnectedDevice(options = {}) {
  const { addIfMissing = false } = options;
  try {
    const connected = await window.soundcoreDesktop.bluetooth.getConnectedDevice();
    if (!connected) {
      state.connectedDeviceId = null;
      saveState();
      return;
    }
    const exists = state.devices.some(d => d.id === connected.id);
    if (exists) {
      state.devices = mergeDevices(state.devices, [connected]);
    } else if (addIfMissing) {
      state.devices = mergeDevices(state.devices, [connected]);
    }
    state.connectedDeviceId = connected.id;
    state.lastConnectedDeviceId = connected.id;
    saveState();
  } catch (_) {}
}

async function runDeviceScanOverlayFlow() {
  state.scanOverlayOpen = true;
  state.scanOverlayMode = "searching";
  state.scanResults = [];
  state.scanState = "Checking Bluetooth…";
  render();

  try {
    const adapterState = await window.soundcoreDesktop.bluetooth.getState();
    if (adapterState !== "poweredOn") {
      state.scanState = `Bluetooth is ${adapterState}. Turn it on.`;
      state.scanOverlayMode = "bluetooth-off";
      render();
      return;
    }

    state.scanState = "Checking connected devices…";
    state.scanOverlayMode = "searching";
    render();

    const devices = await window.soundcoreDesktop.bluetooth.getConnectedDevices();
    state.scanResults = mergeDevices([], devices).filter(shouldShowScanResultDevice);
    await syncConnectedDevice({ addIfMissing: false });
    state.scanState = `Found ${state.scanResults.length} connected device(s)`;
    state.scanOverlayMode = state.scanResults.length ? "found" : "not-found";
  } catch (err) {
    state.scanState = `Device check failed: ${err.message}`;
    state.scanOverlayMode = "not-found";
  }

  render();
}

// ── Bind controls ─────────────────────────────────────────────────────────────

function bindControls() {
  if (state.profile) {
    window.soundcoreDesktop.bluetooth.updateProfile(state.profile).catch(err => {
      state.scanState = `Profile load failed: ${err.message}`;
      renderScanState();
    });
  }

  async function sendMode() {
    await window.soundcoreDesktop.bluetooth.sendModeCommand(state.mode, state.ancScene, state.windEnabled);
  }

  // Circular mode buttons
  document.querySelectorAll(".mode-circle").forEach(btn => {
    btn.onclick = async () => {
      state.mode = btn.dataset.mode;
      try { await sendMode(); state.scanState = `Mode: ${state.mode}`; }
      catch (err) { state.scanState = `Mode failed: ${err.message}`; }
      saveState(); render();
    };
  });

  // ANC level buttons
  document.querySelectorAll(".level-btn, .transport-btn").forEach(btn => {
    btn.onclick = async () => {
      state.ancScene = btn.dataset.anc;
      state.mode = "anc";
      try { await sendMode(); state.scanState = `ANC: ${btn.dataset.anc}`; }
      catch (err) { state.scanState = `Mode failed: ${err.message}`; }
      saveState(); render();
    };
  });

  // Wind toggle
  const wt = $("windToggle");
  if (wt) {
    wt.addEventListener("change", async () => {
      state.windEnabled = wt.checked;
      if (state.mode === "transparency") {
        try { await sendMode(); state.scanState = `Wind: ${wt.checked ? "on" : "off"}`; }
        catch (err) { state.scanState = `Mode failed: ${err.message}`; }
      }
      saveState(); renderDetail(); renderScanState();
    });
  }

  // Sound Effects row — open screen
  const eqRow = $("soundEffectsRow");
  if (eqRow) {
    eqRow.onclick = () => {
      state.soundEffectsOpen = true;
      renderSoundEffects();
    };
  }

  // Sound Effects back button
  if (refs.seBackBtn) {
    refs.seBackBtn.onclick = () => {
      state.soundEffectsOpen = false;
      renderSoundEffects();
    };
  }

  // Dolby toggle
  if (refs.dolbyToggle) {
    refs.dolbyToggle.addEventListener("change", () => {
      state.dolbyEnabled = refs.dolbyToggle.checked;
      window.soundcoreDesktop.bluetooth.sendDolbyCommand(refs.dolbyToggle.checked, state.eq);
    });
  }

  // All Presets back button
  if (refs.allPresetsBackBtn) {
    refs.allPresetsBackBtn.onclick = () => {
      state.allPresetsOpen = false;
      renderAllPresets();
    };
  }


  // Scan
  refs.scanBtn.onclick = () => runDeviceScanOverlayFlow();

  // Resolve names
  refs.resolveBtn.onclick = async () => {
    await syncConnectedDevice();
    if (!state.connectedDeviceId) {
      state.scanState = "No connected device. Connect first."; renderScanState(); return;
    }
    state.scanState = "Resolving name…"; renderScanState();
    try {
      const result = await window.soundcoreDesktop.bluetooth.resolveConnectedName();
      if (result?.name) {
        state.devices = state.devices.map(d => d.id === result.id ? { ...d, name: result.name } : d);
        saveState();
        state.scanState = `Resolved: ${result.name}`;
      } else { state.scanState = "Could not resolve name."; }
    } catch (err) { state.scanState = `Resolve failed: ${err.message}`; }
    render();
  };

  // Disconnect (optional UI control)
  if (refs.disconnectBtn) {
    refs.disconnectBtn.onclick = async () => {
      try {
        await window.soundcoreDesktop.bluetooth.disconnectSession();
        state.connectedDeviceId = null;
        state.connectingDeviceId = null;
        state.activeDeviceId = null;
        saveState();
        state.scanState = "Disconnected";
      } catch (err) { state.scanState = `Disconnect failed: ${err.message}`; }
      render();
    };
  }

  // Back button (deselect device on mobile / narrow)
  if (refs.backBtn) {
    refs.backBtn.onclick = async () => {
      if (state.connectedDeviceId) {
        try { await window.soundcoreDesktop.bluetooth.disconnectSession(); } catch {}
        state.connectedDeviceId = null;
      }
      state.connectingDeviceId = null;
      state.activeDeviceId = null;
      saveState();
      render();
    };
  }

  bindCeqControls();

  // Add-device overlay controls
  if (refs.scanOverlayBack) {
    refs.scanOverlayBack.onclick = () => {
      state.scanOverlayOpen = false;
      renderScanOverlay();
    };
  }
  if (refs.scanNotFoundBtn) {
    refs.scanNotFoundBtn.onclick = () => {
      state.scanOverlayMode = "not-found";
      renderScanOverlay();
    };
  }
  if (refs.scanRetryBtn) {
    refs.scanRetryBtn.onclick = () => runDeviceScanOverlayFlow();
  }
  if (refs.scanConnectRetryBtn) {
    refs.scanConnectRetryBtn.onclick = () => {
      state.scanOverlayOpen = false;
      renderScanOverlay();
      const target = state.devices.find(d => d.id === state.lastConnectedDeviceId) || state.devices[0];
      if (target) connectDevice(target);
    };
  }
  if (refs.scanBtDoneBtn) {
    refs.scanBtDoneBtn.onclick = () => {
      window.soundcoreDesktop.bluetooth.openBtSettings().catch(() => {});
      state.scanOverlayOpen = false;
      renderScanOverlay();
    };
  }

}

// ── Custom EQ ─────────────────────────────────────────────────────────────────

const CEQ = {
  // viewBox: "0 0 400 248"
  L: 30, R: 390, T: 8, B: 220,
  BAND_X: [30, 81, 133, 184, 236, 287, 339, 390],
  DB_Y:   [8, 61, 114, 167, 220],           // +6 +3 0 -3 -6
  DB_LABELS: ['+6', '+3', '0', '-3', '-6'],
  FREQ_LABELS: ['100', '200', '400', '800', '1.6k', '3.2k', '6.4k', '12.8k'],
  NS: 'http://www.w3.org/2000/svg',
};
CEQ.H = CEQ.B - CEQ.T; // 212

function ceqBandToY(v) {
  return CEQ.B - (v - 60) * CEQ.H / 120;
}

function ceqYToBand(y) {
  return Math.max(60, Math.min(180, Math.round((CEQ.B - y) * 120 / CEQ.H + 60)));
}

function ceqCurvePath(ys) {
  const xs = CEQ.BAND_X;
  let line = `M ${xs[0]} ${ys[0].toFixed(1)}`;
  let fill = `M ${xs[0]} ${CEQ.B} L ${xs[0]} ${ys[0].toFixed(1)}`;
  for (let i = 1; i < 8; i++) {
    const cpx = ((xs[i - 1] + xs[i]) / 2).toFixed(1);
    line += ` C ${cpx} ${ys[i-1].toFixed(1)}, ${cpx} ${ys[i].toFixed(1)}, ${xs[i]} ${ys[i].toFixed(1)}`;
    fill += ` C ${cpx} ${ys[i-1].toFixed(1)}, ${cpx} ${ys[i].toFixed(1)}, ${xs[i]} ${ys[i].toFixed(1)}`;
  }
  fill += ` L ${xs[7]} ${CEQ.B} Z`;
  return { line, fill };
}

function ceqBuildGrid() {
  const g = $("ceqGrid");
  if (!g) return;
  const ns = CEQ.NS;
  let html = '';

  // dB "dB" label
  html += `<text x="4" y="20" fill="#636366" font-size="9" font-family="inherit">dB</text>`;

  // Horizontal grid lines + dB labels
  CEQ.DB_Y.forEach((y, i) => {
    html += `<line x1="${CEQ.L}" y1="${y}" x2="${CEQ.R}" y2="${y}" stroke="#2c2c2e" stroke-width="${i === 2 ? '1' : '0.6'}"/>`;
    // tick marks between main labels
    if (i < 4) {
      const midY = (y + CEQ.DB_Y[i+1]) / 2;
      html += `<line x1="${CEQ.L}" y1="${midY}" x2="${CEQ.L + 6}" y2="${midY}" stroke="#2c2c2e" stroke-width="0.6"/>`;
    }
    html += `<text x="26" y="${y + 4}" fill="#636366" font-size="9.5" text-anchor="end" font-family="inherit">${CEQ.DB_LABELS[i]}</text>`;
  });

  // Vertical band lines + frequency labels
  CEQ.BAND_X.forEach((x, i) => {
    html += `<line x1="${x}" y1="${CEQ.T}" x2="${x}" y2="${CEQ.B}" stroke="#2c2c2e" stroke-width="0.6"/>`;
    const anchor = i === 7 ? 'end' : (i === 0 ? 'start' : 'middle');
    html += `<text x="${x}" y="238" fill="#636366" font-size="9" text-anchor="${anchor}" font-family="inherit">${CEQ.FREQ_LABELS[i]}</text>`;
  });

  g.innerHTML = html;
}

let ceqDragBand = null;

function renderCeqSvg(bands) {
  const svg   = $("ceqSvg");
  const curve = $("ceqCurve");
  const fill  = $("ceqFill");
  const hand  = $("ceqHandles");
  if (!svg || !curve || !fill || !hand) return;

  const ys = bands.map(ceqBandToY);
  const { line, fill: fillD } = ceqCurvePath(ys);
  curve.setAttribute("d", line);
  fill.setAttribute("d", fillD);

  hand.innerHTML = CEQ.BAND_X.map((x, i) =>
    `<circle class="ceq-handle${ceqDragBand === i ? ' dragging' : ''}" cx="${x}" cy="${ys[i].toFixed(1)}" r="7" data-band="${i}"/>`
  ).join("");

  // Re-attach pointer events after innerHTML update
  hand.querySelectorAll(".ceq-handle").forEach(c => {
    c.addEventListener("pointerdown", e => {
      e.preventDefault();
      ceqDragBand = parseInt(c.dataset.band);
      svg.setPointerCapture(e.pointerId);
      c.classList.add("dragging");
    });
  });
}

function ceqSvgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function initCeqDrag() {
  const svg = $("ceqSvg");
  if (!svg || svg._ceqDragBound) return;
  svg._ceqDragBound = true;

  svg.addEventListener("pointermove", e => {
    if (ceqDragBand === null) return;
    const preset = state.customPresets.find(p => p.id === state.activeCustomId);
    if (!preset) return;
    const pt = ceqSvgPoint(svg, e);
    preset.bands[ceqDragBand] = ceqYToBand(pt.y);
    renderCeqSvg(preset.bands);
  });

  svg.addEventListener("pointerup", () => {
    if (ceqDragBand !== null) {
      ceqDragBand = null;
      const preset = state.customPresets.find(p => p.id === state.activeCustomId);
      if (preset) {
        saveState();
        sendCeqBands(preset.bands);
      }
    }
  });
}

async function sendCeqBands(bands) {
  state.eq = -1;
  saveState();
  try {
    await window.soundcoreDesktop.bluetooth.sendEqCommand("custom", bands);
  } catch (err) {
    console.error("Custom EQ send failed:", err);
  }
}

function ceqNextId() {
  const ids = state.customPresets.map(p => p.id);
  let id = 1;
  while (ids.includes(id)) id++;
  return id;
}

function ceqAddPreset() {
  const id   = ceqNextId();
  const num  = state.customPresets.length + 1;
  const prev = state.customPresets.find(p => p.id === state.activeCustomId);
  const bands = prev ? [...prev.bands] : Array(8).fill(120);
  state.customPresets.push({ id, name: `Custom ${num}`, bands });
  state.activeCustomId = id;
  saveState();
  renderCustomEqScreen();
}

function ceqDeleteActive() {
  if (state.customPresets.length <= 1) return;
  state.customPresets = state.customPresets.filter(p => p.id !== state.activeCustomId);
  state.activeCustomId = state.customPresets[0].id;
  saveState();
  renderCustomEqScreen();
}

function renderCeqTabbar() {
  const bar = $("ceqTabbar");
  if (!bar) return;

  const addBtn = `<button class="ceq-tab ceq-tab-add" id="ceqAddBtn" title="Add preset">+</button>`;

  const presetTabs = state.customPresets.map(p => {
    const active = p.id === state.activeCustomId ? " active" : "";
    return `<button class="ceq-tab${active}" data-ceq-id="${p.id}">${p.name}</button>`;
  }).join("");

  const gearBtn = `<button class="ceq-tab ceq-tab-gear" id="ceqDeleteBtn" title="Delete preset">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  </button>`;

  bar.innerHTML = addBtn + presetTabs + gearBtn;

  bar.querySelector("#ceqAddBtn").onclick = ceqAddPreset;

  bar.querySelectorAll("[data-ceq-id]").forEach(btn => {
    btn.onclick = () => {
      state.activeCustomId = parseInt(btn.dataset.ceqId);
      const preset = state.customPresets.find(p => p.id === state.activeCustomId);
      if (preset) sendCeqBands(preset.bands);
      saveState();
      renderCustomEqScreen();
    };
  });

  const delBtn = bar.querySelector("#ceqDeleteBtn");
  if (delBtn) {
    delBtn.onclick = () => {
      if (state.customPresets.length > 1) {
        ceqDeleteActive();
      }
    };
  }
}

function renderCustomEqScreen() {
  const screen = $("customEqScreen");
  if (!screen) return;

  setViewOpen(screen, state.customEqOpen);
  if (!state.customEqOpen) return;

  ceqBuildGrid();

  const preset = state.customPresets.find(p => p.id === state.activeCustomId);
  if (preset) renderCeqSvg(preset.bands);

  renderCeqTabbar();
  initCeqDrag();

  // Update the subtitle in Sound Effects screen
  const sub = $("ceqNavSub");
  if (sub && preset) sub.textContent = preset.name;
}

function openCustomEq() {
  if (!state.customPresets.length) {
    state.customPresets.push({ id: 1, name: "Custom", bands: Array(8).fill(120) });
  }
  if (!state.customPresets.find(p => p.id === state.activeCustomId)) {
    state.activeCustomId = state.customPresets[0].id;
  }
  state.customEqOpen = true;
  saveState();
  renderCustomEqScreen();
}

function bindCeqControls() {
  const backBtn    = $("ceqBackBtn");
  const resetBtn   = $("ceqResetBtn");
  const renameBtn  = $("ceqRenameBtn");
  const navRow     = $("customEqNavRow");
  const renameBack = $("ceqRenameBackdrop");
  const renameOk   = $("ceqRenameOk");
  const renameCancel = $("ceqRenameCancel");
  const renameInput  = $("ceqRenameInput");

  if (backBtn) {
    backBtn.onclick = () => {
      state.customEqOpen = false;
      renderCustomEqScreen();
      renderSoundEffects();
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      const preset = state.customPresets.find(p => p.id === state.activeCustomId);
      if (preset) {
        preset.bands = Array(8).fill(120);
        saveState();
        renderCeqSvg(preset.bands);
        sendCeqBands(preset.bands);
      }
    };
  }

  if (renameBtn) {
    renameBtn.onclick = () => {
      const preset = state.customPresets.find(p => p.id === state.activeCustomId);
      if (!preset || !renameBack || !renameInput) return;
      renameInput.value = preset.name;
      renameBack.classList.add("open");
      setTimeout(() => renameInput.focus(), 60);
    };
  }

  if (renameCancel) renameCancel.onclick = () => renameBack?.classList.remove("open");

  if (renameOk) {
    const doRename = () => {
      const preset = state.customPresets.find(p => p.id === state.activeCustomId);
      const val = renameInput?.value.trim();
      if (preset && val) {
        preset.name = val;
        saveState();
        renderCeqTabbar();
        const sub = $("ceqNavSub");
        if (sub) sub.textContent = val;
      }
      renameBack?.classList.remove("open");
    };
    renameOk.onclick = doRename;
    renameInput?.addEventListener("keydown", e => { if (e.key === "Enter") doRename(); });
  }

  if (navRow) {
    navRow.onclick = openCustomEq;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  loadState();
  bindControls();
  await syncConnectedDevice();
  render();
  if (!state.connectedDeviceId && state.devices.length > 0) {
    const preferred =
      (state.lastConnectedDeviceId && state.devices.find(d => d.id === state.lastConnectedDeviceId))
      || state.devices[0];
    await connectDevice(preferred, { openOnSuccess: false });
  }
}

boot();

window.soundcoreDesktop.bluetooth.onBattery((payload) => {
  const batt = payload?.battery || payload;
  const targetId = payload?.deviceId || state.connectedDeviceId;
  if (!targetId || !hasAnyBatteryValue(batt)) return;
  state.devices = state.devices.map(d =>
    d.id === targetId ? { ...d, battery: batt } : d
  );
  saveState();
  render();
});

window.soundcoreDesktop.bluetooth.onModeUpdate(({ mode, ancScene, windEnabled }) => {
  state.mode = mode;
  state.ancScene = ancScene;
  state.windEnabled = windEnabled;
  saveState(); render();
});
