// The claim timeline for November 13, 2026 — deterministic replay.
//
//   node replay-claims.mjs [outDir]
//
// Condition snapshots prove what sources SHOWED (see ../replay/). This
// replay proves what officials SAID about the cause, in three moments,
// using the same canonical digest and the same anchor path:
//
//   moment-1  2026-11-13T20:54Z  the FAA advisory announces the stop
//                                and states no cause (certainty:
//                                none-stated — an honest absence,
//                                grounded in the day's captured record)
//   moment-2  2026-11-14T16:19Z  Secretary Duffy, on Fox News: the
//                                fault "hasn't been determined"; two
//                                candidates named, held apart
//                                (certainty: candidates-named;
//                                supersedes moment-1)
//   moment-3  verdict            PENDING. No snapshot exists and none
//                                is fabricated: a marker file records
//                                the open state. A verdict may only
//                                enter as a new anchored claim whose
//                                supersedes points at moment-2.
//
// A replay is a RECONSTRUCTION from captured records, assembled at the
// fixed times below so any rerun reproduces the anchored ids exactly.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleClaim, claimId, notYetKnownLine } from "../app/claims.mjs";
import { canonicalize } from "../app/snapshot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, "bundles");

const INCIDENT = "2026-11-13 FAA nationwide ground stop";
const QUESTION = "what caused the failure behind the ground stop";

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

const src = async (name) => readFile(join(here, "sources", name), "utf8");
const advisoryText = await src("faa-advisory-2026-11-13.txt");
const factsText = await src("nov-13-facts.md");
const postText = await src("x-post.json");
const transcriptText = await src("transcript.txt");
const captionsText = await src("subs.en.vtt");

// The speaker's words, line by line, exactly as captioned (the
// transcript evidence file carries the same lines with timestamps).
const STATEMENT_LINES = transcriptText
  .split("\n")
  .map((l) => l.replace(/^\[\d{2}:\d{2}\]\s*/, ""))
  .filter((l) => l.trim().length > 0);

// --- Moment 1: the day's official statement states no cause ----------
const claim1 = assembleClaim({
  incident: INCIDENT,
  question: QUESTION,
  speaker: null,
  venue: "FAA Command Center advisory, 2026-11-13 (the day's official statement, as published in contemporaneous reporting)",
  stated_at: "2026-11-13T20:54:00Z",
  retrieved_at: "2026-11-14T19:17:00Z",
  certainty: "none-stated",
  candidates: [],
  statement_lines: [],
  basis: "Scoped to the official statement captured for that day: the FAA advisory announces the stop and states no cause, and no official determination appears in the day's captured record. A preliminary view circulated in contemporaneous reporting (aging telecommunications routers, overloaded with data) was never issued as an official determination in that record, so the state is none-stated — not unknown, and not a candidate.",
  supersedes: null,
  evidence: [
    { source: "FAA nationwide ground stop advisory, 2026-11-13 (text as published in contemporaneous reporting)", url: "https://www.northjersey.com/story/news/transportation/2026/11/13/ground-stop-us-airports-communication-issue-faa-safety/92765735007/", retrieved_at: "2026-11-14T19:17:00Z", file: "faa-advisory-2026-11-13.txt", raw: advisoryText },
    { source: "Documented record of November 13, 2026 (house notes from Reuters and contemporaneous reporting, sources cited in the file)", url: "https://www.reuters.com/business/aerospace-defense/old-air-traffic-control-equipment-regularly-disrupts-us-flights-2026-11-14/", retrieved_at: "2026-11-14T19:17:00Z", file: "nov-13-facts.md", raw: factsText },
  ],
});
const id1 = claimId(claim1);

// --- Moment 2: two candidates named, held apart ----------------------
const claim2 = assembleClaim({
  incident: INCIDENT,
  question: QUESTION,
  speaker: "Sean Duffy, U.S. Secretary of Transportation",
  venue: "Fox News broadcast clip, posted by @foxnews on X",
  stated_at: "2026-11-14T16:19:44Z",
  retrieved_at: "2026-11-14T19:16:00Z",
  certainty: "candidates-named",
  candidates: [
    "installer error by L3 Harris, the contractor replacing the router (user or installer error)",
    "a faulty router installed by L3 Harris which, being replaced during the switch from copper to fiber, started flooding other routers in the air traffic control system",
  ],
  statement_lines: STATEMENT_LINES,
  basis: "The Secretary states the fault has not been determined (\"We haven't determined what the fault was\") and names two candidates. They are recorded apart, exactly as stated; neither is endorsed here, and no wording in this snapshot chooses between them.",
  supersedes: id1,
  evidence: [
    { source: "Fox News post on X carrying the broadcast clip (@foxnews, post 2121639225107820715), as served by the fxtwitter API", url: "https://x.com/foxnews/status/2121639225107820715", retrieved_at: "2026-11-14T19:16:00Z", file: "x-post.json", raw: postText },
    { source: "Broadcast captions for the clip, read by the house peek lane (yt-dlp subtitle track, timed lines)", url: "https://x.com/foxnews/status/2121639225107820715", retrieved_at: "2026-11-14T19:08:00Z", file: "transcript.txt", raw: transcriptText },
    { source: "Raw caption track (WebVTT) for the same clip, exactly as served", url: "https://x.com/foxnews/status/2121639225107820715", retrieved_at: "2026-11-14T19:08:00Z", file: "subs.en.vtt", raw: captionsText },
  ],
});
const id2 = claimId(claim2);

// --- Write the bundles ------------------------------------------------
async function writeBundle(name, claim, files) {
  const dir = join(outDir, name);
  await mkdir(join(dir, "evidence"), { recursive: true });
  for (const [file, raw] of Object.entries(files)) {
    await writeVerified(join(dir, "evidence", file), raw);
  }
  await writeVerified(join(dir, "claim.json"), canonicalize(claim));
  await writeVerified(join(dir, "claim.txt"), claim.interpretation.brief + "\n");
  return dir;
}

const d1 = await writeBundle("moment-1-no-cause-stated", claim1, {
  "faa-advisory-2026-11-13.txt": advisoryText,
  "nov-13-facts.md": factsText,
});
const d2 = await writeBundle("moment-2-candidates-named", claim2, {
  "x-post.json": postText,
  "transcript.txt": transcriptText,
  "subs.en.vtt": captionsText,
});

// --- Moment 3: the verdict slot stays honestly empty ------------------
const d3 = join(outDir, "moment-3-verdict");
await mkdir(d3, { recursive: true });
await writeVerified(join(d3, "verdict.pending.json"), JSON.stringify({
  state: "pending",
  schema: "proof-of-briefing-claim-pending/1",
  incident: INCIDENT,
  question: QUESTION,
  as_of: "2026-11-14T19:17:00Z",
  awaiting: "an official determination of the cause",
  rule: "A verdict may enter only as a new anchored claim snapshot with certainty \"verdict\" whose supersedes references the candidates-named claim. This marker is not a snapshot, carries no digest, and is never anchored.",
}, null, 2) + "\n");

console.log(JSON.stringify({
  moment1: { claim_id: id1, dir: d1, certainty: claim1.certainty, not_yet_known: notYetKnownLine(claim1) },
  moment2: { claim_id: id2, dir: d2, certainty: claim2.certainty, supersedes: id1, not_yet_known: notYetKnownLine(claim2) },
  moment3: { state: "pending", dir: d3 },
}, null, 2));
