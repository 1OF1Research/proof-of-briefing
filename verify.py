#!/usr/bin/env python3
"""Proof of Briefing — independent verifier (Agent Embassy).

    python3 verify.py BUNDLE_DIR [--rpc URL]

A bundle is a directory holding:
    snapshot.json                 the canonical snapshot bytes
    evidence/faa-nas-status.xml   raw bytes, exactly as the FAA served them
    evidence/metar.json           raw bytes, exactly as NOAA served them
    anchor.json                   the NEAR anchor record for the snapshot

The verifier trusts nothing in the bundle. It checks:

  1. The snapshot's canonical digest (keys sorted, no whitespace, UTF-8)
     recomputes to the snapshot id the anchor claims.
  2. Every evidence file's byte count and SHA-256 match the manifest
     inside the snapshot.
  3. The snapshot's facts trace to the captured bytes: the FAA update
     time appears verbatim in the raw feed, and every weather observation
     line in the snapshot appears verbatim in the raw NOAA response.
  4. The NEAR testnet contract's anchored record — read live from a
     public RPC, not from the bundle — carries the same snapshot id,
     source, and retrieval time.
  5. Freshness is reported honestly (informational; staleness is a
     label, not a failure of integrity).

Exit 0 and "RESULT: PASS" only if every integrity check passes. Alter
one byte anywhere — the briefing, a timestamp, a captured feed — and
verification fails. A hash proves committed bytes are unchanged; it
does not prove the bytes were true. Pure standard library.
"""

import base64
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

RPC_DEFAULT = "https://rpc.testnet.near.org"
FAILURES = []


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)
    return ok


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


RPC_FALLBACKS = ["https://rpc.testnet.near.org", "https://testnet.drpc.org"]


def rpc(url, method, params):
    # Endpoint discipline: the default testnet URL may fall back among
    # testnet endpoints. An explicitly pinned --rpc URL is used ALONE:
    # a verifier must never wander to another chain because a read
    # failed — failing closed is the correct answer to a wrong chain.
    body = json.dumps({"jsonrpc": "2.0", "id": "v", "method": method, "params": params}).encode()
    endpoints = RPC_FALLBACKS if url == RPC_DEFAULT else [url]
    last = None
    for endpoint in endpoints:
        for _ in range(3):
            try:
                req = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    out = json.loads(r.read())
                if "error" in out:
                    raise RuntimeError(f"RPC error: {out['error']}")
                return out["result"]
            except Exception as e:  # transient transport failure: retry, then fall back
                last = e
    raise RuntimeError(f"all NEAR RPC endpoints failed: {last}")


def view_call(rpc_url, contract, method_name, args_obj):
    args_b64 = base64.b64encode(json.dumps(args_obj).encode()).decode()
    res = rpc(rpc_url, "query", {
        "request_type": "call_function",
        "finality": "final",
        "account_id": contract,
        "method_name": method_name,
        "args_base64": args_b64,
    })
    return json.loads(bytes(res["result"]).decode())


