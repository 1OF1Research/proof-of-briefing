#!/usr/bin/env python3
"""Red-team battery for Proof of Briefing (HACKATHON Omega section 3).

    python3 redteam.py GENUINE_BUNDLE_DIR WORK_DIR

Every attack runs against a COPY of the genuine bundle. The verifier must
fail closed on each one. Results print as ATTACK lines and are meant to be
saved verbatim: failures and successes are both evidence.

Design note (attack 7): the verifier deliberately ignores bundle-supplied
transaction references. Its authority is the contract state read live from
a public NEAR RPC. A forged tx string in anchor.json therefore changes
nothing — the battery confirms the PASS rests on the chain read, and that
forging the fields the verifier DOES trust (index, snapshot id) fails.
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


def run_verify(bundle, rpc=None):
    cmd = [sys.executable, str(Path(__file__).parent / "verify.py"), str(bundle)]
    if rpc:
        cmd += ["--rpc", rpc]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    return p.returncode, p.stdout + p.stderr


def fresh_copy(name):
    dst = WORK / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(GENUINE, dst)
    return dst


def main():
    WORK.mkdir(parents=True, exist_ok=True)

    # 0. Control: the genuine bundle passes.
    rc, out = run_verify(GENUINE)
    record("control-genuine-passes", rc == 0, f"exit {rc}")

    # 1. Tampered briefing: one word changed inside the brief.
    b = fresh_copy("tampered-brief")
    snap = json.loads((b / "snapshot.json").read_text())
    snap["interpretation"]["brief"] = snap["interpretation"]["brief"].replace("official", "certified", 1)
    (b / "snapshot.json").write_text(json.dumps(snap, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    rc, out = run_verify(b)
    record("tampered-briefing", rc != 0 and "RESULT: FAIL" in out, "verifier rejects a one-word change")

    # 2. Tampered raw source bytes: one byte in the captured FAA feed.
    b = fresh_copy("tampered-raw")
    f = b / "evidence" / "faa-nas-status.xml"
    raw = bytearray(f.read_bytes())
    raw[len(raw) // 2] ^= 0x01
    f.write_bytes(bytes(raw))
    rc, out = run_verify(b)
    record("tampered-raw-bytes", rc != 0 and "RESULT: FAIL" in out, "evidence digest catches a single flipped byte")

    # 3. Missing evidence file.
    b = fresh_copy("missing-evidence")
    (b / "evidence" / "metar.json").unlink()
    rc, out = run_verify(b)
    record("missing-evidence", rc != 0 and "RESULT: FAIL" in out, "absent evidence fails closed")

    # 4. Altered manifest digest inside the snapshot.
    b = fresh_copy("altered-manifest")
    snap = json.loads((b / "snapshot.json").read_text())
    snap["evidence"][0]["sha256"] = "0" * 64
    (b / "snapshot.json").write_text(json.dumps(snap, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    rc, out = run_verify(b)
    record("altered-manifest-digest", rc != 0 and "RESULT: FAIL" in out, "snapshot digest no longer recomputes")

    # 5. Changed timestamp: retrieval time moved after the fact.
    b = fresh_copy("changed-timestamp")
    snap = json.loads((b / "snapshot.json").read_text())
    snap["observed_at"] = "2026-11-14T10:00:00Z"
    (b / "snapshot.json").write_text(json.dumps(snap, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    rc, out = run_verify(b)
    record("changed-timestamps", rc != 0 and "RESULT: FAIL" in out, "a rewritten history fails the digest and the chain record")

    # 6. Wrong canonicalization: same JSON, pretty-printed bytes served.
    b = fresh_copy("noncanonical")
    snap = json.loads((b / "snapshot.json").read_text())
    (b / "snapshot.json").write_text(json.dumps(snap, indent=2))
    rc, out = run_verify(b)
    record("noncanonical-bytes", rc != 0 and "RESULT: FAIL" in out, "non-canonical served bytes are rejected")

    # 7a. Forged transaction reference (informational field): PASS must rest
    # on the chain read, so the verifier still passes and never used the ref.
    b = fresh_copy("forged-txref")
    anchor = json.loads((b / "anchor.json").read_text())
    anchor["tx_hash"] = "ForgedForgedForgedForgedForgedForgedForged1"
    anchor["tx_url"] = "https://testnet.nearblocks.io/txns/forged"
    (b / "anchor.json").write_text(json.dumps(anchor, indent=2))
    rc, out = run_verify(b)
    record("forged-tx-reference", rc == 0, "verifier ignores bundle tx refs; authority is the live contract read")

    # 7b. Forged anchor index (a field the verifier does trust).
    b = fresh_copy("forged-index")
    anchor = json.loads((b / "anchor.json").read_text())
    anchor["index"] = 999
    (b / "anchor.json").write_text(json.dumps(anchor, indent=2))
    rc, out = run_verify(b)
    record("forged-anchor-index", rc != 0 and "RESULT: FAIL" in out, "a wrong record index fails the chain check")

    # 8. Wrong chain: verify against mainnet, where this contract is absent.
    rc, out = run_verify(GENUINE, rpc="https://rpc.mainnet.near.org")
    record("wrong-chain", rc != 0 and "RESULT: FAIL" in out, "mainnet read finds no such record; fails closed")

    # 9. Pending anchoring: proof file removed entirely.
    b = fresh_copy("pending-anchor")
    (b / "anchor.json").unlink()
    rc, out = run_verify(b)
    record("pending-anchoring", rc != 0, "no anchor record, no verification — never labelled verified")

    failed = [n for n, ok, _ in RESULTS if not ok]
    print()
    print(f"BATTERY: {len(RESULTS) - len(failed)}/{len(RESULTS)} attacks resisted")
    if failed:
        print("NOT RESISTED:", ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
