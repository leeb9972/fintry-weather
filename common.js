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
const t1 = (n) => Number(n).toFixed(1); // temperatures to one decimal place
const compass = (d) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];

const API = "https://api.open-meteo.com/v1/forecast";
const COMMON = "&wind_speed_unit=mph&timezone=Europe%2FLondon";


// ---------- Shared by every page ----------
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

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const fmtTime = (iso, o = { weekday: "short", hour: "2-digit", minute: "2-digit" }) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", ...o });

function makePicker(el, items, selectedIdx, onPick) {
  el.innerHTML = items.map((p, i) =>
    `<button type="button" role="tab" data-i="${i}" class="${i === selectedIdx ? "on" : ""}">${esc(p.name)}</button>`).join("");
  el.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...el.children].forEach((x) => x.classList.toggle("on", x === b));
    onPick(Number(b.dataset.i));
  };
}

// MET Norway (api.met.no) forecast. Free, CC BY 4.0. Browsers cannot set a User-Agent, so the Origin header identifies this site.
async function fetchMet(lat, lon, alt) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}${alt != null ? "&altitude=" + Math.round(alt) : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("MET Norway " + res.status);
  return (await res.json()).properties.timeseries;
}

// MET Norway symbol_code -> [emoji, label, kind]; kind is rain | snow | sleet | thunder | dry
function metSym(code = "") {
  const base = code.replace(/_(day|night|polartwilight)$/, "");
  const thunder = base.includes("thunder");
  const kind = thunder ? "thunder" : base.includes("sleet") ? "sleet" : base.includes("snow") ? "snow" : /rain|drizzle/.test(base) ? "rain" : "dry";
  const dry = { clearsky: ["☀️", "Clear"], fair: ["🌤️", "Fair"], partlycloudy: ["⛅", "Partly cloudy"], cloudy: ["☁️", "Cloudy"], fog: ["🌫️", "Fog"] };
  if (dry[base]) return [...dry[base], "dry"];
  const heavy = base.startsWith("heavy") ? "Heavy " : base.startsWith("light") ? "Light " : "";
  const shower = base.includes("showers") ? " showers" : "";
  const icons = { thunder: "⛈️", snow: "🌨️", sleet: "🌨️", rain: "🌧️" };
  const names = { thunder: "thunderstorms", snow: "snow", sleet: "sleet", rain: "rain" };
  const label = thunder ? (heavy + "rain and thunder").trim() : heavy + names[kind] + shower;
  return [icons[kind] || "❔", label.charAt(0).toUpperCase() + label.slice(1), kind];
}

// Simple bar chart as HTML. items: [{ v, cls, tip, tick }]
function barChart(items, maxVal) {
  const H = 110;
  return items.map((it) => `<div class="col" title="${esc(it.tip || "")}"><div class="plot"><i class="${it.cls || ""}" style="height:${it.v > 0 ? Math.max(3, Math.round(it.v / maxVal * H)) : 0}px"></i></div><span>${it.tick || ""}</span></div>`).join("");
}

// ---------- Station history (history.json, hourly rows from the Fintry station) ----------
const HOUR = 3600e3, DAY = 24 * HOUR;
let historyCache = null;
async function loadHistory() {
  if (historyCache) return historyCache;
  try {
    const res = await fetch("history.json?t=" + Math.floor(Date.now() / 600e3));
    if (!res.ok) throw new Error(res.status);
    const h = await res.json();
    // row -> { t (ms, start of the hour), temp, tmin, tmax, hum, wind, gust, press, rain }
    historyCache = h.rows.map((row) => Object.fromEntries(h.cols.map((c, i) => [c, c === "t" ? row[i] * 1000 : row[i]])));
  } catch (e) { historyCache = null; }
  return historyCache;
}

