// Builds station.json from the raw readings Home Assistant sends via a GitHub repository_dispatch.
// Input: DATA env var = JSON like { "updated": "<iso>", "temp_c": { "v": "6.0", "u": "°C" }, ... }
// Only the fields listed in FIELDS are kept, values are range-checked, and text is length-limited.
import { writeFileSync } from "node:fs";

// field -> { unit: target unit, text: keep as string, min/max: sanity range }
const FIELDS = {
  temp_c: { unit: "C", min: -60, max: 60 },
  feels_like_c: { unit: "C", min: -80, max: 70 },
  dew_point_c: { unit: "C", min: -60, max: 40 },
  humidity: { unit: "%", min: 0, max: 100 },
  wind_mph: { unit: "mph", min: 0, max: 250 },
  gust_mph: { unit: "mph", min: 0, max: 300 },
  wind_dir: { unit: "", min: 0, max: 360 },
  pressure_hpa: { unit: "hPa", min: 850, max: 1100 },
  rain_rate_mm_h: { unit: "mm/h", min: 0, max: 500 },
  rain_last_hour_mm: { unit: "mm", min: 0, max: 500 },
  rain_today_mm: { unit: "mm", min: 0, max: 1000 },
  high_24h_c: { unit: "C", min: -60, max: 60 },
  low_24h_c: { unit: "C", min: -60, max: 60 },
  uv_index: { unit: "", min: 0, max: 20 },
  freezing_level_m: { unit: "m", min: -500, max: 12000 },
  frost_risk: { text: true },
  pressure_trend: { text: true },
  lightning_count_1h: { unit: "", min: 0, max: 100000 },
  lightning_rate_per_min: { unit: "", min: 0, max: 10000 },
  thunder_risk_pct: { unit: "", min: 0, max: 100 },
  thunder_risk_level: { text: true },
  lightning_last: { text: true },
  lightning_last_km: { unit: "", min: 0, max: 1000 },
  lightning_last_count: { unit: "", min: 0, max: 100000 },
  alert_message: { text: true },
};

const TO = {
  mph: { mph: 1, "km/h": 0.621371, "m/s": 2.23694, kn: 1.15078 },
  hPa: { hPa: 1, mbar: 1, inHg: 33.8639, kPa: 10 },
  mm: { mm: 1, in: 25.4 },
  "mm/h": { "mm/h": 1, "in/h": 25.4 },
  m: { m: 1, ft: 0.3048 },
};
const convert = (v, from, to) => {
  if (to === "C") return from === "°F" ? (v - 32) * 5 / 9 : v;
  const f = TO[to]?.[from];
  return f == null ? v : v * f;
};

let data;
try {
  data = JSON.parse(process.env.DATA || "");
  if (typeof data === "string") data = JSON.parse(data); // tolerate double-encoded JSON
} catch { console.error("DATA is not valid JSON"); process.exit(1); }
if (!data || typeof data !== "object") { console.error("DATA must be a JSON object"); process.exit(1); }

const updated = new Date(data.updated);
if (Number.isNaN(updated.getTime())) { console.error("Missing or invalid 'updated' timestamp"); process.exit(1); }

const out = { updated: updated.toISOString(), online: true };
let ok = 0;
for (const [key, spec] of Object.entries(FIELDS)) {
  const item = data[key];
  if (!item || item.v == null || ["unknown", "unavailable", ""].includes(String(item.v))) continue;
  if (spec.text) { out[key] = String(item.v).slice(0, 60); ok++; continue; }
  const n = parseFloat(item.v);
  if (!Number.isFinite(n)) continue;
  const v = Math.round(convert(n, item.u ?? "", spec.unit) * 10) / 10;
  if (v < spec.min || v > spec.max) { console.warn(`Skipping ${key}: ${v} out of range`); continue; }
  out[key] = v; ok++;
}
if (!ok) { console.error("No usable readings in payload"); process.exit(1); }
writeFileSync("station.json", JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote station.json with ${ok} readings, updated ${out.updated}`);
