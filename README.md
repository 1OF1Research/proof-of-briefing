Start here for the proof package: **the secret gist linked in the submission** — the demo, the verifier, and the anchored records, in one place. This repository is the working code behind it.

# Agent Embassy — Proof of Briefing

**An open contribution, and a starting point.** This is a first working
piece, offered to the ecosystem for others to build on — not a finished
product. It is a research prototype, built for NEAR HACKATHON
(November 1–14, 2026), that demonstrates one mechanism end to end:

> An agent should never be able to quietly rewrite the evidence behind
> its own answer.

Agents read public information and pass conclusions onward. Nothing in
the usual stack records what an agent was actually shown, when it was
shown it, or whether that evidence later changed. When the answer
matters, "the model said so" is not evidence.

## The demonstration: November 13, 2026

On Friday, November 13, 2026, the FAA grounded every departing flight in
the United States for more than four hours after a communications
failure at its air traffic control centers — only the second nationwide
ground stop since September 11, 2001. Thousands of flights were
cancelled; millions of people, and every agent answering questions that
day, depended on a fast-moving public picture that nobody can prove
anymore. What did the official record actually say at 4:05 p.m.? At
8:20 p.m., after the stop lifted? If an agent answered you that day,
could it prove what it knew?

Proof of Briefing is the machinery that makes the answer yes.

## What it does

1. **Captures evidence, not just data.** The poller reads two official
   sources — the FAA NAS Status feed and the NOAA Aviation Weather
   Center — and preserves the *raw response bytes*, each with its
   source URL, retrieval time, byte count, and SHA-256 digest.
2. **Briefs in plain language, with traceable claims.** The captured
   bytes fold into a canonical snapshot that separates `observed`
   (what the sources said, field for field) from `interpretation`
   (the brief). Every program reason and weather line in the brief
   traces verbatim to the captured bytes — the verifier checks this.
3. **Anchors the snapshot on NEAR.** The snapshot's canonical SHA-256
   is published to a small append-only contract on NEAR testnet
   (`agentembassy.testnet`). Source publication time, our retrieval
   time, and the NEAR anchoring time are three different facts and are
   always labelled separately. Publication is gated to the publisher
   account; reads are open to anyone.
4. **Verifies independently.** `verify.py` (pure Python standard
   library, no server of ours involved) re-checks any bundle against
   the live chain: recompute the digest, re-hash the raw evidence,
   trace the claims, read the anchored record. Change one byte of the
   briefing and verification fails.
5. **Refuses honestly.** Freshness is a first-class state — `fresh`,
   `stale`, `conflicting`, `unavailable` — and a snapshot that cannot
   be produced yields a refusal, never an invented all-clear. Missing
   information is never reported as "restrictions ended."
6. **Detects change.** Consecutive anchored snapshots diff into plain
   language: what started, what ended, what moved — each side of the
   comparison independently verifiable.
7. **Serves agents.** One MCP tool, `proof_of_briefing`, hands any
   agent the same evidence-backed picture a person reads, with the
   same freshness state and the same proof.

## Why NEAR is load-bearing

Remove NEAR and the system collapses into "trust our server's history."
The anchor is the one part the operator cannot rewrite after the fact:
a public, timestamped commitment on infrastructure we do not control,
checkable by a stranger with a public RPC endpoint and a stdlib script.
That asymmetry — cheap to commit, impossible to quietly revise — is
the whole mechanism. A hash proves the committed bytes are unchanged.
It does not prove the bytes were true, and nothing here claims
otherwise.

## Try it (do X → see Y)

Requirements: Node.js 18+, Python 3. Nothing to install — the app has
zero dependencies and the verifier is pure standard library.

