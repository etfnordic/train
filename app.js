// ==========================
// KONFIG
// ==========================
const WORKER_URL = "https://trains.etfnordic.workers.dev/trains";
const REFRESH_MS = 5000;

// Färg per product
const PRODUCT_COLORS = {
  "Pågatågen": "#A855F7", // lila
  "Västtågen": "#2563EB", // blå
  "Krösatågen": "#F59E0B",
  "TiB": "#10B981",
  "SJ InterCity": "#0EA5E9",
  "X-Tåget": "#F97316",
  "Snälltåget": "#22C55E",
  "SL Pendeltåg": "#0EA5E9",
  "Norrtåg": "#F43F5E",
};
const DEFAULT_COLOR = "#64748B";

// ==========================
// KARTA
// ==========================
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// ==========================
// STATE
// ==========================
const markers = new Map(); // key -> marker
const trainDataByKey = new Map(); // key -> latest train object
let pinnedKey = null;
let filterQuery = "";

// Klick på kartan släpper pin direkt
map.on("click", () => {
  if (pinnedKey) {
    const prev = markers.get(pinnedKey);
    if (prev) setSelectedGlow(prev, false);
  }
  pinnedKey = null;
  markers.forEach((m) => m.closeTooltip());
});

// ==========================
// SÖK
// ==========================
const searchEl = document.getElementById("search");
const clearBtn = document.getElementById("clearSearch");

function normalize(s) {
  return String(s ?? "").toLowerCase().trim();
}

function matchesFilter(t) {
  if (!filterQuery) return true;
  const hay = [
    t.trainNo,
    t.operator,
    t.to,
    t.product,
  ]
    .map(normalize)
    .join(" ");
  return hay.includes(filterQuery);
}

function applyFilter() {
  for (const [key, marker] of markers.entries()) {
    const t = trainDataByKey.get(key);
    const ok = t ? matchesFilter(t) : true;

    if (ok) {
      if (!map.hasLayer(marker)) marker.addTo(map);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
      if (pinnedKey === key) pinnedKey = null;
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
    applyFilter();
  }, 120),
);

clearBtn.addEventListener("click", () => {
  searchEl.value = "";
  filterQuery = "";
  applyFilter();
  searchEl.focus();
});

// ==========================
// HELPERS
// ==========================
function colorForProduct(product) {
  return PRODUCT_COLORS[product] ?? DEFAULT_COLOR;
}

