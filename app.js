"use strict";

const PLACES = [
  { name: "Fintry, Dundee", lat: 56.482, lon: -2.918 },
  { name: "Dundee centre", lat: 56.462, lon: -2.9707 },
  { name: "Broughty Ferry", lat: 56.466, lon: -2.87 },
  { name: "Tayport", lat: 56.448, lon: -2.883 },
  { name: "Carnoustie", lat: 56.5014, lon: -2.7099 },
  { name: "Arbroath", lat: 56.559, lon: -2.585 },
  { name: "Montrose", lat: 56.708, lon: -2.468 },
  { name: "Brechin", lat: 56.731, lon: -2.659 },
  { name: "Forfar", lat: 56.643, lon: -2.888 },
  { name: "Kirriemuir", lat: 56.67, lon: -3.005 },
  { name: "Glen Clova", lat: 56.8333, lon: -3.0833 },
  { name: "Blairgowrie", lat: 56.59, lon: -3.338 },
  { name: "Pitlochry", lat: 56.704, lon: -3.736 },
  { name: "Perth", lat: 56.395, lon: -3.4308 },
  { name: "St Andrews", lat: 56.3398, lon: -2.7967 },
  { name: "Cupar", lat: 56.319, lon: -3.01 },
  { name: "Glenrothes", lat: 56.195, lon: -3.178 },
  { name: "Kirkcaldy", lat: 56.11, lon: -3.16 },
  { name: "Dunfermline", lat: 56.0717, lon: -3.4393 },
];

const WMO = {
  0: ["☀️", "Clear sky"], 1: ["🌤️", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"], 48: ["🌫️", "Freezing fog"],
  51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"],
  56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"],
  61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
  71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Light showers"], 81: ["🌧️", "Showers"], 82: ["🌧️", "Violent showers"],
  85: ["🌨️", "Snow showers"], 86: ["❄️", "Heavy snow showers"],
  95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm, hail"], 99: ["⛈️", "Severe thunderstorm, hail"],
};
const wmo = (c) => WMO[c] || ["❔", "Unknown"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r = (n) => Math.round(n);
const compass = (d) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];

const API = "https://api.open-meteo.com/v1/forecast";
const COMMON = "&wind_speed_unit=mph&timezone=Europe%2FLondon";

let selected = Number(new URLSearchParams(location.search).get("p")) || 0;
let map, markers = [], overview = [];
let station = null; // live readings from the Fintry station (station.json)

async function loadStation() {
  try {
    const res = await fetch("station.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const s = await res.json();
    const age = Date.now() - new Date(s.updated).getTime();
    station = s.online !== false && age < 3 * 3600e3 ? s : null;
  } catch (e) { station = null; }
}
const stationActive = () => station && selected === 0;

function buildPicker() {
  $("picker").innerHTML = PLACES.map((p, i) =>
    `<button type="button" role="tab" data-i="${i}" class="${i === selected ? "on" : ""}">${esc(p.name)}</button>`).join("");
  $("picker").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    select(Number(b.dataset.i));
  };
}

function select(i) {
  selected = i;
  [...$("picker").children].forEach((b, k) => b.classList.toggle("on", k === i));
  const u = new URL(location); u.searchParams.set("p", i); history.replaceState(null, "", u);
  loadPlace();
  if (map) map.flyTo([PLACES[i].lat, PLACES[i].lon], Math.max(map.getZoom(), 9), { duration: 0.8 });
}

async function loadPlace() {
  const p = PLACES[selected];
  $("now").innerHTML = '<div class="loading">Loading forecast…</div>';
  const url = `${API}?latitude=${p.lat}&longitude=${p.lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover" +
    "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,cape,snowfall" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max,sunrise,sunset,precipitation_probability_max" +
    "&forecast_days=7" + COMMON;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    await loadStation();
    renderNow(p, d); renderStorm(d); renderHourly(d); renderDaily(d);
  } catch (e) {
    $("now").innerHTML = `<div class="loading">Couldn't load the forecast (${esc(e.message)}). Check your connection and try again.</div>`;
  }
}

