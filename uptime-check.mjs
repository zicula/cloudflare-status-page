#!/usr/bin/env node
// uptime-check.mjs — one run = one uptime data point per system, written into
// the status page's uptime.json (the file the bars on the page render from).
//
//   node uptime-check.mjs                       # check all systems in the status page's config.json
//   node uptime-check.mjs --fail-on-down        # exit 1 when anything is DOWN (cron alerting)
//   node uptime-check.mjs --demo-clear          # empty the shipped demo history before real runs
//
// Node 18.17+, ZERO npm dependencies (stdlib + built-in fetch only).
// Reads the SAME config.json the status page uses — one config drives both.
// Exits: 0 ok · 1 any DOWN (only with --fail-on-down) · 2 config/usage error.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = resolve(HERE, "../status-page/config.json");
const DEFAULT_UPTIME = resolve(HERE, "../status-page/uptime.json");

function usage() {
  console.log(`uptime-check.mjs ${VERSION} — uptime checks that feed the status page's bar chart

USAGE
  node uptime-check.mjs [options]

OPTIONS
  --config <file>    status page config.json (default: ../status-page/config.json)
  --uptime <file>    uptime history file to update (default: ../status-page/uptime.json)
  --timeout <ms>     per-request timeout (default 10000)
  --slow-ms <ms>     latency above this is flagged SLOW in the log (still "up")
  --max-days <n>     days of history kept in uptime.json (default 180)
  --fail-on-down     exit 1 when any system is DOWN — for cron/CI alerting
  --demo-clear       delete all demo history rows and counters, then exit
  --quiet, -q        minimal output
  --version, --help

WHAT ONE RUN DOES
  For every system in config.json that has a check_url: HTTP HEAD with GET
  fallback (redirects followed, max 5), latency measured to final headers.
  UP = HTTP 200-299. Reachable-but-not-ok (401/403/429, redirect loop) counts
  as up for uptime math but is logged. DNS failure, timeout or other 4xx/5xx
  counts as DOWN for that run. The day's tally is folded into uptime.json as
  a percentage per system per day — that is what the status page renders.

HONEST SCOPE
  Checks come from one vantage point (wherever this runs — your machine, a
  cron box, or GitHub Actions). HEAD checks do not execute JavaScript, so a
  JS-broken page can still answer 200. This is a check producer for YOUR
  status page — not a hosted monitoring platform, no alerting service, no SLA.
`);
}

const argv = process.argv.slice(2);
const opt = {
  config: DEFAULT_CONFIG, uptime: DEFAULT_UPTIME, timeout: 10000,
  slowMs: 2000, maxDays: 180, failOnDown: false, demoClear: false, quiet: false,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") { usage(); process.exit(0); }
  else if (a === "--version" || a === "-v") { console.log(`uptime-check.mjs ${VERSION}`); process.exit(0); }
  else if (a === "--config") opt.config = resolve(argv[++i] || "");
  else if (a === "--uptime") opt.uptime = resolve(argv[++i] || "");
  else if (a === "--timeout") opt.timeout = Math.max(1000, parseInt(argv[++i], 10) || 10000);
  else if (a === "--slow-ms") opt.slowMs = Math.max(1, parseInt(argv[++i], 10) || 2000);
  else if (a === "--max-days") opt.maxDays = Math.max(1, parseInt(argv[++i], 10) || 180);
  else if (a === "--fail-on-down") opt.failOnDown = true;
  else if (a === "--demo-clear") opt.demoClear = true;
  else if (a === "--quiet" || a === "-q") opt.quiet = true;
  else { console.error(`Unknown option: ${a} (see --help)`); process.exit(2); }
}

function loadJSON(path, what) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { console.error(`Cannot read ${what}: ${path} (${e.message})`); process.exit(2); }
  try { return JSON.parse(raw); }
  catch (e) { console.error(`${what} is not valid JSON: ${path} — ${e.message}`); process.exit(2); }
}

const config = loadJSON(opt.config, "config");
const systems = (config.systems || []).filter((s) => s && s.id && s.check_url);
if (!systems.length && !opt.demoClear) {
  console.error("No systems with an id and check_url in the config — nothing to check.");
  process.exit(2);
}

