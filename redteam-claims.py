#!/usr/bin/env python3
"""Red-team battery for Proof of Briefing CLAIM bundles.

    python3 redteam-claims.py GENUINE_CLAIM_BUNDLE_DIR WORK_DIR

Every attack runs against a COPY of the genuine (anchored, verified)
claim bundle. The verifier must fail closed on each one. The claim
path's whole promise is that the record of what officials SAID is as
hard to rewrite as the record of what sources SHOWED — so the battery
aims at the ways a claim gets quietly rewritten after the fact: a
candidate softened, dropped, or merged; a speaker swapped; certainty
upgraded in place; a verdict fabricated for the pending slot; a claim
backdated or re-pointed at a different incident.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

GENUINE = Path(sys.argv[1])
WORK = Path(sys.argv[2])
RESULTS = []


def record(name, ok, detail):
    RESULTS.append((name, ok, detail))
    print(f"ATTACK {name}: {'RESISTED' if ok else 'NOT-RESISTED'} — {detail}")


def run_verify(bundle):
    cmd = [sys.executable, str(Path(__file__).parent / "verify.py"), str(bundle)]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return p.returncode, p.stdout + p.stderr


def fresh_copy(name):
    dst = WORK / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(GENUINE, dst)
    return dst


def edit_claim(bundle, fn):
    p = bundle / "claim.json"
    claim = json.loads(p.read_text())
    fn(claim)
    p.write_text(json.dumps(claim, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    return claim


def main():
    WORK.mkdir(parents=True, exist_ok=True)

    # 0. Control: the genuine claim bundle passes.
    rc, out = run_verify(GENUINE)
    record("control-genuine-passes", rc == 0, f"exit {rc}")

    # 1. Tampered candidate: one candidate's wording softened.
    b = fresh_copy("tampered-candidate")
    edit_claim(b, lambda c: c["candidates"].__setitem__(0, "installer error by the contractor"))
    rc, out = run_verify(b)
    record("tampered-candidate", rc != 0 and "RESULT: FAIL" in out, "a softened candidate breaks the digest")

    # 2. Dropped candidate: the inconvenient one disappears.
    b = fresh_copy("dropped-candidate")
    edit_claim(b, lambda c: c.__setitem__("candidates", c["candidates"][:1]))
    rc, out = run_verify(b)
    record("dropped-candidate", rc != 0 and "RESULT: FAIL" in out, "a dropped candidate breaks the digest and the held-apart check")

    # 3. Merged candidates: two live causes collapsed into one.
    b = fresh_copy("merged-candidates")
    edit_claim(b, lambda c: c.__setitem__("candidates", [" or ".join(c["candidates"])]))
    rc, out = run_verify(b)
    record("merged-candidates", rc != 0 and "RESULT: FAIL" in out, "merging the candidates is a rewrite, and fails")

    # 4. Swapped speaker: the words re-attributed to someone else.
    b = fresh_copy("swapped-speaker")
    edit_claim(b, lambda c: c.__setitem__("speaker", "Kristi Noem, U.S. Secretary of Homeland Security"))
    rc, out = run_verify(b)
    record("swapped-speaker", rc != 0 and "RESULT: FAIL" in out, "the speaker is inside the digest")

    # 5. Certainty upgraded in place: candidates-named becomes verdict
    # in the same bundle — the classic quiet rewrite.
    b = fresh_copy("certainty-upgraded")
    def upgrade(c):
        c["certainty"] = "verdict"
        c["candidates"] = [c["candidates"][1]]
    edit_claim(b, upgrade)
    rc, out = run_verify(b)
    record("certainty-upgraded-in-place", rc != 0 and "RESULT: FAIL" in out, "an in-place upgrade breaks the digest against the chain")

    # 6a. Fabricated verdict for the pending slot: a fresh claim with a
    # verdict and no anchor at all.
    b = fresh_copy("fabricated-verdict")
    (b / "anchor.json").unlink()
    def fabricate(c):
        c["certainty"] = "verdict"
        c["candidates"] = [c["candidates"][1]]
        c["stated_at"] = "2026-11-14T18:00:00Z"
        c["observed_at"] = "2026-11-14T18:00:00Z"
        c["retrieved_at"] = "2026-11-14T18:05:00Z"
    edit_claim(b, fabricate)
    rc, out = run_verify(b)
    record("fabricated-verdict-no-anchor", rc != 0 and "RESULT: FAIL" in out, "no anchor record, no verification")

    # 6b. Fabricated verdict wearing the genuine bundle's anchor.
    b = fresh_copy("fabricated-verdict-forged-anchor")
    edit_claim(b, fabricate)
    rc, out = run_verify(b)
    record("fabricated-verdict-forged-anchor", rc != 0 and "RESULT: FAIL" in out, "the borrowed anchor's digest cannot match the fabricated claim")

    # 7. Backdated claim: the statement moved a day earlier after the fact.
    b = fresh_copy("backdated-claim")
    def backdate(c):
        c["stated_at"] = "2026-11-13T16:19:44Z"
        c["observed_at"] = "2026-11-13T16:19:44Z"
    edit_claim(b, backdate)
    rc, out = run_verify(b)
    record("backdated-claim", rc != 0 and "RESULT: FAIL" in out, "backdating breaks the digest, the post trace, and the chain record")

    # 8. Wrong incident: the claim re-pointed at a different event.
    b = fresh_copy("wrong-incident")
    edit_claim(b, lambda c: c.__setitem__("incident", "2026-11-12 FAA ground delay program"))
    rc, out = run_verify(b)
    record("wrong-incident", rc != 0 and "RESULT: FAIL" in out, "the incident is inside the digest")

    # 9. Forged supersession: pointing at a claim that was never anchored.
    b = fresh_copy("forged-supersedes")
    edit_claim(b, lambda c: c.__setitem__("supersedes", "0" * 64))
    rc, out = run_verify(b)
    record("forged-supersedes", rc != 0 and "RESULT: FAIL" in out, "a supersession pointer is inside the digest and checked against the chain")

    # 10. Tampered statement line: one word of the speaker's words changed.
    b = fresh_copy("tampered-statement")
    edit_claim(b, lambda c: c["statement_lines"].__setitem__(3, "We have determined what the fault was"))
    rc, out = run_verify(b)
    record("tampered-statement-line", rc != 0 and "RESULT: FAIL" in out, "the negation is the story; flipping it breaks the digest and the caption trace")

    # 11. Tampered caption evidence: one byte flipped in the transcript.
    b = fresh_copy("tampered-transcript")
    f = b / "evidence" / "transcript.txt"
    raw = bytearray(f.read_bytes())
    raw[len(raw) // 2] ^= 0x01
    f.write_bytes(bytes(raw))
    rc, out = run_verify(b)
    record("tampered-transcript-bytes", rc != 0 and "RESULT: FAIL" in out, "evidence digest catches a single flipped byte")

    failed = [n for n, ok, _ in RESULTS if not ok]
    print()
    print(f"BATTERY: {len(RESULTS) - len(failed)}/{len(RESULTS)} attacks resisted")
    if failed:
        print("NOT RESISTED:", ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
