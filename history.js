"use strict";

const RANGES = [["24h", "24 hours", 1], ["7d", "7 days", 7], ["30d", "30 days", 30], ["90d", "90 days", 90], ["all", "All time", Infinity]];
let rangeIdx = Math.max(0, RANGES.findIndex((r) => r[0] === new URLSearchParams(location.search).get("r")));
if (rangeIdx < 0 || !new URLSearchParams(location.search).get("r")) rangeIdx = 2;
let all = null;

const dayFmt = { weekday: "short", day: "numeric", month: "short" };
const dtFmt = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
const f = (v, d = 1) => (v == null ? "–" : Number(v).toFixed(d));

function render() {
  const [, , days] = RANGES[rangeIdx];
  const last = all.at(-1).t + HOUR;
  const rows = all.filter((r) => r.t >= last - days * DAY);
  // Up to 30 days: one point per hour. Longer: one point per day, so the charts stay readable.
  const daily = days > 30;
  const data = daily ? historyByDay(rows) : rows;
  const span = Math.max(1, Math.round((last - rows[0].t) / DAY));
  const dayRows = historyByDay(rows);

  // Summary
  const hot = rows.reduce((a, r) => (r.tmax != null && (!a || r.tmax > a.tmax) ? r : a), null);
  const cold = rows.reduce((a, r) => (r.tmin != null && (!a || r.tmin < a.tmin) ? r : a), null);
  const gusty = rows.reduce((a, r) => (r.gust != null && (!a || r.gust > a.gust) ? r : a), null);
  const wet = dayRows.reduce((a, d) => (!a || d.rain > a.rain ? d : a), null);
  const pHi = hmax(rows, "press"), pLo = hmin(rows, "press");
  const total = hsum(rows, "rain");
  const stat = (b, l) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`;
  $("summary").innerHTML = `<div class="stats grid4">${[
    stat(`${f(hot?.tmax)}°C`, `Highest temperature<br>${hot ? fmtTime(hot.t, daily || span > 2 ? dayFmt : dtFmt) : ""}`),
    stat(`${f(cold?.tmin)}°C`, `Lowest temperature<br>${cold ? fmtTime(cold.t, daily || span > 2 ? dayFmt : dtFmt) : ""}`),
    stat(`${f(havg(rows, "temp"))}°C`, "Average temperature"),
    stat(`${f(gusty?.gust)} mph`, `Strongest gust<br>${gusty ? fmtTime(gusty.t, daily || span > 2 ? dayFmt : dtFmt) : ""}`),
    stat(`${f(havg(rows, "wind"))} mph`, "Average wind"),
    stat(`${f(total)} mm`, `Total rain over ${span} day${span === 1 ? "" : "s"}`),
    stat(wet && wet.rain > 0 ? `${f(wet.rain)} mm` : "–", `Wettest day${wet && wet.rain > 0 ? "<br>" + fmtTime(wet.t, dayFmt) : ""}`),
    stat(`${f(pLo, 0)}–${f(pHi, 0)} hPa`, "Pressure range"),
  ].join("")}</div>` +
    `<div class="hist-note">${fmtTime(rows[0].t, dtFmt)} to ${fmtTime(last, dtFmt)}. Station records go back to ${fmtTime(all[0].t, { day: "numeric", month: "long", year: "numeric" })}.</div>`;

  // Charts
  const draw = (id, key) => histChart($(id), metricSeries(key, data, daily), { unit: HIST_METRICS[key].unit, dec: HIST_METRICS[key].dec });
  draw("cTemp", "temp"); draw("cWind", "wind"); draw("cRain", "rain"); draw("cPress", "press"); draw("cHum", "hum");
  $("tempSub").textContent = daily ? "daily average, with the daily low to high range" : "hourly, with the low to high range within each hour";
  $("rainSub").textContent = daily ? "total per day" : "total per hour";

  // Daily table, newest first
  const shown = dayRows.slice().reverse().slice(0, 120);
  $("dailyTable").innerHTML = `<thead><tr><th>Date</th><th>High</th><th>Low</th><th>Average</th><th>Rain</th><th>Avg wind</th><th>Max gust</th><th>Pressure</th></tr></thead><tbody>` +
    shown.map((d) => `<tr style="cursor:default"><td>${fmtTime(d.t, { weekday: "short", day: "numeric", month: "short", year: span > 300 ? "numeric" : undefined })}</td><td>${f(d.tmax)}°</td><td>${f(d.tmin)}°</td><td>${f(d.temp)}°</td><td>${f(d.rain)} mm</td><td>${f(d.wind)} mph</td><td>${f(d.gust)} mph</td><td>${f(d.press, 0)} hPa</td></tr>`).join("") + "</tbody>";
}

async function init() {
  renderChrome("history");
  makePicker($("ranges"), RANGES.map((r) => ({ name: r[1] })), rangeIdx, (i) => { rangeIdx = i; history.replaceState(null, "", "?r=" + RANGES[i][0]); render(); });
  all = await loadHistory();
  if (!all || !all.length) { $("summary").innerHTML = '<div class="loading">History is not available right now. Try again in a few minutes.</div>'; return; }
  render();
}
init();
