// Proof of Briefing — claim snapshots (Agent Embassy)
//
// A condition snapshot proves what official sources SHOWED. A claim
// snapshot proves what an official SAID — the words, the speaker, the
// moment, and how certain the statement itself claimed to be:
//
//   certainty: "none-stated"       the captured record states nothing
//              "unknown"            the speaker says it is not known
//              "candidates-named"   the speaker names competing causes
//              "verdict"            a determination, superseding an
//                                   earlier claim it must reference
//
// The candidate set and the certainty state live INSIDE the canonical
// digest, so they are exactly as tamper-evident as the statement bytes.
// Competing candidates are held apart: they never merge, and this code
// never picks one. A later claim may only supersede an earlier one by
// referencing its id in a NEW snapshot; nothing anchored is ever edited.
//
// A claim snapshot's id is the SHA-256 of its canonical bytes (the same
// canonicalize() as condition snapshots), anchored on NEAR testnet
// through the same publish path. A hash proves the committed bytes are
// unchanged; it does not prove the claim was true.

import { canonicalize, sha256hex } from "./snapshot.mjs";

export const CERTAINTY_STATES = ["none-stated", "unknown", "candidates-named", "verdict"];

export function claimId(claim) {
  return sha256hex(canonicalize(claim));
}

// The one line the plain-language brief gains from claim state: what
// officials have NOT yet determined, stated as plainly as what they
// have. Rendered only from the claim's own fields — never invented.
export function notYetKnownLine(claim) {
  const day = (claim.stated_at || "").slice(0, 10);
  switch (claim.certainty) {
    case "none-stated":
      return `Not yet known: no official cause has been stated. In the captured record of ${day}, the statement announcing the event gives no cause, and no determination appears. Absence of a stated cause is not evidence for any cause.`;
    case "unknown":
      return `Not yet known: officials state the cause is not yet determined (${day}).`;
    case "candidates-named": {
      const list = claim.candidates.map((c, i) => `(${i + 1}) ${c}`).join("; ");
      return `Not yet known: the cause has not been determined. On ${day}, ${claim.speaker} named ${claim.candidates.length} candidates: ${list}. None of these is a verdict, and this brief does not choose between them.`;
    }
    case "verdict":
      return `Determined on ${day}: ${claim.candidates[0] || "see the anchored claim"}. This determination supersedes an earlier anchored claim; the earlier uncertainty remains on the record.`;
    default:
      throw new Error(`unknown certainty state: ${claim.certainty}`);
  }
}

// The claim brief: the plain-language rendering served with the bundle
// as claim.txt. Its wording is part of the anchored digest.
export function renderClaimBrief(claim) {
  const L = [];
  L.push("PROOF OF BRIEFING — CLAIM SNAPSHOT. What an official said, captured and anchored.");
  L.push(`Incident: ${claim.incident}. Question: ${claim.question}.`);
  if (claim.speaker) {
    L.push(`Speaker: ${claim.speaker}. Venue: ${claim.venue}.`);
  } else {
    L.push(`Source record: ${claim.venue}. No speaker is claimed — this snapshot records an absence.`);
  }
  L.push(`Stated: ${claim.stated_at}. Retrieved by us: ${claim.retrieved_at}. Anchoring on NEAR testnet: see the proof record served with this snapshot.`);
  L.push("");
  if (claim.statement_lines && claim.statement_lines.length > 0) {
    L.push("The statement, in the speaker's words (captions of the broadcast):");
    L.push(`"${claim.statement_lines.join(" ")}"`);
    L.push("");
  }
  if (claim.basis) {
    L.push(`Basis: ${claim.basis}`);
    L.push("");
  }
  L.push(notYetKnownLine(claim));
  if (claim.supersedes) {
    L.push(`This claim supersedes anchored claim ${claim.supersedes.slice(0, 16)}… — the earlier record is not edited; it remains verifiable.`);
  }
  L.push("");
  L.push("Evidence: " + claim.evidence.map((e) => `${e.source}, ${e.bytes} bytes, sha256 ${e.sha256.slice(0, 16)}…, retrieved ${e.retrieved_at}`).join(" ; "));
  L.push("Research prototype and information aid only. Not an operational aviation system. A hash proves committed bytes are unchanged — never that the statement was true, complete, or final.");
  return L.join("\n");
}

// Assemble a claim snapshot. spec: {
//   incident, question, speaker (null for an absence record), venue,
//   stated_at, retrieved_at, certainty, candidates: [...],
//   statement_lines: [...], basis, supersedes (claim id or null),
//   evidence: [{source, url, retrieved_at, file, raw}]  // raw is stripped
// }
export function assembleClaim(spec) {
  if (!CERTAINTY_STATES.includes(spec.certainty)) {
    throw new Error(`certainty must be one of ${CERTAINTY_STATES.join(", ")}`);
  }
  if (spec.certainty === "candidates-named" && (spec.candidates || []).length < 2) {
    throw new Error("candidates-named requires at least two candidates, held apart");
  }
  if (spec.certainty === "none-stated" && ((spec.candidates || []).length > 0 || (spec.statement_lines || []).length > 0)) {
    throw new Error("none-stated cannot carry candidates or statement lines — that is the point of the state");
  }
  if (spec.certainty === "verdict" && !spec.supersedes) {
    throw new Error("a verdict must reference the claim it supersedes");
  }
  const claim = {
    schema: "proof-of-briefing-claim/1",
    incident: spec.incident,
    question: spec.question,
    speaker: spec.speaker ?? null,
    venue: spec.venue,
    stated_at: spec.stated_at,
    retrieved_at: spec.retrieved_at,
    // The anchor contract's record carries (source, observed_at, sha256);
    // for a claim, the observed thing is the statement, so observed_at is
    // the statement time. stated_at above remains the explicit field.
    observed_at: spec.stated_at,
    certainty: spec.certainty,
    candidates: spec.candidates || [],
    statement_lines: spec.statement_lines || [],
    basis: spec.basis || null,
    supersedes: spec.supersedes || null,
    evidence: spec.evidence.map((e) => ({
      source: e.source, url: e.url, retrieved_at: e.retrieved_at,
      sha256: sha256hex(e.raw), bytes: Buffer.byteLength(e.raw, "utf8"), file: e.file,
    })),
    interpretation: { brief: "" },
  };
  claim.interpretation.brief = renderClaimBrief(claim);
  return claim;
}
