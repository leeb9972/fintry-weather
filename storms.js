"use strict";

const SITES = PLACES;
let sel = Math.min(Number(new URLSearchParams(location.search).get("p")) || 0, SITES.length - 1);

const OM_VARS = "temperature_2m,precipitation,weather_code,cape,lifted_index,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_500hPa,wind_direction_500hPa,freezing_level_height";
const omUrl = (s) => `${API}?latitude=${s.lat}&longitude=${s.lon}&hourly=${OM_VARS}&forecast_days=3&timeformat=unixtime` + COMMON;
const nowIndex = (times) => Math.max(0, times.findIndex((t) => t * 1000 + 3600e3 > Date.now()));
const max = (a) => a.reduce((m, v) => Math.max(m, v ?? -Infinity), -Infinity);
const min = (a) => a.reduce((m, v) => Math.min(m, v ?? Infinity), Infinity);

// Rough deep-layer shear: vector difference between the 10 m wind and the 500 hPa wind, in m/s
function shear(h, i) {
  const toUV = (spd, dir) => [-spd * Math.sin(dir * Math.PI / 180), -spd * Math.cos(dir * Math.PI / 180)];
  if (h.wind_speed_500hPa[i] == null || h.wind_speed_10m[i] == null) return null;
  const [u1, v1] = toUV(h.wind_speed_10m[i], h.wind_direction_10m[i]), [u2, v2] = toUV(h.wind_speed_500hPa[i], h.wind_direction_500hPa[i]);
  return Math.hypot(u2 - u1, v2 - v1) * 0.44704;
}

async function load() {
  const s = SITES[sel];
  $("verdict").innerHTML = '<div class="loading">Loading storm forecast…</div>';
  try {
    const [om, met] = await Promise.all([
      fetch(omUrl(s)).then((r) => { if (!r.ok) throw new Error("Open-Meteo " + r.status); return r.json(); }),
      fetchMet(s.lat, s.lon).catch(() => null),
      loadStation(),
    ]);
    render(s, om, met);
  } catch (e) {
    $("verdict").innerHTML = `<div class="loading">Couldn't load the forecast (${esc(e.message)}). Check your connection and try again.</div>`;
  }
}

function metSteps(met) {
  if (!met) return [];
  return met.filter((t) => t.data.next_1_hours && new Date(t.time).getTime() + 3600e3 > Date.now()).map((t) => {
    const [icon, label, kind] = metSym(t.data.next_1_hours.summary.symbol_code);
    return { time: t.time, icon, label, kind, mm: t.data.next_1_hours.details?.precipitation_amount ?? 0 };
  });
}

