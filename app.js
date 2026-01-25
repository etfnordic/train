const WORKER_URL = "https://trains.etfnordic.workers.dev/trains";
const REFRESH_MS = 5000;

const PRODUCT_COLORS = {
  "Pågatågen": "#A855F7",
  "Västtågen": "#2563EB",
  "Krösatågen": "#F59E0B",
  "Tåg i Bergslagen": "#10B981",
  "Värmlandstrafik": "#10B981",
  "Arlanda Express": "#22C55E",
  "SJ InterCity": "#0EA5E9",
  "X-Tåget": "#F97316",
  "Snälltåget": "#22C55E",
  "SL Pendeltåg": "#0EA5E9",
  "Norrtåg": "#F43F5E",
};
const DEFAULT_COLOR = "#64748B";

// ===== KARTA =====
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// ===== STATE =====
const markers = new Map(); // key -> marker
const trainDataByKey = new Map(); // key -> train
let pinnedKey = null;

// För hastighetsestimat (när worker skickar null / pendel-"1")
// key -> [{ lat, lon, tsMs }, ...] (senaste sist)
const lastSamplesByKey = new Map();
// key -> { speed, tsMs } (senaste estimerade/smoothede hastighet)
const lastEstSpeedByKey = new Map();

let filterQuery = "";
let userInteractedSinceSearch = false;

// Släpp pin på kartklick (snabbt)
map.on("click", () => {
  unpinCurrent();
});

// ===== SÖK =====
const searchEl = document.getElementById("search");
const clearBtn = document.getElementById("clearSearch");

function normalize(s) {
  return String(s ?? "").toLowerCase().trim();
}

function matchesFilter(t) {
  if (!filterQuery) return true;
  // Endast tågnummer + product
  const hay = `${t.trainNo} ${t.product}`.toLowerCase();
  return hay.includes(filterQuery);
}

function applyFilterAndMaybeZoom() {
  // 1) visa/dölj markers
  let matchKeys = [];
  for (const [key, marker] of markers.entries()) {
    const t = trainDataByKey.get(key);
    const ok = t ? matchesFilter(t) : true;

    if (ok) {
      if (!map.hasLayer(marker)) marker.addTo(map);
      matchKeys.push(key);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
      if (pinnedKey === key) pinnedKey = null;
    }
  }

  // 2) auto-zoom om exakt 1 match
  if (filterQuery && matchKeys.length === 1 && !userInteractedSinceSearch) {
    const key = matchKeys[0];
    const marker = markers.get(key);
    if (marker) {
      // passa in lite tajt, men utan att bli för nära
      const ll = marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 10), { animate: true });

      // visa chip även om inget är pinnat
      marker.openTooltip();
    }
  }
}

function debounce(fn, ms = 120) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

searchEl.addEventListener(
  "input",
  debounce(() => {
    filterQuery = normalize(searchEl.value);
    userInteractedSinceSearch = false;
    applyFilterAndMaybeZoom();
  }, 120),
);

clearBtn.addEventListener("click", () => {
  searchEl.value = "";
  filterQuery = "";
  userInteractedSinceSearch = false;
  applyFilterAndMaybeZoom();
  searchEl.focus();
});

// Om användaren panorerar/zoomar efter en sökning ska vi inte "dra tillbaka" kameran
map.on("dragstart", () => {
  userInteractedSinceSearch = true;
});
map.on("zoomstart", () => {
  userInteractedSinceSearch = true;
});

// ===== HELPERS =====
function colorForProduct(product) {
  return PRODUCT_COLORS[product] ?? DEFAULT_COLOR;
}

