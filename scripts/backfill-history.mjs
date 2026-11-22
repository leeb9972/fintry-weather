// One-off: seeds history.json from Home Assistant's long-term statistics (hourly).
// Usage (Node 22+):  HA_URL=http://127.0.0.1:8123 HA_TOKEN=<long-lived token> node scripts/backfill-history.mjs [days]
// The token stays on your machine; only the resulting history.json is committed.
import { writeFileSync } from "node:fs";
import { COLS, emptyHistory } from "./update-history.mjs";

const { HA_URL = "http://127.0.0.1:8123", HA_TOKEN } = process.env;
if (!HA_TOKEN) { console.error("Set HA_TOKEN"); process.exit(1); }
const days = Number(process.argv[2]) || 365;

const IDS = {
  temp: "sensor.ws_temperature",
  hum: "sensor.ws_humidity",
  wind: "sensor.ecowitt_wind_speed_db",
  gust: "sensor.ecowitt_wind_gust_db",
  press: "sensor.ws_sea_level_pressure",
  rain: "sensor.ecowitt_daily_rain_db",
};

const ws = new WebSocket(HA_URL.replace(/^http/, "ws") + "/api/websocket");
let id = 0;
const pending = new Map();
const send = (msg) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, ...msg })); });
const authed = new Promise((ok, fail) => {
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
    else if (m.type === "auth_ok") ok();
    else if (m.type === "auth_invalid") fail(new Error("HA rejected the token"));
    else if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.success === false ? p.fail(new Error(m.error?.message)) : p.ok(m.result); }
  };
  ws.onerror = () => fail(new Error(`Cannot reach ${HA_URL}`));
});
await authed;

const start = new Date(Date.now() - days * 86400e3).toISOString();
const stats = await send({
  type: "recorder/statistics_during_period",
  start_time: start,
  statistic_ids: Object.values(IDS),
  period: "hour",
  types: ["mean", "min", "max", "change"],
  units: { speed: "mph", temperature: "°C", pressure: "hPa", distance: "mm" },
});
ws.close();

const rows = new Map(); // hour (s) -> row
const at = (t) => { if (!rows.has(t)) rows.set(t, [t, null, null, null, null, null, null, null, null, 6]); return rows.get(t); };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
for (const [key, sid] of Object.entries(IDS)) {
  for (const p of stats[sid] || []) {
    const row = at(Math.round(p.start / 1000));
    // min/max more than 8 degrees from the hourly mean are sensor glitches: fall back to the mean
    if (key === "temp") { row[1] = r1(p.mean); row[2] = Math.abs(p.min - p.mean) > 8 ? row[1] : r1(p.min); row[3] = Math.abs(p.max - p.mean) > 8 ? row[1] : r1(p.max); }
    if (key === "hum") row[4] = p.mean == null ? null : Math.round(p.mean);
    if (key === "wind") row[5] = r1(p.mean);
    if (key === "gust") row[6] = r1(p.max ?? p.mean);
    if (key === "press") row[7] = r1(p.mean);
    if (key === "rain") row[8] = p.change == null ? null : Math.round(Math.max(0, p.change) * 100) / 100;
  }
  console.log(sid, (stats[sid] || []).length, "hourly points");
}

const h = emptyHistory();
h.cols = COLS;
h.rows = [...rows.values()].sort((a, b) => a[0] - b[0]);
h.updated = new Date().toISOString();
writeFileSync(new URL("../history.json", import.meta.url), JSON.stringify(h) + "\n");
console.log(`Wrote history.json: ${h.rows.length} rows, ${new Date(h.rows[0][0] * 1000).toISOString()} to ${new Date(h.rows.at(-1)[0] * 1000).toISOString()}`);
