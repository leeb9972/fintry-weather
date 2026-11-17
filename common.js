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

function renderChrome(active) {
  const nav = [["index.html", "now", "Now"], ["snow.html", "snow", "Snow"], ["storms.html", "storms", "Storms"], ["index.html#map", "radar", "Radar"], ["#sources", "sources", "Data sources"]];
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
