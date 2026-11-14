// Proof of Briefing as ONE MCP tool — so any agent, in any MCP client,
// reads the same evidence-backed picture a person reads, with the same
// freshness state and the same anchor proof.
//
//   node mcp.mjs [dataDir]
//
// Tool: proof_of_briefing
//   -> { brief, freshness, snapshot_id, evidence, changes, proof_state, proof }
//   When no verified snapshot exists, the tool returns the refusal as an
//   error result. An agent must never be handed an invented all-clear.
//
// Minimal, dependency-free implementation of the MCP stdio protocol
// (initialize / tools/list / tools/call / ping).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { snapshotId } from "./snapshot.mjs";
import { freshnessOf, REFUSAL } from "./freshness.mjs";
import { diffObserved } from "./diff.mjs";

const dataDir = process.argv[2] || new URL("./data", import.meta.url).pathname;

async function load() {
  let snap = null;
  try { snap = JSON.parse(await readFile(join(dataDir, "snapshot.json"), "utf8")); } catch { /* none */ }
  let prev = null;
  try { prev = JSON.parse(await readFile(join(dataDir, "prev-snapshot.json"), "utf8")); } catch { /* none */ }
  let proof = null;
  if (snap) {
    try {
      const p = JSON.parse(await readFile(join(dataDir, "anchor.json"), "utf8"));
      if (p.snapshot_id === snapshotId(snap)) proof = p;
    } catch { /* pending */ }
  }
  return { snap, prev, proof };
}

const TOOLS = [
  {
    name: "proof_of_briefing",
    description:
      "The current United States national airspace brief, built only from official public sources (FAA NAS Status and NOAA Aviation Weather Center), with the evidence behind it: raw source bytes captured with retrieval times and SHA-256 digests, a canonical snapshot whose digest is anchored on NEAR testnet, a freshness state (fresh / stale / conflicting), and what changed since the previous snapshot. Use it when an answer about airspace restrictions must be provable later: the snapshot an answer rests on can be re-verified byte for byte against the public NEAR anchor, and a changed briefing fails verification. Refuses, rather than guessing, when no verified snapshot exists. Information aid only; official FAA systems remain authoritative.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name) {
  if (name !== "proof_of_briefing") throw new Error(`unknown tool ${name}`);
  const { snap, prev, proof } = await load();
  if (!snap) {
    const err = new Error(REFUSAL);
    err.isRefusal = true;
    throw err;
  }
  return {
    brief: snap.interpretation.brief,
    freshness: freshnessOf(snap),
    snapshot_id: snapshotId(snap),
    evidence: snap.evidence,
    changes_since_previous: prev ? diffObserved(prev.observed, snap.observed) : [],
    previous_snapshot_id: prev ? snapshotId(prev) : null,
    proof_state: proof ? "anchored" : "anchor-pending",
    proof,
  };
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const reply = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
  if (msg.method === "initialize") {
    return reply({
      jsonrpc: "2.0", id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-embassy-proof-of-briefing", version: "1.0.0" },
      },
    });
  }
  if (msg.method === "ping") return reply({ jsonrpc: "2.0", id: msg.id, result: {} });
  if (msg.method === "tools/list") return reply({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    try {
      const out = await callTool(msg.params.name);
      return reply({
        jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] },
      });
    } catch (e) {
      return reply({
        jsonrpc: "2.0", id: msg.id,
        result: { isError: true, content: [{ type: "text", text: String(e && e.message || e) }] },
      });
    }
  }
  if (msg.id !== undefined) {
    return reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
});
