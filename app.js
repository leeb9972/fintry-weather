"use strict";

let selected = Number(new URLSearchParams(location.search).get("p")) || 0;
let map, markers = [], overview = [];
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
        <div><div class="temp">${t1(c.temperature_2m)}°C</div>
        <div class="desc">${desc} · feels like ${t1(c.apparent_temperature)}°C</div></div></div>
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
  if (cold <= -5) out.push(["amber", "Hard frost", `Down to ${t1(cold)}°C. Ice likely on untreated surfaces.`]);

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
    html += `<div class="hr"><div class="t">${t}</div><div class="i">${ic}</div><b>${t1(h.temperature_2m[i])}°</b>
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
      <div class="r"><b>${t1(dl.temperature_2m_max[i])}°</b> / ${t1(dl.temperature_2m_min[i])}° · ${dl.precipitation_sum[i].toFixed(1)} mm</div></div>`;
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
      return `<tr data-i="${i}"><td>${esc(p.name)}</td><td title="${desc}">${ic}</td><td>${t1(c.temperature_2m)}°C</td>
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
    const icon = L.divIcon({ className: "", html: `<div class="pin">${t1(c.temperature_2m)}°</div>`, iconSize: [46, 22], iconAnchor: [23, 11] });
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

// Station history card: last 24 hours / 7 days / 30 days of one measurement
async function initHistory() {
  const rows = await loadHistory();
  if (!rows || !rows.length) return; // card stays hidden
  const metrics = Object.keys(HIST_METRICS), ranges = [["24 hours", 1], ["7 days", 7], ["30 days", 30]];
  let metric = "temp", range = 0;
  const draw = () => {
    const last = rows.at(-1).t + HOUR, data = rows.filter((r) => r.t >= last - ranges[range][1] * DAY);
    // 30 days is a lot of hourly points: use daily values there
    const daily = ranges[range][1] > 7, d = daily ? historyByDay(data) : data;
    histChart($("histChart"), metricSeries(metric, d, daily), { unit: HIST_METRICS[metric].unit, dec: HIST_METRICS[metric].dec });
  };
  const chips = () => {
    $("histMetric").innerHTML = metrics.map((k) => `<button type="button" data-m="${k}" class="${k === metric ? "on" : ""}">${HIST_METRICS[k].label}</button>`).join("") +
      '<span class="gap"></span>' + ranges.map((r, i) => `<button type="button" data-r="${i}" class="${i === range ? "on" : ""}">${r[0]}</button>`).join("");
  };
  $("histMetric").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.m) metric = b.dataset.m; else range = Number(b.dataset.r);
    chips(); draw();
  };
  $("hist").hidden = false;
  chips(); draw();
}

renderChrome("now");
initHistory();
buildPicker();
loadPlace();
loadOverview();
initMap().then(renderPins);