const hvals = (rows, f) => rows.map((r) => r[f]).filter((v) => v != null);
const havg = (rows, f) => { const v = hvals(rows, f); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const hmax = (rows, f) => { const v = hvals(rows, f); return v.length ? Math.max(...v) : null; };
const hmin = (rows, f) => { const v = hvals(rows, f); return v.length ? Math.min(...v) : null; };
const hsum = (rows, f) => hvals(rows, f).reduce((a, b) => a + b, 0);

// Hourly rows -> one row per calendar day (UK time). t is midday UTC of that date.
function historyByDay(rows) {
  const days = new Map();
  for (const r of rows) {
    const k = new Date(r.t).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(r);
  }
  return [...days].map(([k, rs]) => ({
    day: k, t: Date.parse(k + "T12:00:00Z"), hours: rs.length,
    temp: havg(rs, "temp"), tmin: hmin(rs, "tmin"), tmax: hmax(rs, "tmax"), hum: havg(rs, "hum"),
    wind: havg(rs, "wind"), gust: hmax(rs, "gust"), press: havg(rs, "press"), rain: hsum(rs, "rain"),
  }));
}

function niceTicks(lo, hi, n = 4) {
  const raw = ((hi - lo) || 1) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  let v = Math.floor(lo / step) * step;
  for (;;) { out.push(Number(v.toFixed(6))); if (v >= hi - step * 0.001) break; v += step; } // last tick must reach the top of the data
  return out;
}

function timeTicks(t0, t1) {
  const span = t1 - t0, out = [];
  if (span > 130 * DAY) {
    const d = new Date(t0); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    for (d.setUTCMonth(d.getUTCMonth() + 1); d.getTime() < t1; d.setUTCMonth(d.getUTCMonth() + 1))
      out.push([d.getTime(), fmtTime(d.getTime() + 2 * HOUR, span > 400 * DAY ? { month: "short", year: "2-digit" } : { month: "short" })]);
    return out;
  }
  const [step, o] = span <= 30 * HOUR ? [6 * HOUR, { hour: "2-digit", minute: "2-digit" }]
    : span <= 9 * DAY ? [DAY, { weekday: "short", day: "numeric" }]
    : span <= 40 * DAY ? [7 * DAY, { day: "numeric", month: "short" }]
    : [14 * DAY, { day: "numeric", month: "short" }];
  for (let t = Math.ceil(t0 / step) * step; t < t1; t += step) out.push([t, fmtTime(t + (step >= DAY ? 2 * HOUR : 0), o)]);
  return out;
}

// SVG chart with hover read-out. series: [{ name, color, kind: "line" | "band" | "bar", pts, w }]
//   line / bar: pts = [[t, v]]    band: pts = [[t, lo, hi]]    bar: w = bar width in ms
// opts: { unit, dec, zero (force the axis to include 0) }
function histChart(el, series, opts = {}) {
  el.__chart = { series, opts };
  el.classList.add("hc");
  const { unit = "", dec = 1, zero = false } = opts;
  const W = Math.max(280, el.clientWidth || 700), H = W < 480 ? 190 : 230, L = 42, R = 10, T = 10, B = 24;
  let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const s of series) for (const p of s.pts) {
    const half = s.kind === "bar" ? s.w / 2 : 0;
    t0 = Math.min(t0, p[0] - half); t1 = Math.max(t1, p[0] + half);
    for (const v of s.kind === "band" ? [p[1], p[2]] : [p[1]]) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!Number.isFinite(t0) || !Number.isFinite(lo)) { el.innerHTML = '<div class="loading">No data for this period yet.</div>'; return; }
  if (zero || series.some((s) => s.kind === "bar")) lo = Math.min(lo, 0);
  if (hi - lo < 0.5) { hi += 0.5; lo -= 0.5; }
  const ticks = niceTicks(lo, hi, W < 480 ? 3 : 4);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const stepOf = (pts) => { const d = []; for (let i = 1; i < Math.min(pts.length, 300); i++) d.push(pts[i][0] - pts[i - 1][0]); return d.sort((a, b) => a - b)[d.length >> 1] || HOUR; };
  const runs = (pts, gap) => { const out = [[]]; pts.forEach((p, i) => { if (i && p[0] - pts[i - 1][0] > gap) out.push([]); out.at(-1).push(p); }); return out; };

  let svg = "";
  for (const v of ticks) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`;
  for (const [t, label] of timeTicks(t0, t1)) svg += `<text class="ax" x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${label}</text>`;
  for (const s of series) {
    const gap = 3 * stepOf(s.pts);
    if (s.kind === "bar") {
      const bw = Math.max(1, (X(t0 + s.w) - X(t0)) - (W > 500 && s.pts.length < 100 ? 1.5 : 0.3));
      for (const p of s.pts) if (p[1] > 0) svg += `<rect x="${(X(p[0]) - bw / 2).toFixed(1)}" y="${Y(p[1]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Y(y0) - Y(p[1])).toFixed(1)}" fill="${s.color}"/>`;
    } else if (s.kind === "band") {
      for (const run of runs(s.pts, gap)) if (run.length > 1)
        svg += `<path d="M${run.map((p) => `${X(p[0]).toFixed(1)},${Y(p[2]).toFixed(1)}`).join("L")}L${run.slice().reverse().map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("L")}Z" fill="${s.color}" opacity=".22"/>`;
    } else {
      for (const run of runs(s.pts, gap)) svg += run.length > 1
        ? `<path d="M${run.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("L")}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="4 3"' : ""}/>`
        : `<circle cx="${X(run[0][0]).toFixed(1)}" cy="${Y(run[0][1]).toFixed(1)}" r="2" fill="${s.color}"/>`;
    }
  }
  svg += `<line class="cursor" y1="${T}" y2="${H - B}" x1="0" x2="0" style="display:none"/>`;
  const names = series.filter((s) => s.name);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${svg}</svg><div class="tip" style="display:none"></div>` +
    (names.length > 1 ? `<div class="legend">${names.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "");

  const cur = el.querySelector(".cursor"), tip = el.querySelector(".tip");
  const nearest = (pts, t) => { let a = 0, b = pts.length - 1; while (a < b) { const m = (a + b) >> 1; pts[m][0] < t ? (a = m + 1) : (b = m); } return a > 0 && t - pts[a - 1][0] < pts[a][0] - t ? pts[a - 1] : pts[a]; };
  const move = (e) => {
    const box = el.querySelector("svg").getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - box.left, L), W - R), t = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
    const lead = series.find((s) => s.pts.length), p0 = nearest(lead.pts, t);
    const lines = series.filter((s) => s.name && s.pts.length).map((s) => {
      const p = nearest(s.pts, t);
      if (Math.abs(p[0] - p0[0]) > 2 * stepOf(s.pts)) return "";
      const v = s.kind === "band" ? `${p[1].toFixed(dec)} to ${p[2].toFixed(dec)}` : p[1].toFixed(dec);
      return `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${v} ${unit}</b></div>`;
    }).join("");
    cur.setAttribute("x1", X(p0[0])); cur.setAttribute("x2", X(p0[0])); cur.style.display = "";
    const day = lead.kind === "bar" && lead.w >= DAY || stepOf(lead.pts) >= DAY;
    tip.innerHTML = `<strong>${fmtTime(p0[0], day ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>${lines}`;
    tip.style.display = "";
    tip.style.left = X(p0[0]) > W * 0.6 ? "auto" : `${X(p0[0]) + 10}px`;
    tip.style.right = X(p0[0]) > W * 0.6 ? `${W - X(p0[0]) + 10}px` : "auto";
  };
  const hide = () => { cur.style.display = "none"; tip.style.display = "none"; };
  const svgEl = el.querySelector("svg");
  svgEl.addEventListener("pointermove", move); svgEl.addEventListener("pointerdown", move);
  svgEl.addEventListener("pointerleave", hide);
}
// Redraw charts when their width changes (rotating a phone, resizing the window)
let chartResize;
window.addEventListener("resize", () => {
  clearTimeout(chartResize);
  chartResize = setTimeout(() => document.querySelectorAll(".hc").forEach((el) => {
    const svg = el.querySelector("svg");
    if (el.__chart && svg && Math.abs(el.clientWidth - svg.clientWidth) > 8) histChart(el, el.__chart.series, el.__chart.opts);
  }), 150);
});

