const WORKER_URL = "https://train.etfnordic.workers.dev";
const REFRESH_MS = 15000;
const MAX_AGE_MIN = 30; // döljer tåg som inte uppdaterats på 30 min

const lastUpdateEl = document.getElementById("lastUpdate");
const countEl = document.getElementById("count");
const errorBox = document.getElementById("errorBox");

const map = L.map("map", { zoomControl: true }).setView([62.0, 15.0], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap-bidragsgivare",
}).addTo(map);

const trainsLayer = L.layerGroup().addTo(map);
const markersByKey = new Map();

function setError(msg) {
  if (!msg) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = msg;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return iso ?? "—";
  }
}

// WGS84: "POINT (lon lat)"
function parseWgs84Point(pointStr) {
  if (!pointStr || typeof pointStr !== "string") return null;
  const m = pointStr.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function createArrowDivIcon(bearingDeg = 0) {
  const rot = Number.isFinite(bearingDeg) ? bearingDeg : 0;
  const svg = `
<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M13 2 L22 22 L13 18 L4 22 Z" fill="white" fill-opacity="0.92" stroke="black" stroke-opacity="0.25" stroke-width="1"/>
</svg>`.trim();

  return L.divIcon({
    className: "train-arrow",
    html: `<div class="arrow" style="transform: rotate(${rot}deg)">${svg}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  });
}

// CSS för pilar
const style = document.createElement("style");
style.textContent = `
.train-arrow { background: transparent; border: none; }
.train-arrow .arrow { width: 26px; height: 26px; transform-origin: 50% 50%; }
.train-arrow svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35)); }
`;
document.head.appendChild(style);

function trainKey(t) {
  return `${t?.opNum ?? "unknown"}_${t?.depDate ?? "unknown"}`;
}

function popupHtml(t) {
  return `
    <div style="min-width:240px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px;">
        Tåg ${t?.advNum ?? "—"} <span style="color:#9ca3af; font-weight:650;">(op: ${t?.opNum ?? "—"})</span>
      </div>
      <div style="font-size:13px; line-height:1.35;">
        <div><b>Riktning:</b> ${t?.bearing ?? "—"}</div>
        <div><b>Hastighet:</b> ${t?.speed ?? "—"}</div>
        <div style="margin-top:6px;"><b>TimeStamp:</b> ${formatTime(t?.timeStamp)}</div>
        <div><b>Modified:</b> ${formatTime(t?.modifiedTime)}</div>
        <div style="margin-top:6px; color:#9ca3af;">
          <b>Trafikdygn:</b><br/>${t?.depDate ?? "—"}
        </div>
      </div>
    </div>
  `;
}

async function fetchTrains() {
  setError("");

  const u = new URL(WORKER_URL);
  u.searchParams.set("maxAgeMin", String(MAX_AGE_MIN));
  u.searchParams.set("_", String(Date.now())); // cache-bust

  const res = await fetch(u.toString(), { method: "GET" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Worker HTTP ${res.status}\n${txt}`);
  }

  const json = await res.json();
  return json;
}

function upsertMarkers(trains) {
  const seen = new Set();

  for (const t of trains) {
    const key = trainKey(t);
    seen.add(key);

    const pt = parseWgs84Point(t?.wgs84);
    if (!pt) continue;

    const bearing = t?.bearing ?? 0;

    const existing = markersByKey.get(key);
    if (existing) {
      existing.setLatLng([pt.lat, pt.lon]);
      existing.setIcon(createArrowDivIcon(bearing));
      if (existing.isPopupOpen()) existing.setPopupContent(popupHtml(t));
    } else {
      const marker = L.marker([pt.lat, pt.lon], {
        icon: createArrowDivIcon(bearing),
        riseOnHover: true,
      });
      marker.bindPopup(popupHtml(t));
      marker.addTo(trainsLayer);
      markersByKey.set(key, marker);
    }
  }

  for (const [key, marker] of markersByKey.entries()) {
    if (!seen.has(key)) {
      trainsLayer.removeLayer(marker);
      markersByKey.delete(key);
    }
  }

  countEl.textContent = String(markersByKey.size);
}

async function refresh() {
  try {
    const payload = await fetchTrains();
    const trains = payload?.trains ?? [];
    const meta = payload?.meta ?? {};

    upsertMarkers(trains);

    lastUpdateEl.textContent = `Uppdaterad ${formatTime(meta.serverTime ?? new Date().toISOString())}`;

    // Hjälp vid felsökning om det blir 0 eller orimligt
    // console.log("meta", meta);

    if (trains.length === 0) {
      setError(`0 tåg efter filtrering.\nmeta: ${JSON.stringify(meta)}`);
    }
  } catch (err) {
    setError(String(err?.message ?? err));
    console.error(err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
