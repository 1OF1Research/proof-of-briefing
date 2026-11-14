// Proof of Briefing — snapshot builder (Agent Embassy)
//
// Reads two official United States sources — the FAA NAS Status feed and
// the NOAA Aviation Weather Center observations API — captures their raw
// bytes as evidence, and folds them into one canonical snapshot:
//
//   observed        what the sources said (parsed, field for field)
//   interpretation  the plain-language brief a person or agent reads
//   evidence        per-source: URL, retrieval time, byte count, SHA-256
//
// The snapshot's canonical bytes (keys sorted, no whitespace) hash to its
// snapshot id. The id is anchored on NEAR testnet. A hash proves the
// committed bytes are unchanged; it does not prove the bytes were true.
// Source publication time, our retrieval time, and the anchoring time are
// three different facts and are always labelled separately.
//
// Refusal discipline: a source that cannot be read is recorded as
// unavailable, and missing information is never reported as "restrictions
// ended." If the FAA feed cannot be read, no snapshot is produced at all.

import { createHash } from "node:crypto";

export const FAA_URL = "https://nasstatus.faa.gov/api/airport-status-information";
export const AW_URL = "https://aviationweather.gov/api/data/metar";

// Major hubs the national brief watches (FAA ids, no K prefix).
export const WATCHLIST = [
  "ATL", "ORD", "DFW", "DEN", "LAX", "EWR", "JFK", "LGA",
  "SEA", "SFO", "MIA", "BOS", "DTW", "PHX", "IAH", "MSP",
];

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

export function sha256hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function snapshotId(snapshot) {
  return sha256hex(canonicalize(snapshot));
}

export const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// --- FAA NAS Status XML (generic parse: every Delay_type block, every
// entry inside it, every field the feed carried — nothing invented) ---

function xmlBlocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function xmlField(block, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? m[1].trim() : null;
}

export function parseFaaNasStatus(xml) {
  const updateTime = xmlField(xml, "Update_Time");
  const programs = [];
  for (const block of xmlBlocks(xml, "Delay_type")) {
    const name = xmlField(block, "Name");
    const entries = [];
    for (const tag of ["Airport", "Program"]) {
      for (const entry of xmlBlocks(block, tag)) {
        const fields = {};
        const tagRe = /<([A-Za-z_]+)>([^<]*)<\/\1>/g;
        let f;
        while ((f = tagRe.exec(entry)) !== null) fields[f[1]] = f[2].trim();
        if (Object.keys(fields).length > 0) entries.push(fields);
      }
    }
    programs.push({ type: name, entries });
  }
  return { update_time: updateTime, programs };
}

// --- Read the sources once, capturing raw bytes as evidence ---

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "agent-embassy-proof-of-briefing/1.0" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

export async function readSources() {
  const retrievedAt = isoNow();

  const faaRaw = await fetchText(FAA_URL);
  const faa = parseFaaNasStatus(faaRaw);

  // Stability check: read the FAA feed a second time, seconds later.
  // Identical bytes -> stable. A newer feed update time -> the feed moved
  // under us (we keep the first read and say so). Different bytes with the
  // same update time -> the sources conflict; that is stated, never hidden.
  let stability = "unconfirmed";
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const faaRaw2 = await fetchText(FAA_URL);
    if (faaRaw2 === faaRaw) stability = "stable";
    else {
      const faa2 = parseFaaNasStatus(faaRaw2);
      stability = faa2.update_time !== faa.update_time ? "updated-during-read" : "conflicting";
    }
  } catch { stability = "unconfirmed"; }

  const ids = WATCHLIST.map((c) => "K" + c).join(",");
  const metarUrl = `${AW_URL}?ids=${ids}&format=json`;
  const metarRaw = await fetchText(metarUrl);
  const metars = JSON.parse(metarRaw);
  const byIcao = {};
  for (const m of metars) byIcao[m.icaoId] = m;

  const airports = {};
  for (const code of WATCHLIST) {
    const m = byIcao["K" + code];
    airports[code] = {
      metar: m ? {
        station: m.icaoId,
        name: m.name || null,
        observed_at: m.obsTime ? new Date(m.obsTime * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
        flight_category: m.fltCat || null,
        temp_c: m.temp ?? null,
        wind_dir_deg: m.wdir ?? null,
        wind_kt: m.wspd ?? null,
        visibility: m.visib ?? null,
        raw: m.rawOb || null,
      } : null,
    };
  }

  const evidence = [
    { source: "FAA NAS Status", url: FAA_URL, retrieved_at: retrievedAt, sha256: sha256hex(faaRaw), bytes: Buffer.byteLength(faaRaw, "utf8"), file: "faa-nas-status.xml" },
    { source: "NOAA Aviation Weather Center METAR", url: metarUrl, retrieved_at: retrievedAt, sha256: sha256hex(metarRaw), bytes: Buffer.byteLength(metarRaw, "utf8"), file: "metar.json" },
  ];

  return {
    retrieved_at: retrievedAt,
    raw: { faa: faaRaw, metar: metarRaw },
    evidence,
    feed_stability: stability,
    observed: { faa_update_time: faa.update_time, programs: faa.programs, airports },
  };
}