// What to draw for each measurement. rows: hourly or daily history rows (daily when t is midday and daily=true)
const HIST_METRICS = {
  temp: { label: "Temperature", unit: "°C", dec: 1 },
  wind: { label: "Wind", unit: "mph", dec: 1 },
  press: { label: "Pressure", unit: "hPa", dec: 0 },
  hum: { label: "Humidity", unit: "%", dec: 0 },
  rain: { label: "Rainfall", unit: "mm", dec: 1 },
};
function metricSeries(key, rows, daily) {
  const c = daily ? 0 : HOUR / 2; // hourly rows start on the hour; plot them in the middle of it
  const pt = (f) => rows.filter((r) => r[f] != null).map((r) => [r.t + c, r[f]]);
  if (key === "temp") return [
    { name: "Range", kind: "band", color: "#ff9d4c", pts: rows.filter((r) => r.tmin != null && r.tmax != null).map((r) => [r.t + c, r.tmin, r.tmax]) },
    { name: daily ? "Average" : "Temperature", kind: "line", color: "#ff9d4c", pts: pt("temp") }];
  if (key === "wind") return [
    { name: "Gusts", kind: "line", color: "#ff6a5c", pts: pt("gust") },
    { name: "Average wind", kind: "line", color: "#4cc3ff", pts: pt("wind") }];
  if (key === "press") return [{ name: "Pressure", kind: "line", color: "#b79cff", pts: pt("press") }];
  if (key === "hum") return [{ name: "Humidity", kind: "line", color: "#4ccf8a", pts: pt("hum") }];
  return [{ name: daily ? "Rain per day" : "Rain per hour", kind: "bar", color: "#4cc3ff", w: daily ? DAY : HOUR, pts: rows.map((r) => [r.t + c, r.rain ?? 0]) }];
}