function render(s, om, met) {
  const h = om.hourly, i0 = nowIndex(h.time), steps = metSteps(met);
  $("siteInfo").textContent = esc(s.name);
  const at = (n) => Array.from({ length: n }, (_, k) => i0 + k).filter((i) => i < h.time.length);
  const i24 = at(24), i48 = at(48);

  const capeMax24 = max(i24.map((i) => h.cape[i])), capeMax48 = max(i48.map((i) => h.cape[i]));
  const liMin = min(i24.map((i) => h.lifted_index[i]));
  const gust24 = max(i24.map((i) => h.wind_gusts_10m[i])), rain24 = max(i24.map((i) => h.precipitation[i]));
  const shearMax = max(i24.map((i) => shear(h, i)));
  const metThunder = steps.filter((x, k) => k < 48 && x.kind === "thunder");
  const metThunder24 = steps.slice(0, 24).filter((x) => x.kind === "thunder");
  const omThunder = i48.filter((i) => h.weather_code[i] >= 95);
  const hail = i48.filter((i) => h.weather_code[i] >= 96);
  const firstThunder = [metThunder[0] && new Date(metThunder[0].time).getTime(), omThunder[0] != null && h.time[omThunder[0]] * 1000].filter(Boolean).sort()[0];

  // Station lightning (Fintry)
  const live = station && station.lightning_count_1h > 0;
  const stRisk = station?.thunder_risk_pct ?? 0;

  // Overall level
  let lvl = "", title = "✅ No storms expected", text = "Neither forecast shows thunderstorms for the next 48 hours.";
  if (live) { lvl = "red"; title = "⚡ Lightning detected by the Fintry station"; text = `${station.lightning_count_1h} strike${station.lightning_count_1h > 1 ? "s" : ""} in the last hour. Stay indoors until 30 minutes after the last thunder.`; }
  else if (hail.length || (firstThunder && capeMax48 >= 1000)) { lvl = "red"; title = "⛈️ Thunderstorms likely, severe possible"; text = `Thunder forecast${firstThunder ? " from " + fmtTime(firstThunder) : ""} with CAPE up to ${Math.round(capeMax48)} J/kg${hail.length ? " and hail in the forecast" : ""}.`; }
  else if (firstThunder || stRisk >= 40) { lvl = "amber"; title = "⛈️ Thunderstorms possible"; text = `${firstThunder ? "Thunder in the forecast from " + fmtTime(firstThunder) + ". " : ""}${stRisk >= 40 ? `Your station's thunderstorm risk is ${stRisk}%.` : ""}`; }
  else if (capeMax48 >= 500) { lvl = "amber"; title = "🌩️ Some storm energy around"; text = `CAPE reaches ${Math.round(capeMax48)} J/kg. Showers could turn thundery, though neither model shows thunder.`; }
  const agree = !!(metThunder.length) === !!(omThunder.length);
  $("verdict").innerHTML = `<div class="alert ${lvl}"><strong>${title}</strong>${esc(text)}</div>` +
    `<div class="sub" style="margin-top:8px">${metThunder.length || omThunder.length ? (agree ? "Both MET Norway and Open-Meteo show thunder, so confidence is higher." : "Only one of the two models shows thunder, so confidence is lower.") : "Not an official warning."}</div>`;

  // Station card
  if (station) {
    const last = station.lightning_last ? new Date(station.lightning_last) : null;
    const ago = last ? Math.round((Date.now() - last.getTime()) / 86400e3) : null;
    const st = (b, l) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`;
    $("stationBody").innerHTML = [
      st(station.lightning_count_1h ?? 0, "Strikes, last hour"),
      st(`${station.lightning_rate_per_min ?? 0}/min`, "Strike rate"),
      st(`${stRisk}%`, `Station thunder risk (${esc(station.thunder_risk_level || "n/a")})`),
      st(esc(station.alert_message || "–"), "Station alert status"),
      st(last ? fmtTime(last, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "None recorded", ago != null ? `Last strike (${ago} day${ago === 1 ? "" : "s"} ago)` : "Last strike"),
      st(station.lightning_last_km != null ? `${station.lightning_last_km} km (${(station.lightning_last_km * 0.621371).toFixed(0)} mi)` : "–", "Distance of last strike"),
      st(`${t1(station.temp_c)}°C`, "Temperature now"),
      st(esc(String(station.pressure_trend || "–")), `Pressure trend (${Math.round(station.pressure_hpa)} hPa)`),
    ].join("");
    $("stationNote").textContent = `Detector readings from the Fintry weather station, updated ${fmtTime(station.updated)}. Its thunderstorm risk uses surface readings only, so false alarms are possible.`;
  } else {
    $("stationBody").innerHTML = "";
    $("stationNote").textContent = "The Fintry station isn't reporting right now, so live lightning detection is unavailable.";
  }

  // Ingredients
  const stat = (b, l) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`;
  const f = (v, d = 0, u = "") => (Number.isFinite(v) ? v.toFixed(d) + u : "–");
  $("ingredients").innerHTML = [
    stat(f(capeMax24, 0, " J/kg"), "Peak CAPE, next 24 h"),
    stat(f(capeMax48, 0, " J/kg"), "Peak CAPE, next 48 h"),
    stat(f(liMin, 1), "Lowest lifted index, 24 h"),
    stat(f(shearMax, 0, " m/s"), "Peak shear (est.), 24 h"),
    stat(`${metThunder24.length} h`, "Thunder hours, 24 h (MET Norway)"),
    stat(`${i24.filter((i) => h.weather_code[i] >= 95).length} h`, "Thunder hours, 24 h (Open-Meteo)"),
    stat(f(gust24, 0, " mph"), "Peak gust, next 24 h"),
    stat(f(rain24, 1, " mm/h"), "Peak rainfall rate, 24 h"),
    stat(hail.length ? "Yes" : "No", "Hail in forecast, 48 h"),
    stat(firstThunder ? fmtTime(firstThunder) : "None", "First thunder"),
    stat(f(h.freezing_level_height[i0], 0, " m"), "Freezing level"),
    stat(f(h.temperature_2m[i0], 1, "°C"), "Temperature (model)"),
  ].join("");

  // Charts
  const kc = { snow: "k-snow", sleet: "k-sleet", rain: "k-rain", thunder: "k-thunder", dry: "k-dry" };
  const tick = (ms) => (new Date(ms).getUTCHours() % 6 === 0 ? fmtTime(ms, { hour: "2-digit" }) + ":00" : "");
  const s48 = steps.slice(0, 48);
  $("thunderChart").innerHTML = s48.length ? barChart(s48.map((x) => ({
    v: x.kind === "thunder" ? Math.max(x.mm, 0.6) : x.mm, cls: kc[x.kind], tip: `${fmtTime(x.time)}: ${x.label}${x.mm ? ", " + x.mm + " mm" : ""}`, tick: tick(new Date(x.time).getTime()),
  })), Math.max(2, ...s48.map((x) => x.mm))) : '<div class="loading">MET Norway forecast unavailable right now.</div>';
  const cls3 = (v, a, b) => (v >= b ? "k-cape3" : v >= a ? "k-cape2" : "k-cape1");
  $("capeChart").innerHTML = barChart(i48.map((i) => ({ v: h.cape[i] ?? 0, cls: cls3(h.cape[i] ?? 0, 300, 1000), tip: `${fmtTime(h.time[i] * 1000)}: CAPE ${Math.round(h.cape[i] ?? 0)} J/kg`, tick: tick(h.time[i] * 1000) })), Math.max(500, max(i48.map((i) => h.cape[i]))));
  $("gustChart").innerHTML = barChart(i48.map((i) => ({ v: h.wind_gusts_10m[i] ?? 0, cls: cls3(h.wind_gusts_10m[i] ?? 0, 40, 60), tip: `${fmtTime(h.time[i] * 1000)}: gusts ${Math.round(h.wind_gusts_10m[i] ?? 0)} mph`, tick: tick(h.time[i] * 1000) })), Math.max(50, max(i48.map((i) => h.wind_gusts_10m[i]))));

  // Chaser table (3-hourly)
  const metAt = (ms) => steps.find((x) => Math.abs(new Date(x.time).getTime() - ms) < 1800e3);
  const rows = i48.filter((_, k) => k % 3 === 0).map((i) => {
    const ms = h.time[i] * 1000, cape = h.cape[i] ?? 0, sh = shear(h, i), m = metAt(ms);
    const th = (m && m.kind === "thunder") || h.weather_code[i] >= 95;
    let rate = "Quiet", c = "";
    if (th && cape >= 1000) { rate = sh >= 15 ? "Organised storms possible" : "Strong storms possible"; c = "bad"; }
    else if (th) { rate = "Thunder possible"; c = "warn"; }
    else if (cape >= 500) { rate = "Showers could turn thundery"; c = "warn"; }
    return `<tr><td>${fmtTime(ms)}</td><td>${Math.round(cape)}</td><td>${h.lifted_index[i] != null ? h.lifted_index[i].toFixed(1) : "–"}</td><td>${sh != null ? sh.toFixed(0) + " m/s" : "–"}</td>
      <td>${Math.round(h.wind_gusts_10m[i] ?? 0)} mph</td><td>${m ? m.icon + " " + m.label : "–"}</td><td class="${c}">${rate}</td></tr>`;
  }).join("");
  $("chaser").innerHTML = "<thead><tr><th>Time</th><th>CAPE</th><th>Lifted index</th><th>Shear</th><th>Gusts</th><th>MET Norway</th><th>Outlook</th></tr></thead><tbody>" + rows + "</tbody>";
}

function pick(i) {
  sel = i;
  const u = new URL(location); u.searchParams.set("p", i); history.replaceState(null, "", u);
  load();
}

renderChrome("storms");
makePicker($("picker"), SITES, sel, pick);
load();