// Worker-bearing = grader från nord (0=N, 90=E, 180=S, 270=W)
// Vår SVG “grund” pekar åt höger (öst), så vi roterar med (bearing - 90).
function makeTrainDivIcon({ color, bearing }) {
  const rot = (bearing ?? 0) - 90;
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

// Fylld pil (SL-känsla)
function makeArrowSvg(color) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.36328 12.0523C4.01081 11.5711 3.33457 11.3304 3.13309 10.9655C2.95849 10.6492 2.95032 10.2673 3.11124 9.94388C3.29694 9.57063 3.96228 9.30132 5.29295 8.76272L17.8356 3.68594C19.1461 3.15547 19.8014 2.89024 20.2154 3.02623C20.5747 3.14427 20.8565 3.42608 20.9746 3.7854C21.1106 4.19937 20.8453 4.85465 20.3149 6.16521L15.2381 18.7078C14.6995 20.0385 14.4302 20.7039 14.0569 20.8896C13.7335 21.0505 13.3516 21.0423 13.0353 20.8677C12.6704 20.6662 12.4297 19.99 11.9485 18.6375L10.4751 14.4967C10.3815 14.2336 10.3347 14.102 10.2582 13.9922C10.1905 13.8948 10.106 13.8103 10.0086 13.7426C9.89876 13.6661 9.76719 13.6193 9.50407 13.5257L5.36328 12.0523Z"
        fill="${color}" stroke="rgba(0,0,0,0.28)" stroke-width="1.2" />
    </svg>
  `;
}

function formatChipText(t) {
  const base = `${t.product} ${t.trainNo} \u2192 ${t.to}`; // →
  if (t.speed === null || t.speed === undefined) return base;
  return `${base} \u00B7 ${t.speed} km/h`; // ·
}

// Logo från /logos baserat på product (du lägger själv filer)
// Ex: /logos/krosatagen.png  /logos/vasttagen.png
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
  const name = safeFileName(product);
  return `./logos/${name}.png`; // byt till .svg om du kör svg
}

function chipHtml(t, color) {
  const logo = productLogoPath(t.product);
  return `
    <div class="chip" style="background:${color};">
      <img class="logo" src="${logo}" alt="${t.product}" onerror="this.style.display='none'">
      <span>${formatChipText(t)}</span>
    </div>
  `;
}

function setSelectedGlow(marker, isSelected) {
  const el = marker.getElement();
  if (!el) return;
  el.classList.toggle("train-selected", isSelected);
}

// Smooth animation
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function animateMarkerTo(marker, toLatLng, durationMs = 900) {
  const from = marker.getLatLng();
  const to = L.latLng(toLatLng[0], toLatLng[1]);
  const start = performance.now();

  function step(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const lat = lerp(from.lat, to.lat, t);
    const lng = lerp(from.lng, to.lng, t);
    marker.setLatLng([lat, lng]);
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// Binder tooltip + “instant pin”
function bindChip(marker, t, color, key) {
  marker.bindTooltip(chipHtml(t, color), {
    direction: "top",
    offset: [0, -18],
    opacity: 1,
    className: "train-chip",
    permanent: false,
    interactive: true,
  });

  marker.on("mouseover", () => {
    if (pinnedKey === null || pinnedKey === key) marker.openTooltip();
  });

  marker.on("mouseout", () => {
    if (pinnedKey !== key) marker.closeTooltip();
  });

  marker.on("click", (e) => {
    // Viktigt: stoppa kartklick -> annars “släpps” den direkt
    L.DomEvent.stop(e);

    // Släpp förra direkt + ta bort glow
    if (pinnedKey && pinnedKey !== key) {
      const prev = markers.get(pinnedKey);
      if (prev) {
        prev.closeTooltip();
        setSelectedGlow(prev, false);
      }
    }

    pinnedKey = key;
    setSelectedGlow(marker, true);
    marker.openTooltip(); // direkt
  });
}

// ==========================
// DATA: FETCH
// ==========================
async function fetchTrains() {
  const res = await fetch(WORKER_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Worker: { meta, trains }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.trains)) return data.trains;
  return [];
}

// ==========================
// UPSERT MARKER
// ==========================
function upsertTrain(t) {
  const key = `${t.depDate}_${t.trainNo}`;
  trainDataByKey.set(key, t);

  const color = colorForProduct(t.product);
  const opacity = t.canceled ? 0.35 : 1;

  if (!markers.has(key)) {
    const icon = makeTrainDivIcon({ color, bearing: t.bearing });
    const marker = L.marker([t.lat, t.lon], { icon, opacity }).addTo(map);

    bindChip(marker, t, color, key);
    markers.set(key, marker);
  } else {
    const marker = markers.get(key);

    // animation istället för ryck
    animateMarkerTo(marker, [t.lat, t.lon], 900);

    marker.setOpacity(opacity);
    marker.setIcon(makeTrainDivIcon({ color, bearing: t.bearing }));
    marker.setTooltipContent(chipHtml(t, color));

    // håll glow + tooltip om pinnad
    if (pinnedKey === key) {
      setSelectedGlow(marker, true);
      marker.openTooltip();
    } else {
      setSelectedGlow(marker, false);
    }
  }

  return key;
}

// ==========================
// REFRESH LOOP
// ==========================
async function refresh() {
  try {
    const trains = await fetchTrains();
    const seen = new Set();

    for (const t of trains) {
      if (!t || !t.trainNo) continue;
      if (typeof t.lat !== "number" || typeof t.lon !== "number") continue;

      const key = upsertTrain(t);
      seen.add(key);
    }

    // remove old
    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) {
        if (pinnedKey === key) pinnedKey = null;
        if (map.hasLayer(marker)) map.removeLayer(marker);
        markers.delete(key);
        trainDataByKey.delete(key);
      }
    }

    // re-apply search filter
    applyFilter();
  } catch (err) {
    console.error("Kunde inte uppdatera tåg:", err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