function renderNow(p, d) {
  let c = d.current;
  const [icon, desc] = wmo(c.weather_code);
  let badge = "";
  if (stationActive()) {
    const o = station;
    c = { ...c, temperature_2m: o.temp_c ?? c.temperature_2m, apparent_temperature: o.feels_like_c ?? c.apparent_temperature,
      relative_humidity_2m: o.humidity ?? c.relative_humidity_2m, wind_speed_10m: o.wind_mph ?? c.wind_speed_10m,
      wind_gusts_10m: o.gust_mph ?? c.wind_gusts_10m, wind_direction_10m: o.wind_dir ?? c.wind_direction_10m,
      pressure_msl: o.pressure_hpa ?? c.pressure_msl, precipitation: o.rain_last_hour_mm ?? c.precipitation };
    const t = new Date(o.updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    badge = `<div class="live">● Live from the Fintry weather station · updated ${t}</div>`;
  }
  const sr = d.daily.sunrise[0].slice(11), ss = d.daily.sunset[0].slice(11);
  $("now").innerHTML = `
    <div>
      <h2>${esc(p.name)}</h2>${badge}
      <div class="big"><div class="icon">${icon}</div>
        <div><div class="temp">${r(c.temperature_2m)}°C</div>
        <div class="desc">${desc} · feels like ${r(c.apparent_temperature)}°C</div></div></div>
    </div>
    <div class="stats">
      <div class="stat"><b>${r(c.wind_speed_10m)} mph ${compass(c.wind_direction_10m)}</b><span>Wind</span></div>
      <div class="stat"><b>${r(c.wind_gusts_10m)} mph</b><span>Gusts</span></div>
      <div class="stat"><b>${r(c.relative_humidity_2m)}%</b><span>Humidity</span></div>
      <div class="stat"><b>${r(c.pressure_msl)} hPa</b><span>Pressure</span></div>
      <div class="stat"><b>${c.precipitation} mm</b><span>Rain (last hr)</span></div>${stationActive() && station.rain_today_mm != null ? `<div class="stat"><b>${station.rain_today_mm} mm</b><span>Rain today</span></div>` : ""}
      <div class="stat"><b>${sr} / ${ss}</b><span>Sunrise / sunset</span></div>${stationActive() && station.high_24h_c != null ? `<div class="stat"><b>${station.high_24h_c}° / ${station.low_24h_c}°</b><span>24h high / low</span></div>` : ""}
    </div>`;
}

// Heuristic storm watch from model output. Not an official warning.
function renderStorm(d) {
  const h = d.hourly, n = 48, out = [];
  const idx = (fn) => { for (let i = 0; i < n; i++) if (fn(i)) return i; return -1; };
  const when = (i) => { const t = new Date(h.time[i]); return t.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }); };
  const maxOf = (a) => Math.max(...a.slice(0, n).map((v) => v ?? 0));

  const gust = maxOf(h.wind_gusts_10m), gi = h.wind_gusts_10m.indexOf(gust);
  if (gust >= 70) out.push(["red", "Damaging gusts possible", `Up to ${r(gust)} mph, peaking ${when(gi)}. Secure loose items and avoid exposed routes.`]);
  else if (gust >= 50) out.push(["amber", "Strong gusts", `Up to ${r(gust)} mph, peaking ${when(gi)}. Expect travel disruption on bridges and high routes.`]);

  const rain = maxOf(h.precipitation);
  const total = h.precipitation.slice(0, 24).reduce((a, b) => a + (b ?? 0), 0);
  if (rain >= 8 || total >= 40) out.push(["red", "Heavy rain", `Up to ${rain.toFixed(1)} mm/hr, about ${r(total)} mm over 24 hours. Flooding possible.`]);
  else if (rain >= 4 || total >= 20) out.push(["amber", "Heavy rain likely", `Up to ${rain.toFixed(1)} mm/hr, about ${r(total)} mm over 24 hours.`]);

  const snow = maxOf(h.snowfall);
  if (snow >= 1) out.push(["amber", "Snowfall", `Up to ${snow.toFixed(1)} cm/hr forecast. Check road and hill conditions.`]);

  const ts = idx((i) => h.weather_code[i] >= 95);
  const cape = maxOf(h.cape), ci = h.cape.indexOf(cape);
  if (ts >= 0) out.push(["amber", "Thunderstorms forecast", `Thunder in the forecast around ${when(ts)}.`]);
  else if (cape >= 500) out.push(["amber", "Convective potential", `CAPE reaches ${r(cape)} J/kg around ${when(ci)}. Showers could turn thundery.`]);

  const cold = Math.min(...h.temperature_2m.slice(0, n));
  if (cold <= -5) out.push(["amber", "Hard frost", `Down to ${r(cold)}°C. Ice likely on untreated surfaces.`]);

  if (!out.length) out.push(["", "Nothing notable", "No strong winds, heavy rain, thunder or snow in the next 48 hours from the model data."]);
  $("stormBody").innerHTML = out.map(([lvl, t, s]) =>
    `<div class="alert ${lvl}"><strong>${esc(t)}</strong>${esc(s)}</div>`).join("") +
    '<small style="color:var(--mute)">Automated guide from forecast model output, not an official warning. See Met Office warnings below.</small>';
}

