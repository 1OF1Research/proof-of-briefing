// November 13, 2026 — deterministic replay of the nationwide ground stop.
//
//   node replay.mjs [outDir]
//
// Rebuilds three moments from the documented record (sources in
// ./sources/, each cited) using the SAME snapshot code path as the live
// system, so the replay exercises the real machinery:
//
//   moment-1  2026-11-13T21:05Z  the stop is in effect
//   moment-2  2026-11-13T23:30Z  the official picture is unavailable —
//                                the system produces a refusal, not a brief
//   moment-3  2026-11-14T01:20Z  the stop is lifted; change detection
//                                against moment-1 says exactly what ended
//
// A replay is a RECONSTRUCTION from the documented record, never a live
// capture, and every replay brief says so in its first line. Weather
// observations were not captured for that day, so the replay carries
// none — absence is stated, never filled in.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleSnapshot, canonicalize, snapshotId, sha256hex, WATCHLIST } from "../app/snapshot.mjs";
import { diffObserved } from "../app/diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, "bundles");
const ADVISORY = "Due to extraordinary circumstances and for reasons of safety. Attention all aircraft operators, by order of the Federal Aviation Command Center all airports are ground stopped. All departing traffic should remain ground stopped until further notice. Inbound international flights will be managed on a case by case basis.";

async function writeVerified(path, bytes) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await writeFile(path, bytes, "utf8");
      if ((await readFile(path, "utf8")) === bytes) return;
    } catch { /* retry below */ }
    await new Promise((r) => setTimeout(r, 2000 + attempt * 400));
  }
  throw new Error(`could not write ${path}`);
}

const advisoryText = await readFile(join(here, "sources", "faa-advisory-2026-11-13.txt"), "utf8");
const factsText = await readFile(join(here, "sources", "nov-13-facts.md"), "utf8");

function evidenceFor(retrievedAt) {
  return [
    { source: "FAA nationwide ground stop advisory, 2026-11-13 (text as published in contemporaneous reporting)", url: "https://www.northjersey.com/story/news/transportation/2026/11/13/ground-stop-us-airports-communication-issue-faa-safety/92765735007/", retrieved_at: retrievedAt, sha256: sha256hex(advisoryText), bytes: Buffer.byteLength(advisoryText, "utf8"), file: "faa-advisory-2026-11-13.txt" },
    { source: "Documented record of November 13, 2026 (house notes from Reuters and contemporaneous reporting, sources cited in the file)", url: "https://www.reuters.com/business/aerospace-defense/old-air-traffic-control-equipment-regularly-disrupts-us-flights-2026-11-14/", retrieved_at: retrievedAt, sha256: sha256hex(factsText), bytes: Buffer.byteLength(factsText, "utf8"), file: "nov-13-facts.md" },
  ];
}

const noWeather = () => Object.fromEntries(WATCHLIST.map((c) => [c, { metar: null }]));

async function writeBundle(name, snap) {
  const dir = join(outDir, name);
  await mkdir(join(dir, "evidence"), { recursive: true });
  await writeVerified(join(dir, "evidence", "faa-advisory-2026-11-13.txt"), advisoryText);
  await writeVerified(join(dir, "evidence", "nov-13-facts.md"), factsText);
  await writeVerified(join(dir, "snapshot.json"), canonicalize(snap));
  await writeVerified(join(dir, "brief.txt"), snap.interpretation.brief + "\n");
  return { dir, id: snapshotId(snap) };
}

function replayify(snap) {
  snap.schema = "proof-of-briefing/1-replay";
  snap.interpretation.brief =
    "REPLAY — a reconstruction from the documented record of November 13, 2026, not a live capture.\n\n" +
    snap.interpretation.brief;
  return snap;
}

// Moment 1 — the stop is in effect (announced 20:54 UTC).
const m1 = replayify(assembleSnapshot({
  retrieved_at: "2026-11-13T21:05:00Z",
  raw: { faa: advisoryText, metar: factsText },
  evidence: evidenceFor("2026-11-13T21:05:00Z"),
  feed_stability: "unconfirmed",
  observed: {
    faa_update_time: null,
    programs: [{ type: "Ground Stop", entries: [{ ARPT: "ALL", Reason: ADVISORY, Start: "Nov 13 at 20:54 UTC (announced)" }] }],
    airports: noWeather(),
  },
}, []));

// Moment 2 — the picture is unavailable. No snapshot exists; the record
// is a refusal. (In the live system this is the poller's failure path.)
const m2dir = join(outDir, "moment-2-source-unavailable");
await mkdir(m2dir, { recursive: true });
await writeVerified(join(m2dir, "unavailable.json"), JSON.stringify({
  state: "unavailable",
  at: "2026-11-13T23:30:00Z",
  error: "REPLAY: during the outage window the official picture could not be read and confirmed. The system records the gap and refuses to describe the airspace; it never treats missing information as restrictions ended.",
}, null, 2));

// Moment 3 — the stop is lifted (01:15 UTC); read at 01:20 UTC.
const changes = diffObserved(m1.observed, {
  faa_update_time: null,
  programs: [{ type: "Ground Stop", entries: [] }],
  airports: noWeather(),
});
const m3 = replayify(assembleSnapshot({
  retrieved_at: "2026-11-14T01:20:00Z",
  raw: { faa: advisoryText, metar: factsText },
  evidence: evidenceFor("2026-11-14T01:20:00Z"),
  feed_stability: "unconfirmed",
  observed: {
    faa_update_time: null,
    programs: [{ type: "Ground Stop", entries: [] }],
    airports: noWeather(),
  },
}, changes));

const b1 = await writeBundle("moment-1-stop-in-effect", m1);
const b3 = await writeBundle("moment-3-stop-lifted", m3);
console.log(JSON.stringify({
  moment1: { snapshot_id: b1.id, dir: b1.dir },
  moment2: { state: "unavailable", dir: m2dir },
  moment3: { snapshot_id: b3.id, dir: b3.dir, changes },
}, null, 2));
