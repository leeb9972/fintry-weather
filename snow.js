"use strict";

const HILLS = [
  { name: "⛰ Glas Maol (Glenshee)", lat: 56.8776, lon: -3.3445, elev: 1068 },
  { name: "⛰ Lochnagar", lat: 56.9608, lon: -3.2445, elev: 1155 },
  { name: "⛰ Driesh (Angus glens)", lat: 56.8497, lon: -3.0958, elev: 947 },
  { name: "⛰ Ben Lawers", lat: 56.5447, lon: -4.2208, elev: 1214 },
  { name: "⛰ Schiehallion", lat: 56.6666, lon: -4.1017, elev: 1083 },
  { name: "⛰ Cairn Gorm", lat: 57.1166, lon: -3.6425, elev: 1245 },
  { name: "⛰ Ben Nevis", lat: 56.7969, lon: -5.0036, elev: 1345 },
];
const SITES = PLACES.concat(HILLS.map((h) => ({ ...h, hill: true })));
let sel = Math.min(Number(new URLSearchParams(location.search).get("p")) || 0, SITES.length - 1);

const OM_VARS = "temperature_2m,precipitation,snowfall,snow_depth,freezing_level_height,weather_code,wind_gusts_10m,soil_temperature_0cm,relative_humidity_2m";
const omUrl = (lats, lons, elevs) => `${API}?latitude=${lats}&longitude=${lons}${elevs ? "&elevation=" + elevs : ""}` +
  `&hourly=${OM_VARS}&forecast_days=4&past_days=1&timeformat=unixtime` + COMMON;

// Hourly index containing "now"
const nowIndex = (times) => Math.max(0, times.findIndex((t) => t * 1000 + 3600e3 > Date.now()));
const sum = (a, from, n) => a.slice(from, from + n).reduce((x, y) => x + (y ?? 0), 0);
const snowLevel = (fl) => (fl == null ? null : Math.max(0, fl - 300)); // rule of thumb: snow reaches about 300 m below the freezing level

// Turn Open-Meteo output into a simple wet/dry/snow class for comparing with MET Norway
function omKind(snow, precip, temp) {
  if (snow >= 0.1) return "snow";
  if (precip >= 0.2) return temp <= 1 ? "sleet" : "rain";
  return "dry";
}

async function load() {
  const s = SITES[sel];
  $("verdict").innerHTML = '<div class="loading">Loading snow forecast…</div>';
  try {
    const [om, met] = await Promise.all([
      fetch(omUrl(s.lat, s.lon, s.hill ? s.elev : null)).then((r) => { if (!r.ok) throw new Error("Open-Meteo " + r.status); return r.json(); }),
      fetchMet(s.lat, s.lon, s.hill ? s.elev : null).catch(() => null),
      loadStation(),
    ]);
    render(s, om, met);
  } catch (e) {
    $("verdict").innerHTML = `<div class="loading">Couldn't load the forecast (${esc(e.message)}). Check your connection and try again.</div>`;
  }
  if (!hillsLoaded) { hillsLoaded = true; loadHills(); }
}
let hillsLoaded = false;

// MET Norway steps with 1-hour data
function metSteps(met) {
  if (!met) return [];
  return met.filter((t) => t.data.next_1_hours && new Date(t.time).getTime() + 3600e3 > Date.now()).map((t) => {
    const code = t.data.next_1_hours.summary.symbol_code, [icon, label, kind] = metSym(code);
    return { time: t.time, icon, label, kind, mm: t.data.next_1_hours.details?.precipitation_amount ?? 0, temp: t.data.instant.details.air_temperature };
  });
}