```sh
# 1. Verify the shipped live bundle against the chain. Do this first.
python3 verify.py demo-bundle
# -> every check PASSes; RESULT: PASS — the bundle is the anchored
#    snapshot, byte for byte. Record 0 on agentembassy.testnet,
#    tx 4jcJhw3xzB7jUyRzjzWdouBvTC1oa9toQi6dUUw7iCYs.

# 2. Break it, the way the demo does.
cp -r demo-bundle /tmp/tampered
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path('/tmp/tampered/snapshot.json')
s = json.loads(p.read_text())
s['interpretation']['brief'] = s['interpretation']['brief'].replace('official', 'certified', 1)
p.write_text(json.dumps(s, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
EOF
python3 verify.py /tmp/tampered
# -> RESULT: FAIL. One word changed; the commitment cannot be made
#    to match silently.

# 3. Take a live snapshot of the airspace right now.
cd app && node poller.mjs ./data && cat data/brief.txt
# -> a fresh brief from the live FAA and NOAA feeds, with its
#    snapshot id. (Anchoring your own snapshot needs a NEAR testnet
#    account and near-cli; see app/anchor.sh. Reading and verifying
#    need neither.)

# 4. Serve it to people and agents.
node server.mjs ./data 8787        # http://127.0.0.1:8787/brief
node mcp.mjs ./data                # MCP stdio: one tool, proof_of_briefing

# 5. Replay November 13 in three moments.
cd ../replay && node replay.mjs ./bundles && cat bundles/moment-3-stop-lifted/brief.txt
python3 ../verify.py bundles/moment-1-stop-in-effect   # anchored, record 1
python3 ../verify.py bundles/moment-3-stop-lifted      # anchored, record 2
# -> moment 1: the stop in effect. Moment 2: the source-unavailable
#    refusal (no snapshot exists — that is the point). Moment 3:
#    change detection reports the ground stop ENDED, against two
#    anchored records. The replay is a reconstruction from the
#    documented record (sources in replay/sources/) and says so in
#    its first line.

# 6. Run the red-team battery.
cd .. && python3 redteam.py demo-bundle /tmp/redteam
# -> tampered briefing, tampered raw bytes, missing evidence, altered
#    digests, changed timestamps, non-canonical bytes, forged anchor
#    index, wrong chain, unanchored bundle: the verifier fails closed
#    on every one.
```

## Anchored records (NEAR testnet, contract `agentembassy.testnet`)

| Record | Snapshot | What it is | Transaction |
|---|---|---|---|
| 0 | `d4bbc383…` | Live snapshot, retrieved 2026-11-14T18:08:52Z | `4jcJhw3xzB7jUyRzjzWdouBvTC1oa9toQi6dUUw7iCYs` |
| 1 | `5f874f2d…` | Replay moment 1 — stop in effect | `8cfnx1X1q5RHfupE28kxzcszaF52Gino8nSw6i3oGSmw` |
| 2 | `c1bd5c9d…` | Replay moment 3 — stop lifted | `ELABwKpgBFVFpvp3XUw9fw8bjwa9JrS5nGik7MtNB84P` |
| 3 | `266197fa…` | Claim moment 1 — no cause stated (2026-11-13) | `43maWbRHQHiz8RuRTaUeWZBgoxs8AnD1UyQqAw1YVt1y` |
| 4 | `233a4d8e…` | Claim moment 2 — two candidates named (2026-11-14) | `2PbQVJf4XEpQKTXf4ocDQFWuEGL3NNoSRytLuRv9gWgy` |

Contract deployment: tx `2saappjxxNiUG6wq2RM3KdJSNbRdnrSX67gjaTJrBiHR`
(wasm SHA-256 `63b42ab2b975fa37c5afdcf33ddf4e5318aea7c230f19ca102374d632ca125cc`).
Explorer: https://testnet.nearblocks.io/address/agentembassy.testnet

## The claim timeline (post-filing addition, November 14, 2026)

The records above prove what official sources *showed*. But a public
picture has a second half: what officials *said* about it — and that
record is just as easy to rewrite after the fact. Two days after the
ground stop, the cause was still two competing claims and no verdict.
Nothing stopped a later "we always knew" from quietly replacing the
earlier, honest uncertainty. So the filed starting point grew the
other half:

A **claim snapshot** (`claims/`, schema `proof-of-briefing-claim/1`)
captures an official statement the same way a condition snapshot
captures a feed: the source bytes held as evidence, the retrieval
time, the canonical digest, the anchor on NEAR testnet through the
same publish path. It carries the speaker, the venue, the statement
time, and a **certainty state** — `none-stated`, `unknown`,
`candidates-named`, or `verdict` — and the candidate set and the
certainty state live *inside* the digest. Competing candidates are
held apart: they never merge, nothing here picks one, and a verdict
may only arrive as a *new* anchored claim that references the claim
it supersedes. The plain-language brief gains a line rendered from
claim state: what officials have **not yet determined**, stated as
plainly as what they have.