function renderHourly(d) {
  const h = d.hourly;
  const now = new Date(d.current.time);
  let start = h.time.findIndex((t) => new Date(t) >= now - 3600e3);
  if (start < 0) start = 0;
  let html = "";
  for (let i = start; i < start + 24 && i < h.time.length; i++) {
    const t = h.time[i].slice(11, 16), [ic] = wmo(h.weather_code[i]);
    const pp = h.precipitation_probability[i] ?? 0;
    html += `<div class="hr"><div class="t">${t}</div><div class="i">${ic}</div><b>${r(h.temperature_2m[i])}°</b>
      <span class="bar" style="width:${Math.max(4, pp * 0.6)}%"></span><div class="rain">${pp}%</div>
      <div class="gust">${r(h.wind_gusts_10m[i])} mph</div></div>`;
  }
  $("hourly").innerHTML = html;
}

function renderDaily(d) {
  const dl = d.daily;
  $("daily").innerHTML = dl.time.map((t, i) => {
    const [ic, desc] = wmo(dl.weather_code[i]);
    const day = i === 0 ? "Today" : new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return `<div class="day"><div class="d">${day}</div><div class="i">${ic}</div>
      <div><div>${desc}</div><div class="m">Gusts to ${r(dl.wind_gusts_10m_max[i])} mph · ${dl.precipitation_probability_max[i] ?? 0}% rain chance</div></div>
      <div class="r"><b>${r(dl.temperature_2m_max[i])}°</b> / ${r(dl.temperature_2m_min[i])}° · ${dl.precipitation_sum[i].toFixed(1)} mm</div></div>`;
  }).join("");
}

async function loadOverview() {
  const url = `${API}?latitude=${PLACES.map((p) => p.lat).join(",")}&longitude=${PLACES.map((p) => p.lon).join(",")}` +
    "&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation" + COMMON;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const arr = await res.json();
    overview = Array.isArray(arr) ? arr : [arr];
    await loadStation();
    if (station && overview[0]) Object.assign(overview[0].current, { temperature_2m: station.temp_c ?? overview[0].current.temperature_2m, wind_speed_10m: station.wind_mph ?? overview[0].current.wind_speed_10m, wind_gusts_10m: station.gust_mph ?? overview[0].current.wind_gusts_10m, precipitation: station.rain_last_hour_mm ?? overview[0].current.precipitation });
    renderGlance(); renderPins();
  } catch (e) {
    $("glance").innerHTML = `<tr><td>Couldn't load overview (${esc(e.message)}).</td></tr>`;
  }
}