// --- The brief: deterministic plain language, built only from the data ---

export function renderBrief(snap, changes) {
  const L = [];
  const obs = snap.observed;
  L.push("PROOF OF BRIEFING — United States airspace, from official public sources.");
  L.push(`Source publication: FAA feed updated ${obs.faa_update_time || "time not stated"}.`);
  L.push(`Our retrieval: ${snap.observed_at}. Anchoring on NEAR testnet: see the proof record served with this brief.`);
  if (snap.feed_stability === "conflicting") {
    L.push("WARNING: two reads of the FAA feed seconds apart disagreed without the feed's update time advancing. Treat this picture as contested.");
  } else if (snap.feed_stability === "updated-during-read") {
    L.push("Note: the FAA feed updated while it was being read. This brief carries the first read; the next snapshot will carry the new picture.");
  } else if (snap.feed_stability === "unconfirmed") {
    L.push("Note: feed stability could not be confirmed with a second read.");
  }
  L.push("");

  const active = obs.programs.filter((p) => p.entries.length > 0);
  if (active.length === 0) {
    L.push("Headline: the current FAA feed lists no ground stops, no ground delay programs, and no airport closures. That is a statement about the feed, not a promise about the sky.");
  } else {
    const counts = active.map((p) => `${p.entries.length} under ${p.type}`).join("; ");
    L.push(`Headline: ${counts}.`);
    L.push("");
    L.push("Active items, as the FAA feed states them:");
    for (const p of active) {
      for (const e of p.entries) {
        const where = e.ARPT || e.Program_Name || "national";
        const bits = [`- ${p.type} — ${where}`];
        if (e.Reason) bits.push(`reason: ${e.Reason}`);
        if (e.Avg) bits.push(`average delay ${e.Avg}`);
        if (e.Max) bits.push(`maximum delay ${e.Max}`);
        if (e.Start) bits.push(`from ${e.Start}`);
        if (e.Reopen) bits.push(`reopens ${e.Reopen}`);
        if (e.End_Time) bits.push(`until ${e.End_Time}`);
        L.push(bits.join("; ") + ".");
      }
    }
  }
  L.push("");

  if (changes && changes.length > 0) {
    L.push("What changed since the previous snapshot:");
    for (const c of changes) L.push(`- ${c}`);
    L.push("");
  }

  L.push("Watchlist airport conditions (latest official weather observation):");
  for (const code of Object.keys(obs.airports).sort()) {
    const a = obs.airports[code];
    if (!a || !a.metar) {
      L.push(`- ${code}: no current observation was read. Absence of an observation is not evidence of good conditions.`);
      continue;
    }
    const m = a.metar;
    const wind = m.wind_dir_deg == null || m.wind_kt === 0 ? "wind calm" : `wind ${m.wind_dir_deg} deg at ${m.wind_kt} kt`;
    L.push(`- ${code}: ${m.flight_category || "conditions unreported"}, ${m.temp_c} C, ${wind}, visibility ${m.visibility} — observed ${m.observed_at}.`);
  }
  L.push("");
  L.push("Evidence: " + snap.evidence.map((e) => `${e.source}, ${e.bytes} bytes, sha256 ${e.sha256.slice(0, 16)}…, retrieved ${e.retrieved_at}`).join(" ; "));
  L.push("Research prototype and information aid only. Not an operational aviation system. It issues no clearances, instructions, safety determinations, or recommendations. Official FAA systems remain authoritative.");
  return L.join("\n");
}

export function assembleSnapshot(reading, changes) {
  const snap = {
    schema: "proof-of-briefing/1",
    observed_at: reading.retrieved_at,
    sources: reading.evidence.map((e) => ({ name: e.source, url: e.url })),
    evidence: reading.evidence,
    feed_stability: reading.feed_stability,
    observed: reading.observed,
    interpretation: { brief: "" },
  };
  snap.interpretation.brief = renderBrief(snap, changes);
  return snap;
}
