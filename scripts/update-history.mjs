// Adds the latest station reading to history.json (hourly buckets, kept for a year).
// Usage: node scripts/update-history.mjs [station.json] [history.json]
// Run by the deploy workflow after station.json is built. history.json is carried over from the
// live site between deployments, so no extra commits are needed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const COLS = ["t", "temp", "tmin", "tmax", "hum", "wind", "gust", "press", "rain", "n"];
const KEEP_DAYS = 365;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

export function emptyHistory() {
  return { v: 1, updated: null, last: null, cols: COLS, rows: [] };
}

// Folds one reading into the hourly bucket it belongs to. Returns false if it was ignored.
export function addReading(h, s) {
  const when = new Date(s.updated);
  if (Number.isNaN(when.getTime())) return false;
  if (h.last && new Date(h.last.t) >= when) return false; // already applied, or older than what we have
  const t = Math.floor(when.getTime() / 3600e3) * 3600;

  let rain = 0;
  const rt = num(s.rain_today_mm);
  if (rt != null) {
    const prev = h.last?.rain_today;
    // rain_today resets at midnight: a fall means a new day, so everything shown is new rain
    rain = prev == null ? 0 : rt >= prev ? rt - prev : rt;
  }

  let row = h.rows.find((r) => r[0] === t);
  const temp = num(s.temp_c), hum = num(s.humidity), wind = num(s.wind_mph), gust = num(s.gust_mph), press = num(s.pressure_hpa);
  if (!row) {
    row = [t, temp, temp, temp, hum, wind, gust, press, 0, 0];
    h.rows.push(row);
    h.rows.sort((a, b) => a[0] - b[0]);
    row[8] = round(rain, 2);
    row[9] = 1;
  } else {
    const n = row[9] || 1;
    const mean = (old, v) => (v == null ? old : old == null ? v : (old * n + v) / (n + 1));
    row[1] = round(mean(row[1], temp));
    row[2] = temp == null ? row[2] : row[2] == null ? temp : Math.min(row[2], temp);
    row[3] = temp == null ? row[3] : row[3] == null ? temp : Math.max(row[3], temp);
    row[4] = round(mean(row[4], hum), 0);
    row[5] = round(mean(row[5], wind));
    row[6] = gust == null ? row[6] : row[6] == null ? gust : Math.max(row[6], gust);
    row[7] = round(mean(row[7], press));
    row[8] = round((row[8] || 0) + rain, 2);
    row[9] = n + 1;
  }
  h.last = { t: when.toISOString(), rain_today: rt ?? h.last?.rain_today ?? null };
  h.updated = new Date().toISOString();
  const cutoff = Date.now() / 1000 - KEEP_DAYS * 86400;
  h.rows = h.rows.filter((r) => r[0] >= cutoff);
  return true;
}

// CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [stationFile = "station.json", historyFile = "history.json"] = process.argv.slice(2);
  let h = emptyHistory();
  if (existsSync(historyFile)) {
    try { h = JSON.parse(readFileSync(historyFile, "utf8")); if (!Array.isArray(h.rows)) throw new Error("no rows"); }
    catch (e) { console.error(`Cannot read ${historyFile}: ${e.message}`); process.exit(1); }
  }
  const s = JSON.parse(readFileSync(stationFile, "utf8"));
  const changed = addReading(h, s);
  writeFileSync(historyFile, JSON.stringify(h) + "\n");
  console.log(changed ? `History updated: ${h.rows.length} hourly rows` : `History unchanged: ${h.rows.length} hourly rows`);
}