function renderGlance() {
  $("glance").innerHTML = "<thead><tr><th>Place</th><th></th><th>Temp</th><th>Wind</th><th>Gusts</th><th>Rain</th></tr></thead><tbody>" +
    PLACES.map((p, i) => {
      const c = overview[i]?.current; if (!c) return "";
      const [ic, desc] = wmo(c.weather_code);
      return `<tr data-i="${i}"><td>${esc(p.name)}</td><td title="${desc}">${ic}</td><td>${r(c.temperature_2m)}°C</td>
        <td>${r(c.wind_speed_10m)} mph</td><td>${r(c.wind_gusts_10m)} mph</td><td>${c.precipitation} mm</td></tr>`;
    }).join("") + "</tbody>";
  $("glance").querySelector("tbody").onclick = (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    select(Number(tr.dataset.i)); $("now").scrollIntoView({ behavior: "smooth" });
  };
}

function renderPins() {
  if (!map) return;
  markers.forEach((m) => m.remove()); markers = [];
  PLACES.forEach((p, i) => {
    const c = overview[i]?.current; if (!c) return;
    const icon = L.divIcon({ className: "", html: `<div class="pin">${r(c.temperature_2m)}°</div>`, iconSize: [38, 22], iconAnchor: [19, 11] });
    const m = L.marker([p.lat, p.lon], { icon, title: p.name }).addTo(map);
    m.bindTooltip(`${p.name}: ${wmo(c.weather_code)[1]}, gusts ${r(c.wind_gusts_10m)} mph`);
    m.on("click", () => select(i));
    markers.push(m);
  });
}

// ---------- Radar (RainViewer) ----------
let frames = [], layers = [], frameIdx = 0, timer = null, host = "";

async function initMap() {
  map = L.map("mapEl", { center: [56.5, -3.0], zoom: 9, minZoom: 7, maxZoom: 11 });
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  L.tileLayer(esri + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: 'Basemap © Esri, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Radar © <a href="https://www.rainviewer.com/">RainViewer</a>',
    maxZoom: 11,
  }).addTo(map);
  map.createPane("labels").style.zIndex = 450;
  map.getPane("labels").style.pointerEvents = "none";
  L.tileLayer(esri + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { pane: "labels", maxZoom: 11 }).addTo(map);
  try {
    const j = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    host = j.host; frames = j.radar.past.concat(j.radar.nowcast || []);
    // Preload every frame as its own hidden layer so switching frames is instant.
    layers = frames.map((f) => L.tileLayer(`${host}${f.path}/256/{z}/{x}/{y}/2/1_0.png`,
      { opacity: 0, maxNativeZoom: 7, maxZoom: 11, zIndex: 300, keepBuffer: 4 }).addTo(map));
    showFrame(j.radar.past.length - 1);
  } catch (e) { $("radarTime").textContent = "Radar unavailable right now."; }
  $("playBtn").onclick = togglePlay;
}

function showFrame(i) {
  const f = frames[i]; if (!f) return;
  layers.forEach((l, k) => l.setOpacity(k === i ? 0.6 : 0));
  frameIdx = i;
  const t = new Date(f.time * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  $("radarTime").textContent = `Radar: ${t}${f.time * 1000 > Date.now() ? " (forecast)" : ""} · frame ${i + 1}/${frames.length}`;
}

function togglePlay() {
  if (timer) { clearTimeout(timer); timer = null; $("playBtn").textContent = "▶ Play radar"; return; }
  if (!frames.length) return;
  $("playBtn").textContent = "⏸ Pause";
  showFrame(0);
  const step = () => {
    const next = frameIdx + 1;
    if (next >= frames.length) { timer = setTimeout(() => { showFrame(0); timer = setTimeout(step, 600); }, 1500); return; }
    showFrame(next); timer = setTimeout(step, 600);
  };
  timer = setTimeout(step, 600);
}

buildPicker();
loadPlace();
loadOverview();
initMap().then(renderPins);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