if (opt.demoClear) {
  const doc = { _note: (loadJSON(opt.uptime, "uptime")._note) || "", version: 1, window_days: opt.maxDays, generated_at: new Date().toISOString(), days: [], _counts: {} };
  writeAtomic(opt.uptime, doc);
  if (!opt.quiet) console.log("uptime history cleared (demo rows removed): " + opt.uptime);
  process.exit(0);
}

function writeAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, JSON.stringify(obj, null, 1) + "\n", "utf8");
  renameSync(tmp, path);
}

function todayUTC() { return new Date().toISOString().slice(0, 10); }

async function check(url) {
  const t0 = Date.now();
  let u = url, method = "HEAD";
  for (let hop = 0; hop < 6; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opt.timeout);
    let res;
    try {
      res = await fetch(u, { method, redirect: "manual", signal: ctl.signal,
        headers: { "user-agent": "uptime-check/1.0 (self-hosted status page kit)" } });
    } catch (e) {
      clearTimeout(timer);
      return { lv: "down", s: 0, ms: Date.now() - t0, why: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message || "network error") };
    }
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { lv: "down", s: res.status, ms, why: "redirect without Location" };
      u = new URL(loc, u).toString();
      if (hop === 5) return { lv: "down", s: res.status, ms, why: "too many redirects" };
      continue;
    }
    if (res.status === 405 || res.status === 501) { method = "GET"; continue; }
    let lv = "ok", why = "";
    if (res.status >= 200 && res.status <= 299) {
      if (ms > opt.slowMs) { lv = "slow"; why = "slow response"; }
    } else if ([401, 403, 429].includes(res.status)) { lv = "warn"; why = "reachable but not ok"; }
    else { lv = "down"; why = "HTTP " + res.status; }
    return { lv, s: res.status, ms, why };
  }
  return { lv: "down", s: 0, ms: Date.now() - t0, why: "unreachable" };
}

const doc = loadJSON(opt.uptime, "uptime");
if (doc.version !== 1 || !Array.isArray(doc.days)) {
  console.error("uptime file has unexpected shape (version 1 with days[] expected): " + opt.uptime);
  process.exit(2);
}
if (!doc._counts || typeof doc._counts !== "object") doc._counts = {};

const today = todayUTC();
const counts = doc._counts[today] || (doc._counts[today] = {});
let anyDown = false;

for (const sys of systems) {
  const r = await check(sys.check_url);
  const up = r.lv === "ok" || r.lv === "slow" || r.lv === "warn";
  if (!up) anyDown = true;
  const c = counts[sys.id] || (counts[sys.id] = [0, 0]);
  if (up) c[0] += 1;
  c[1] += 1;
  const pct = c[1] ? (c[0] / c[1]) * 100 : null;
  const mark = up ? (r.lv === "ok" ? "UP  " : "UP* ") : "DOWN";
  if (!opt.quiet) {
    console.log(`[${mark}] ${sys.id} — ${sys.check_url} ${r.s || "-"} ${r.ms}ms`
      + (r.why ? ` (${r.why})` : "")
      + (pct != null ? ` · today ${pct.toFixed(pct >= 99 && pct < 99.995 ? 2 : 1)}% (${c[0]}/${c[1]} runs)` : ""));
  }
}

// fold today's counts into days[]
const pctOf = (id) => {
  const c = counts[id];
  return c && c[1] ? Math.round((c[0] / c[1]) * 10000) / 100 : null;
};
let todayRow = doc.days.find((d) => d.date === today);
if (!todayRow) { todayRow = { date: today, systems: {} }; doc.days.push(todayRow); }
todayRow.systems = {};
for (const id of Object.keys(counts)) todayRow.systems[id] = pctOf(id);

// trim to window (system ids no longer in config simply age out with the days)
doc.days = doc.days.slice(-opt.maxDays);
for (const k of Object.keys(doc._counts)) if (k < today) delete doc._counts[k];
doc.window_days = opt.maxDays;
doc.generated_at = new Date().toISOString();

writeAtomic(opt.uptime, doc);
if (!opt.quiet) console.log(`uptime history updated: ${opt.uptime} (${doc.days.length} day rows)`);
process.exit(opt.failOnDown && anyDown ? 1 : 0);