The November 13 timeline, in `claims/bundles/`:

- **Moment 1 — no cause stated** (record 3). The FAA advisory of
  2026-11-13 announces the stop and states no cause. An absence,
  recorded honestly: a preliminary view in contemporaneous reporting
  was never an official determination, and the snapshot's basis says
  exactly that.
- **Moment 2 — candidates named** (record 4; supersedes moment 1).
  Secretary Duffy, on Fox News (2026-11-14): the fault "hasn't been
  determined." Two candidates, held apart: installer error by the
  contractor L3 Harris, or a faulty router that flooded other routers
  during the copper-to-fiber replacement. The captured evidence is
  the spoken record itself — the post's bytes, the broadcast
  captions, the raw caption track — and every statement line in the
  snapshot traces verbatim to the captions.
- **Moment 3 — verdict: pending.** No snapshot exists and none is
  fabricated; a marker file holds the slot open. When a determination
  is issued, it enters as a new anchored claim superseding moment 2,
  and the days of not knowing stay provable.

`verify.py` verifies claim bundles standalone, with the same
fail-closed discipline: a tampered or dropped candidate, a swapped
speaker, an in-place certainty upgrade, a backdated claim, or a
verdict fabricated for the pending slot all fail. The claim battery
(`redteam-claims.py`) attacks exactly those rewrites.

```sh
# 7. Verify the claim timeline.
python3 verify.py claims/bundles/moment-1-no-cause-stated   # record 3
python3 verify.py claims/bundles/moment-2-candidates-named  # record 4
cd claims && node replay-claims.mjs ./bundles   # rebuilds the anchored ids exactly
cd .. && python3 redteam-claims.py claims/bundles/moment-2-candidates-named /tmp/redteam-claims
```

## What is baseline, what is new

**Baseline (pre-existing, disclosed):** Agent Embassy is a live agent
services product at https://aemb.pro — an MCP/A2A surface with 33
skills and x402 payments, and an ERC-8004 registration on Base
(agentId 167279). That product is the *publisher*: the organisation
whose answers this evidence layer exists to make provable. Per the
hackathon rules, only the NEAR work below is presented for judging.

**Built new in the hackathon window (November 14, 2026):** everything
in this repository — the evidence-capture poller, the briefing and
freshness machinery, change detection, the NEAR testnet anchor
contract and its deployment, the standalone verifier, the red-team
battery, the November 13 replay, and the MCP tool. The NEAR mainnet
payout account named in the submission is a pre-existing house account
(implicit, receive-only), verified live against NEAR RPC.

## Honest scope

- A research prototype and information aid. **Not an operational
  aviation system.** It issues no clearances, instructions, safety
  determinations, or recommendations, and implies no FAA endorsement.
  Official FAA systems remain authoritative. Any operational aviation
  use would require qualified engineering, validation, and
  institutional participation that this prototype does not have.
- A hash proves committed bytes are unchanged — never that they were
  true, complete, or current. Source failures, feed disagreements,
  and staleness are surfaced as states, not smoothed over.
- Testnet anchoring is deliberate: testnet-only projects are eligible
  in every track, and the mechanism — not the token — is the point.
- First users we imagine: agent builders consuming public data through
  MCP/A2A, then disruption-analytics teams who need historical,
  provable snapshots. Air traffic professionals are future research
  partners, not claimed users.

## Tracks

Primary: **Open Innovation** — a reusable evidence primitive for the
agent economy. Also entered in **AI Security & Defense**: the verifier
is a policy engine over what an agent may claim to know — evidence
validation, enforced by failing closed.

## The longer arc

Today this runs on aviation, where the cost of an unprovable answer
was demonstrated nationally, yesterday. The same shape fits any
consequential public information agents consume: weather warnings,
market halts, public-health notices, election results. The ask behind
this contribution is support for an open, verifiable information
standard for autonomous systems — protocol work, adversarial testing,
source-quality evaluation, and interoperability — so that any agent,
anywhere, can prove what it knew, what it did not know, and what
evidence supported its answers.

## License

MIT. See LICENSE. Contact: agent.embassy@proton.me