function renderChrome(active) {
  const nav = [["index.html", "now", "Now"], ["history.html", "history", "History"], ["snow.html", "snow", "Snow"], ["storms.html", "storms", "Storms"], ["index.html#map", "radar", "Radar"], ["#sources", "sources", "Data sources"]];
  const hd = document.getElementById("site-header");
  if (hd) hd.innerHTML = `<header class="top"><div class="wrap bar">
    <a class="brand" href="index.html"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M3 3 L21 21 M21 3 L3 21" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>Fintry Weather Station</a>
    <nav>${nav.map(([h, k, t]) => `<a href="${h}" class="${k === active ? "active" : ""}">${t}</a>`).join("")}</nav></div></header>`;
  const ft = document.getElementById("site-footer");
  if (ft) ft.innerHTML = `<footer id="sources"><div class="wrap">
    <h2>Data sources &amp; licences</h2>
    <p>Fintry Weather Station is a distributor of weather information, powered by data used under open licences. Forecast data is provided by <a href="https://open-meteo.com/">Open-Meteo.com</a> under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, which combines national weather service models including those of the Danish Meteorological Institute (DMI), the Met Office and NOAA. Snow and thunderstorm forecasts also use data from the <a href="https://www.met.no/en">Norwegian Meteorological Institute (MET Norway)</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Rain radar imagery is provided by <a href="https://www.rainviewer.com/">RainViewer</a>. Basemap © Esri, HERE, Garmin and <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.</p>
    <p>This data has been processed and changed by Fintry Weather Station; no endorsement by Open-Meteo, DMI, the Met Office, NOAA, MET Norway or RainViewer is implied. We process this information in a way that is useful to storm chasers, everyday users and severe weather watchers.</p>
    <p>Current conditions and lightning detection for Fintry are measured by our own Ecowitt weather station when it is online. Forecasts, and conditions at other places, are computer model output.</p>
    <p class="warn"><strong>Not an official warning service.</strong> For official severe weather warnings see the <a href="https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings">Met Office warnings</a> and <a href="https://www.sepa.org.uk/environment/water/flooding/">SEPA flood alerts</a>. In an emergency call 999. Hill and mountain forecasts: <a href="https://www.mwis.org.uk/">MWIS</a>. Avalanche reports: <a href="https://www.sais.gov.uk/">SAIS</a>.</p>
  </div></footer>`;
}
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