function render(s, om, met) {
  const h = om.hourly, i0 = nowIndex(h.time), steps = metSteps(met);
  const elev = om.elevation;
  const useStation = station && sel === 0;
  const temp = useStation && station.temp_c != null ? station.temp_c : h.temperature_2m[i0];
  const fl = h.freezing_level_height[i0], sl = snowLevel(fl);
  const snowNow = h.snowfall[i0] ?? 0, depthCm = (h.snow_depth[i0] ?? 0) * 100;
  const m0 = steps[0];
  const snow24 = sum(h.snowfall, i0, 24), snow48 = sum(h.snowfall, i0, 48), snow72 = sum(h.snowfall, i0, 72), past24 = sum(h.snowfall, Math.max(0, i0 - 24), 24);
  const lowTemp = Math.min(...h.temperature_2m.slice(i0, i0 + 48));
  $("siteInfo").textContent = `${esc(s.name)} · ${Math.round(elev)} m above sea level`;

  // Headline
  const metKind = m0?.kind, omK = omKind(snowNow, h.precipitation[i0] ?? 0, temp);
  let lvl = "", title, text;
  if (metKind === "snow" || omK === "snow") { lvl = "amber"; title = "❄️ Snow falling or imminent"; text = `Snow is ${snowNow >= 0.1 ? `forecast at ${snowNow.toFixed(1)} cm/hour` : "indicated by MET Norway"} for ${esc(s.name)} right now.`; }
  else if (metKind === "sleet" || omK === "sleet") { lvl = "amber"; title = "🌨️ Sleet"; text = "Wet, mixed precipitation. Surfaces may turn icy as temperatures fall."; }
  else if (m0?.kind === "rain" && temp <= 1.5) { lvl = "amber"; title = "🌧️ Rain near freezing"; text = "Rain but cold enough that snow or ice is close by. Higher ground may see snow."; }
  else if (m0?.kind === "rain" || omK === "rain") { title = "🌧️ Rain, not snow"; text = "It's too mild for snow here right now."; }
  else if (temp <= 0) { lvl = "amber"; title = "🧊 Dry but freezing"; text = "No precipitation expected right now, but there's a frost and ice risk."; }
  else { title = "✅ No snow right now"; text = "Nothing wintry at the moment."; }
  const firstSnow = steps.find((x) => x.kind === "snow" || x.kind === "sleet");
  const omFirst = h.snowfall.findIndex((v, i) => i >= i0 && v >= 0.1);
  let next = "";
  if (!(metKind === "snow") && (firstSnow || omFirst >= 0)) {
    const t = firstSnow ? fmtTime(firstSnow.time) : fmtTime(h.time[omFirst] * 1000);
    next = ` Next wintry precipitation: ${t}.`;
  } else if (snow72 < 0.1 && !firstSnow) next = " No snow in the 72 hour forecast from either model.";
  $("verdict").innerHTML = `<div class="alert ${lvl}"><strong>${title}</strong>${esc(text)}${next}</div>` +
    `<div class="sub" style="margin-top:8px">${useStation ? "● Temperature from the Fintry weather station. " : ""}Snow level is an estimate: the freezing level minus about 300 m.</div>`;

  // Stats
  const diff = sl != null ? Math.round(sl - elev) : null;
  const stat = (b, l) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`;
  $("snowStats").innerHTML = [
    stat(`${t1(temp)}°C`, useStation ? "Temperature (station)" : "Temperature"),
    stat(fl != null ? `${Math.round(fl)} m` : "–", "Freezing level"),
    stat(sl != null ? `${Math.round(sl)} m` : "–", diff == null ? "Snow level" : diff > 0 ? `Snow level (${diff} m above here)` : `Snow level (${-diff} m below here)`),
    stat(`${depthCm.toFixed(depthCm < 10 ? 1 : 0)} cm`, "Snow on the ground (model)"),
    stat(`${snowNow.toFixed(1)} cm/h`, "Snowfall now"),
    stat(`${past24.toFixed(1)} cm`, "Snowfall last 24 h"),
    stat(`${snow24.toFixed(1)} cm`, "Snowfall next 24 h"),
    stat(`${snow72.toFixed(1)} cm`, "Snowfall next 72 h"),
    stat(`${t1(lowTemp)}°C`, "Lowest next 48 h"),
    stat(`${Math.round(h.wind_gusts_10m.slice(i0, i0 + 24).reduce((a, b) => Math.max(a, b ?? 0), 0))} mph`, "Peak gust next 24 h"),
    stat(m0 ? `${m0.icon} ${m0.label}` : "–", "MET Norway: now"),
    stat(`${snow48 >= 0.1 ? "Yes" : "No"}`, "Snow in next 48 h"),
  ].join("");

  // Charts
  const kc = { snow: "k-snow", sleet: "k-sleet", rain: "k-rain", thunder: "k-thunder", dry: "k-dry" };
  const s48 = steps.slice(0, 48);
  $("metChart").innerHTML = s48.length ? barChart(s48.map((x, i) => ({
    v: x.mm, cls: kc[x.kind], tip: `${fmtTime(x.time)}: ${x.label}, ${x.mm} mm, ${t1(x.temp)}°C`,
    tick: new Date(x.time).getUTCHours() % 6 === 0 ? fmtTime(x.time, { hour: "2-digit" }) + ":00" : "",
  })), Math.max(2, ...s48.map((x) => x.mm))) : '<div class="loading">MET Norway forecast unavailable right now.</div>';

  const idx72 = Array.from({ length: 72 }, (_, k) => i0 + k).filter((i) => i < h.time.length);
  $("omChart").innerHTML = barChart(idx72.map((i) => ({
    v: h.snowfall[i] ?? 0, cls: "k-snow", tip: `${fmtTime(h.time[i] * 1000)}: ${(h.snowfall[i] ?? 0).toFixed(1)} cm, ${t1(h.temperature_2m[i])}°C`,
    tick: new Date(h.time[i] * 1000).getUTCHours() % 6 === 0 ? fmtTime(h.time[i] * 1000, { hour: "2-digit" }) + ":00" : "",
  })), Math.max(1, ...idx72.map((i) => h.snowfall[i] ?? 0)));
  $("levelRow").innerHTML = idx72.filter((_, k) => k % 6 === 0).map((i) => {
    const l = snowLevel(h.freezing_level_height[i]);
    return `<div><b>${l != null ? Math.round(l) : "–"}</b><span>${fmtTime(h.time[i] * 1000, { weekday: "short", hour: "2-digit" })}h</span></div>`;
  }).join("");

  renderCompare(h, i0, met);
  renderIce(h, i0, useStation);
}

function renderCompare(h, i0, met) {
  if (!met) { $("compare").innerHTML = "<tr><td>MET Norway forecast unavailable right now.</td></tr>"; return; }
  const blocks = met.filter((t) => t.data.next_6_hours && new Date(t.time).getUTCHours() % 6 === 0 && new Date(t.time).getTime() + 6 * 3600e3 > Date.now()).slice(0, 10);
  const rows = blocks.map((t) => {
    const t0 = new Date(t.time).getTime();
    const [icon, label, mk] = metSym(t.data.next_6_hours.summary.symbol_code);
    const mm = t.data.next_6_hours.details?.precipitation_amount ?? 0;
    const idx = h.time.map((x, i) => i).filter((i) => h.time[i] * 1000 >= t0 && h.time[i] * 1000 < t0 + 6 * 3600e3);
    const sn = sum(idx.map((i) => h.snowfall[i]), 0, 6), pr = sum(idx.map((i) => h.precipitation[i]), 0, 6);
    const tmp = idx.length ? idx.reduce((a, i) => a + h.temperature_2m[i], 0) / idx.length : null;
    const ok = omKind(sn, pr, tmp ?? 5);
    const wet = (k) => (k === "dry" ? 0 : k === "rain" ? 1 : 2);
    const agree = wet(mk === "thunder" ? "rain" : mk) === wet(ok);
    return `<tr><td>${fmtTime(t0)}</td><td>${icon} ${label}</td><td>${mm.toFixed(1)} mm</td><td>${sn.toFixed(1)} cm snow, ${pr.toFixed(1)} mm</td>
      <td>${tmp != null ? t1(tmp) + "°C" : "–"}</td><td class="${agree ? "good" : "bad"}">${agree ? "✓ Agree" : "✗ Differ"}</td></tr>`;
  }).join("");
  $("compare").innerHTML = "<thead><tr><th>6 h from</th><th>MET Norway</th><th>Precip</th><th>Open-Meteo</th><th>Avg temp</th><th></th></tr></thead><tbody>" + rows + "</tbody>";
}

function renderIce(h, i0, useStation) {
  const out = [];
  const n = 36, idx = Array.from({ length: n }, (_, k) => i0 + k).filter((i) => i < h.time.length);
  const when = (i) => fmtTime(h.time[i] * 1000);
  const wintry = idx.filter((i) => h.temperature_2m[i] <= 1 && (h.precipitation[i] ?? 0) >= 0.1);
  if (wintry.length) out.push(["amber", "Wintry precipitation possible", `${wintry.length} hour${wintry.length > 1 ? "s" : ""} of precipitation at or below 1°C between ${when(wintry[0])} and ${when(wintry[wintry.length - 1])}.`]);
  // Black ice: road surface (ground) at or below freezing after wet weather or in damp air
  const ice = idx.filter((i) => {
    const wetBefore = sum(h.precipitation, Math.max(0, i - 6), 6) >= 0.2;
    return (h.soil_temperature_0cm[i] ?? 99) <= 0.5 && (wetBefore || (h.relative_humidity_2m[i] ?? 0) >= 90);
  });
  if (ice.length) out.push(["amber", "Black ice risk", `Ground at or below freezing in damp conditions between ${when(ice[0])} and ${when(ice[ice.length - 1])}. Take care on untreated roads and paths.`]);
  const frost = idx.filter((i) => h.temperature_2m[i] <= 0);
  if (frost.length && !ice.length) out.push(["amber", "Air frost", `Temperatures at or below freezing for ${frost.length} hour${frost.length > 1 ? "s" : ""}, starting ${when(frost[0])}.`]);
  if (useStation) out.push([station.frost_risk && station.frost_risk !== "no_risk" ? "amber" : "", "Fintry station frost risk", `Your station reports: ${esc(String(station.frost_risk || "no data").replace(/_/g, " "))}. Dew point ${t1(station.dew_point_c ?? 0)}°C, air temperature ${t1(station.temp_c ?? 0)}°C.`]);
  if (!out.length) out.push(["", "No frost or ice expected", "Temperatures stay above freezing with no wintry precipitation in the next 36 hours."]);
  $("iceBody").innerHTML = out.map(([l, t, s]) => `<div class="alert ${l}"><strong>${esc(t)}</strong>${s}</div>`).join("") +
    '<small class="sub">Automated guide from model output. Not an official warning.</small>';
}

async function loadHills() {
  try {
    const res = await fetch(omUrl(HILLS.map((x) => x.lat).join(","), HILLS.map((x) => x.lon).join(","), HILLS.map((x) => x.elev).join(",")));
    if (!res.ok) throw new Error(res.status);
    let arr = await res.json(); if (!Array.isArray(arr)) arr = [arr];
    const mets = await Promise.all(HILLS.map((x) => fetchMet(x.lat, x.lon, x.elev).catch(() => null)));
    $("hills").innerHTML = "<thead><tr><th>Hill</th><th>Height</th><th>Temp</th><th>Snow level</th><th>Snow cover</th><th>Snow 24 h</th><th>Snow 72 h</th><th>Gusts 24 h</th><th>MET Norway 24 h</th></tr></thead><tbody>" +
      HILLS.map((x, k) => {
        const h = arr[k].hourly, i0 = nowIndex(h.time), sl = snowLevel(h.freezing_level_height[i0]);
        const st = metSteps(mets[k]).slice(0, 24);
        const kinds = new Set(st.map((z) => z.kind));
        const worst = ["thunder", "snow", "sleet", "rain"].find((q) => kinds.has(q));
        const mm = st.reduce((a, z) => a + z.mm, 0);
        const gust = Math.round(h.wind_gusts_10m.slice(i0, i0 + 24).reduce((a, b) => Math.max(a, b ?? 0), 0));
        const label = !st.length ? "–" : worst ? `${metSym(worst === "rain" ? "rain" : worst === "snow" ? "snow" : worst === "sleet" ? "sleet" : "rainandthunder")[0]} ${worst}, ${mm.toFixed(1)} mm` : "Dry";
        return `<tr data-i="${PLACES.length + k}"><td>${esc(x.name.replace("⛰ ", ""))}</td><td>${x.elev} m</td><td>${t1(h.temperature_2m[i0])}°C</td>
          <td>${sl != null ? Math.round(sl) + " m" : "–"}</td><td>${((h.snow_depth[i0] ?? 0) * 100).toFixed(0)} cm</td>
          <td>${sum(h.snowfall, i0, 24).toFixed(1)} cm</td><td>${sum(h.snowfall, i0, 72).toFixed(1)} cm</td><td>${gust} mph</td><td>${label}</td></tr>`;
      }).join("") + "</tbody>";
    $("hills").querySelector("tbody").onclick = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      pick(Number(tr.dataset.i)); window.scrollTo({ top: 0, behavior: "smooth" });
    };
  } catch (e) { $("hills").innerHTML = `<tr><td>Couldn't load hill forecasts (${esc(e.message)}).</td></tr>`; }
}

function pick(i) {
  sel = i;
  [...$("picker").children].forEach((b, k) => b.classList.toggle("on", k === i));
  const u = new URL(location); u.searchParams.set("p", i); history.replaceState(null, "", u);
  load();
}

renderChrome("snow");
makePicker($("picker"), SITES, sel, pick);
load();