function hexToRgb(hex) {
  const h = String(hex ?? "").trim();
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function bestTextColor(bgHex) {
  // WCAG-ish luminans (0..1)
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "#fff";
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  // tröskel som ger "bäst" kontrast i praktiken
  return L > 0.55 ? "#0B1220" : "#ffffff";
}

// Bearing offset: DU SA “mitt emellan nu och innan”.
// Innan: 0 offset (pekade höger). Sen: -90 (blev fel åt andra hållet).
// “Mittemellan” = -45. Du kan fintrimma här om du vill (+/- 10).
const BEARING_OFFSET_DEG = -45;

function makeTrainDivIcon({ color, bearing }) {
  const rot = (bearing ?? 0) + BEARING_OFFSET_DEG;
  const html = `
    <div class="train-icon" style="transform: rotate(${rot}deg);">
      ${makeArrowSvg(color)}
    </div>
  `;
  return L.divIcon({
    className: "",
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Fylld pil
function makeArrowSvg(color) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.36328 12.0523C4.01081 11.5711 3.33457 11.3304 3.13309 10.9655C2.95849 10.6492 2.95032 10.2673 3.11124 9.94388C3.29694 9.57063 3.96228 9.30132 5.29295 8.76272L17.8356 3.68594C19.1461 3.15547 19.8014 2.89024 20.2154 3.02623C20.5747 3.14427 20.8565 3.42608 20.9746 3.7854C21.1106 4.19937 20.8453 4.85465 20.3149 6.16521L15.2381 18.7078C14.6995 20.0385 14.4302 20.7039 14.0569 20.8896C13.7335 21.0505 13.3516 21.0423 13.0353 20.8677C12.6704 20.6662 12.4297 19.99 11.9485 18.6375L10.4751 14.4967C10.3815 14.2336 10.3347 14.102 10.2582 13.9922C10.1905 13.8948 10.106 13.8103 10.0086 13.7426C9.89876 13.6661 9.76719 13.6193 9.50407 13.5257L5.36328 12.0523Z"
        fill="${color}" stroke="rgba(0,0,0,0.28)" stroke-width="1.2" />
    </svg>
  `;
}

function formatChipText(t) {
  const base = `${t.product} ${t.trainNo} \u2192 ${t.to}`;
  if (t.speed === null || t.speed === undefined) return base;
  const prefix = t._speedEstimated ? "~" : "";
  return `${base} \u00B7 ${prefix}${t.speed} km/h`;
}

// logos: baserat på product
function safeFileName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function productLogoPath(product) {
  return `./logos/${safeFileName(product)}.png`;
}

function chipHtml(t, color) {
  const logo = productLogoPath(t.product);
  const textColor = bestTextColor(color);
  return `
    <div class="chip" style="background:${color}; color:${textColor};">
      <img class="logo" src="${logo}" alt="${t.product}" onerror="this.style.display='none'">
      <span>${formatChipText(t)}</span>
    </div>
  `;
}

// ===== Smooth move =====
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function animateMarkerTo(marker, toLatLng, durationMs = 850) {
  const from = marker.getLatLng();
  const to = L.latLng(toLatLng[0], toLatLng[1]);
  const start = performance.now();

  function step(now) {
    const t = Math.min(1, (now - start) / durationMs);
    marker.setLatLng([lerp(from.lat, to.lat, t), lerp(from.lng, to.lng, t)]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== PIN/UNPIN utan lagg =====
function setGlow(marker, on) {
  const el = marker.getElement();
  if (!el) return;
  el.classList.toggle("train-selected", on);
}

function bindTooltip(marker, t, color, permanent) {
  // Används endast vid init + vid pin/unpin (inte varje refresh)
  marker.unbindTooltip();
  marker.bindTooltip(chipHtml(t, color), {
    direction: "top",
    offset: [0, -18],
    opacity: 1,
    className: permanent ? "train-chip pinned" : "train-chip",
    permanent,
    interactive: true,
  });
}

function updateTooltipContent(marker, t, color) {
  const tooltip = marker.getTooltip?.();
  if (!tooltip) return;
  tooltip.setContent(chipHtml(t, color));
}

function unpinCurrent() {
  if (!pinnedKey) return;
  const prev = markers.get(pinnedKey);
  const t = trainDataByKey.get(pinnedKey);
  if (prev && t) {
    setGlow(prev, false);
    // gör den non-permanent igen
    bindTooltip(prev, t, colorForProduct(t.product), false);
    prev.closeTooltip();
  }
  pinnedKey = null;
}

function pinMarker(key) {
  if (pinnedKey === key) return; // redan pinnad

  // släpp tidigare direkt
  unpinCurrent();

  const marker = markers.get(key);
  const t = trainDataByKey.get(key);
  if (!marker || !t) return;

  pinnedKey = key;
  setGlow(marker, true);

  // gör tooltip permanent direkt (känns “instant”)
  bindTooltip(marker, t, colorForProduct(t.product), true);
  marker.openTooltip();
}

function attachHoverAndClick(marker, key) {
  marker.on("mouseover", () => {
    // Man ska kunna hovera andra tåg även när något är pinnat
    marker.openTooltip();
  });

  marker.on("mouseout", () => {
    // Stäng bara om den här inte är pinnad
    if (pinnedKey !== key) marker.closeTooltip();
  });

  marker.on("click", (e) => {
    L.DomEvent.stop(e);
    pinMarker(key);
  });
}

// ===== DATA-NORMALISERING =====
function normalizeProduct(rawProduct) {
  if (rawProduct === "TiB") return "Tåg i Bergslagen";
  if (rawProduct === "VTAB") return "Värmlandstrafik";
  return rawProduct;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const MAX_SAMPLES = 6;
const MIN_EST_DT_MS = 15_000; // minst 15s för att minska jitter
const MIN_EST_DIST_KM = 0.05; // ignorera små hopp
const REUSE_EST_MS = 90_000; // återanvänd senaste est om vi saknar bra underlag

const MAX_SPEED_BY_PRODUCT = {
  "SL Pendeltåg": 170,
  "Pågatågen": 200,
  "Västtågen": 200,
  "Krösatågen": 180,
  "Tåg i Bergslagen": 200,
  "Värmlandstrafik": 200,
  "Arlanda Express": 220,
  "SJ InterCity": 200,
  "X-Tåget": 200,
  "Snälltåget": 230,
  "Norrtåg": 200,
};

function maxPlausibleSpeed(product) {
  return MAX_SPEED_BY_PRODUCT[product] ?? 250;
}

function pushSample(key, sample) {
  const arr = lastSamplesByKey.get(key) ?? [];
  const last = arr[arr.length - 1];

  // om timestamp är samma, ersätt senaste (minskar "fladder")
  if (last && last.tsMs === sample.tsMs) {
    arr[arr.length - 1] = sample;
  } else {
    arr.push(sample);
  }

  // trim
  while (arr.length > MAX_SAMPLES) arr.shift();
  lastSamplesByKey.set(key, arr);
  return arr;
}

function estimateSpeedFromSamples(key, product, current) {
  const arr = lastSamplesByKey.get(key);
  if (!arr || arr.length < 2) return null;

  // hitta en sample som är minst MIN_EST_DT_MS äldre än current
  const targetTs = current.tsMs - MIN_EST_DT_MS;
  let base = null;
  for (let i = arr.length - 2; i >= 0; i--) {
    if (arr[i].tsMs <= targetTs) {
      base = arr[i];
      break;
    }
  }
  if (!base) return null;

  const dtMs = current.tsMs - base.tsMs;
  if (dtMs <= 0) return null;

  const distKm = haversineKm(base.lat, base.lon, current.lat, current.lon);
  if (!Number.isFinite(distKm) || distKm < MIN_EST_DIST_KM) return null;

  const est = (distKm / (dtMs / 3_600_000));
  if (!Number.isFinite(est) || est < 2) return null;

  const max = maxPlausibleSpeed(product);
  // om den är helt orimlig (ofta pga GPS-jitter), underkänn
  if (est > max * 1.35) return null;

  return Math.min(est, max);
}

function smoothEstimate(key, rawEst, tsMs) {
  const prev = lastEstSpeedByKey.get(key);
  if (prev && Number.isFinite(prev.speed) && (tsMs - prev.tsMs) <= REUSE_EST_MS) {
    // EMA-ish: behåll lite av tidigare för stabilitet
    return 0.65 * prev.speed + 0.35 * rawEst;
  }
  return rawEst;
}

function normalizeTrain(tIn) {
  const t = { ...tIn };

  // Product-display
  t.product = normalizeProduct(t.product);

  // Arlanda Express-regel
  const n = Number(t.trainNo);
  if (Number.isFinite(n) && n >= 7700 && n <= 7999) {
    t.product = "Arlanda Express";
    t.to = n % 2 === 1 ? "Stockholm C" : "Arlanda";
  }

  // SL Pendeltåg: "1 km/h" verkar vara default -> behandla som null
  if (t.product === "SL Pendeltåg" && t.speed === 1) {
    t.speed = null;
  }

  const key = `${t.depDate}_${t.trainNo}`;
  const tsMs = Date.parse(t.timeStamp ?? "");
  if (Number.isFinite(tsMs) && typeof t.lat === "number" && typeof t.lon === "number") {
    pushSample(key, { lat: t.lat, lon: t.lon, tsMs });
  }

  // Hastighetsestimat om null
  t._speedEstimated = false;
  if (t.speed === null || t.speed === undefined) {
    if (Number.isFinite(tsMs)) {
      const raw = estimateSpeedFromSamples(key, t.product, { lat: t.lat, lon: t.lon, tsMs });
      if (raw !== null) {
        const smoothed = smoothEstimate(key, raw, tsMs);
        t.speed = Math.round(smoothed);
        t._speedEstimated = true;
        lastEstSpeedByKey.set(key, { speed: t.speed, tsMs });
      } else {
        // saknar bra underlag just nu -> återanvänd senaste rimliga estimat
        const prev = lastEstSpeedByKey.get(key);
        if (prev && Number.isFinite(prev.speed) && (tsMs - prev.tsMs) <= REUSE_EST_MS) {
          t.speed = prev.speed;
          t._speedEstimated = true;
        }
      }
    }
  }

  return t;
}

// ===== FETCH =====
async function fetchTrains() {
  const res = await fetch(WORKER_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.trains)) return data.trains;
  return [];
}

// ===== UPSERT =====
function upsertTrain(t) {
  t = normalizeTrain(t);
  const key = `${t.depDate}_${t.trainNo}`;
  trainDataByKey.set(key, t);

  const color = colorForProduct(t.product);
  const opacity = t.canceled ? 0.35 : 1;

  if (!markers.has(key)) {
    const marker = L.marker([t.lat, t.lon], {
      icon: makeTrainDivIcon({ color, bearing: t.bearing }),
      opacity,
    }).addTo(map);

    // init tooltip non-permanent
    bindTooltip(marker, t, color, false);
    attachHoverAndClick(marker, key);

    markers.set(key, marker);
  } else {
    const marker = markers.get(key);

    // position animation
    animateMarkerTo(marker, [t.lat, t.lon], 850);

    // icon update (bearing + color) — sker bara vid refresh, inte vid click
    marker.setIcon(makeTrainDivIcon({ color, bearing: t.bearing }));
    marker.setOpacity(opacity);

    // Uppdatera tooltip-content utan att re-binda (minskar lagg rejält)
    updateTooltipContent(marker, t, color);

    const isPinned = pinnedKey === key;
    if (isPinned) {
      setGlow(marker, true);
      marker.openTooltip();
    }
  }

  return key;
}

// ===== LOOP =====
async function refresh() {
  try {
    if (document.hidden) return; // spara CPU + data när fliken inte är aktiv
    const trains = await fetchTrains();
    const seen = new Set();

    for (const t of trains) {
      if (!t || !t.trainNo) continue;
      if (typeof t.lat !== "number" || typeof t.lon !== "number") continue;
      const key = upsertTrain(t);
      seen.add(key);
    }

    // remove gamla
    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) {
        if (pinnedKey === key) pinnedKey = null;
        if (map.hasLayer(marker)) map.removeLayer(marker);
        markers.delete(key);
        trainDataByKey.delete(key);
        lastSamplesByKey.delete(key);
        lastEstSpeedByKey.delete(key);
      }
    }

    applyFilterAndMaybeZoom();
  } catch (err) {
    console.error("Kunde inte uppdatera tåg:", err);
  }
}

// ===== SCHEDULER =====
// Undvik overlap + uppdatera inte när fliken är dold
let refreshTimer = null;
async function tick() {
  await refresh();
  refreshTimer = setTimeout(tick, REFRESH_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    // Direkt refresh när man kommer tillbaka
    refresh();
  }
});

tick();
