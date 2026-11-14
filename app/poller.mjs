// Poller — read the official sources once and write a complete evidence
// bundle to the data directory:
//
//   node poller.mjs [dataDir]
//
//   dataDir/evidence/faa-nas-status.xml   raw bytes, exactly as served
//   dataDir/evidence/metar.json           raw bytes, exactly as served
//   dataDir/snapshot.json                 canonical snapshot bytes
//   dataDir/brief.txt                     the brief, for humans
//   dataDir/prev-snapshot.json            the previous snapshot (for diffs)
//
// Prints { snapshot_id, observed_at }. If a source cannot be read, writes
// unavailable.json instead and exits 1: no snapshot is ever fabricated
// from missing information. Writes are retried with read-back checks —
// bytes on disk are trusted only once they verify.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSources, assembleSnapshot, canonicalize, snapshotId } from "./snapshot.mjs";
import { diffObserved } from "./diff.mjs";

async function writeVerified(path, bytes) {
  let lastErr;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await writeFile(path, bytes, "utf8");
      const back = await readFile(path, "utf8");
      if (back === bytes) return;
      lastErr = new Error(`read-back mismatch at ${path} (${back.length} vs ${bytes.length} bytes)`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 3000 + attempt * 500));
  }
  throw lastErr || new Error(`could not write ${path}`);
}

async function readJsonOrNull(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

const dataDir = process.argv[2] || new URL("./data", import.meta.url).pathname;
await mkdir(join(dataDir, "evidence"), { recursive: true });

let reading;
try {
  reading = await readSources();
} catch (e) {
  const record = { state: "unavailable", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), error: String(e && e.message || e) };
  await writeVerified(join(dataDir, "unavailable.json"), JSON.stringify(record, null, 2));
  console.error(JSON.stringify(record));
  process.exit(1);
}

const prev = await readJsonOrNull(join(dataDir, "snapshot.json"));
const changes = prev ? diffObserved(prev.observed, reading.observed) : [];
const snap = assembleSnapshot(reading, changes);
const id = snapshotId(snap);

if (prev) await writeVerified(join(dataDir, "prev-snapshot.json"), canonicalize(prev));
await writeVerified(join(dataDir, "evidence", "faa-nas-status.xml"), reading.raw.faa);
await writeVerified(join(dataDir, "evidence", "metar.json"), reading.raw.metar);
await writeVerified(join(dataDir, "snapshot.json"), canonicalize(snap));
await writeVerified(join(dataDir, "brief.txt"), snap.interpretation.brief + "\n");
try { await writeFile(join(dataDir, "unavailable.json"), "", "utf8"); } catch { /* marker cleared best-effort */ }

console.log(JSON.stringify({ snapshot_id: id, observed_at: snap.observed_at, changes, file: join(dataDir, "snapshot.json") }));