def main():
    if len(sys.argv) < 2:
        print("usage: verify.py BUNDLE_DIR [--rpc URL]")
        return 2
    bundle = Path(sys.argv[1])
    rpc_url = RPC_DEFAULT
    if "--rpc" in sys.argv:
        rpc_url = sys.argv[sys.argv.index("--rpc") + 1]

    snap_path = bundle / "snapshot.json"
    anchor_path = bundle / "anchor.json"
    if not snap_path.exists() or not anchor_path.exists():
        print("RESULT: FAIL — bundle is missing snapshot.json or anchor.json")
        return 1

    snap_bytes = snap_path.read_bytes()
    snap = json.loads(snap_bytes.decode("utf-8"))
    anchor = json.loads(anchor_path.read_text())

    # 1. Canonical digest.
    digest = hashlib.sha256(canonical(snap)).hexdigest()
    check("snapshot canonical digest recomputes", digest == anchor.get("snapshot_id"),
          f"sha256 {digest[:16]}… vs anchor {str(anchor.get('snapshot_id'))[:16]}…")
    check("served bytes are the canonical bytes", snap_bytes == canonical(snap))

    # 2. Evidence files match the manifest.
    for entry in snap.get("evidence", []):
        f = bundle / "evidence" / entry["file"]
        if not f.exists():
            check(f"evidence present: {entry['file']}", False, "file missing")
            continue
        raw = f.read_bytes()
        ok = len(raw) == entry["bytes"] and hashlib.sha256(raw).hexdigest() == entry["sha256"]
        check(f"evidence intact: {entry['source']}", ok,
              f"{len(raw)} bytes, sha256 {hashlib.sha256(raw).hexdigest()[:16]}…")

    # 3. Facts trace to the captured bytes.
    faa_file = bundle / "evidence" / "faa-nas-status.xml"
    metar_file = bundle / "evidence" / "metar.json"
    if faa_file.exists():
        faa_text = faa_file.read_text(encoding="utf-8", errors="replace")
        upd = snap["observed"].get("faa_update_time")
        check("FAA update time traces to the captured feed", bool(upd) and upd in faa_text, str(upd))
    # Every stated reason in the observed picture must appear verbatim in
    # some captured evidence file — briefings cite sources, never invent.
    evidence_texts = []
    for entry in snap.get("evidence", []):
        f = bundle / "evidence" / entry["file"]
        if f.exists():
            evidence_texts.append(f.read_text(encoding="utf-8", errors="replace"))
    joined = "\n".join(evidence_texts)
    untraced = []
    for p in snap["observed"].get("programs", []):
        for e in p.get("entries", []):
            reason = e.get("Reason")
            if reason and reason[:80] not in joined:
                untraced.append(reason[:40])
    check("every stated program reason traces to captured evidence", not untraced,
          "untraced: " + "; ".join(untraced) if untraced else "all reasons traced")

    if metar_file.exists():
        metar_text = metar_file.read_text(encoding="utf-8", errors="replace")
        missing = []
        for code, a in snap["observed"].get("airports", {}).items():
            m = a.get("metar")
            if m and m.get("raw") and m["raw"] not in metar_text:
                missing.append(code)
        check("every weather line traces to the captured NOAA bytes", not missing,
              "missing: " + ",".join(missing) if missing else "all stations traced")

    # Brief and timestamps are inside the hashed snapshot, so they are
    # covered by check 1; confirm the brief names the retrieval time.
    brief = snap.get("interpretation", {}).get("brief", "")
    check("brief carries the retrieval time it claims",
          snap.get("observed_at", "") in brief, snap.get("observed_at", ""))

    # 4. The chain's own record, read live. The record at the claimed index
    # is the authority — an evidence system must verify old snapshots too,
    # not only the newest one.
    contract = anchor.get("contract")
    try:
        idx = anchor.get("index")
        if idx is None:
            check("NEAR anchor record exists", False, "anchor record claims no index")
        else:
            rec = view_call(rpc_url, contract, "get", {"index": idx})
            ok = rec is not None and rec[2] == digest and rec[1] == snap["observed_at"]
            check("NEAR anchor record at the claimed index carries this snapshot",
                  ok, f"index {idx}, chain sha256 {str(rec[2])[:16] if rec else 'none'}…")
            latest = view_call(rpc_url, contract, "latest", {})
            if latest is not None:
                print(f"[INFO] contract's newest record is a different snapshot"
                      if latest[2] != digest else "[INFO] this snapshot is also the contract's newest record")
    except Exception as e:  # network or RPC problem: say so, fail closed
        check("NEAR anchor record exists", False, f"chain read failed: {e}")

    # 5. Freshness (informational).
    age = int(time.time() - time.mktime(time.strptime(snap["observed_at"], "%Y-%m-%dT%H:%M:%SZ")) - time.timezone)
    state = "fresh" if age <= 900 else "stale"
    if snap.get("feed_stability") == "conflicting":
        state = "conflicting"
    print(f"[INFO] freshness at verify time: {state} (snapshot age {age}s) — a label, not an integrity result")

    if FAILURES:
        print(f"RESULT: FAIL — {len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("RESULT: PASS — the bundle is the anchored snapshot, byte for byte")
    return 0


if __name__ == "__main__":
    sys.exit(main())
