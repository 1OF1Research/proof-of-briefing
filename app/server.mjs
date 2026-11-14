// Proof of Briefing server — serves the latest snapshot with its
// freshness state and its NEAR anchor proof, over plain HTTP JSON.
//
//   node server.mjs [dataDir] [port]
//
//   GET /health    -> { ok: true }
//   GET /brief     -> the plain-language brief (text), or the refusal
//   GET /airspace  -> { snapshot, snapshot_id, freshness, proof_state, proof }
//
// proof_state is "anchored" only when a proof exists whose snapshot id
// matches the served snapshot; otherwise "anchor-pending". Nothing is
// labelled verified here: verification is the verifier's job, run by
// whoever holds the bundle. If no snapshot exists (a source outage), the
// brief route serves the refusal, never an invented all-clear.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { snapshotId } from "./snapshot.mjs";
import { freshnessOf, REFUSAL } from "./freshness.mjs";

const dataDir = process.argv[2] || new URL("./data", import.meta.url).pathname;
const port = Number(process.argv[3] || 8787);

async function load() {
  let snap = null;
  try { snap = JSON.parse(await readFile(join(dataDir, "snapshot.json"), "utf8")); } catch { /* none yet */ }
  let proof = null;
  if (snap) {
    try {
      const p = JSON.parse(await readFile(join(dataDir, "anchor.json"), "utf8"));
      if (p.snapshot_id === snapshotId(snap)) proof = p;
    } catch { /* not anchored yet */ }
  }
  return { snap, proof };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  };
  try {
    if (url.pathname === "/health") return send(200, { ok: true });
    const { snap, proof } = await load();
    const freshness = freshnessOf(snap);
    if (url.pathname === "/brief") {
      if (!snap) return send(200, REFUSAL + "\n", "text/plain; charset=utf-8");
      return send(200, snap.interpretation.brief + "\n", "text/plain; charset=utf-8");
    }
    if (url.pathname === "/airspace") {
      if (!snap) return send(503, { state: "unavailable", refusal: REFUSAL });
      return send(200, {
        snapshot: snap,
        snapshot_id: snapshotId(snap),
        freshness,
        proof_state: proof ? "anchored" : "anchor-pending",
        proof,
      });
    }
    return send(404, { error: "routes: /health /brief /airspace" });
  } catch (e) {
    return send(500, { error: String(e && e.message || e) });
  }
});

server.listen(port, () => console.log(`proof-of-briefing server on http://127.0.0.1:${port} (data: ${dataDir})`));
