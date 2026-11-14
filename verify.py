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

A CLAIM bundle (claim.json instead of snapshot.json) proves what an
official SAID: the statement's words trace verbatim to the captured
caption evidence; the statement time traces to the captured post
record; the certainty state and the candidate set sit inside the
digest, so a tampered candidate, a dropped candidate, a swapped
speaker, an in-place certainty upgrade, or a backdated claim all fail;
and a claim that supersedes another must point at a digest that is
itself anchored on the chain. The verdict slot of a timeline is a
pending marker, never a bundle — a fabricated verdict has no anchor
and fails.

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


def parse_iso(s):
    import calendar
    import datetime

    return calendar.timegm(datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").timetuple())


CERTAINTY_STATES = ["none-stated", "unknown", "candidates-named", "verdict"]


def verify_claim(bundle, rpc_url):
    claim_path = bundle / "claim.json"
    anchor_path = bundle / "anchor.json"
    if not claim_path.exists():
        print("RESULT: FAIL — claim bundle is missing claim.json")
        return 1
    if not anchor_path.exists():
        print("RESULT: FAIL — claim bundle has no anchor record (unanchored claims are never verified; a fabricated verdict fails here)")
        return 1

    claim_bytes = claim_path.read_bytes()
    claim = json.loads(claim_bytes.decode("utf-8"))
    anchor = json.loads(anchor_path.read_text())

    check("claim schema is proof-of-briefing-claim/1", claim.get("schema") == "proof-of-briefing-claim/1",
          str(claim.get("schema")))

    # 1. Canonical digest — the certainty state, the candidate set, the
    # speaker, and the statement lines are all inside it.
    digest = hashlib.sha256(canonical(claim)).hexdigest()
    check("claim canonical digest recomputes", digest == anchor.get("snapshot_id"),
          f"sha256 {digest[:16]}… vs anchor {str(anchor.get('snapshot_id'))[:16]}…")
    check("served claim bytes are the canonical bytes", claim_bytes == canonical(claim))
    check("observed_at is the statement time (anchor field discipline)",
          claim.get("observed_at") == claim.get("stated_at"), str(claim.get("stated_at")))

    # 2. Evidence files match the manifest.
    for entry in claim.get("evidence", []):
        f = bundle / "evidence" / entry["file"]
        if not f.exists():
            check(f"evidence present: {entry['file']}", False, "file missing")
            continue
        raw = f.read_bytes()
        ok = len(raw) == entry["bytes"] and hashlib.sha256(raw).hexdigest() == entry["sha256"]
        check(f"evidence intact: {entry['file']}", ok, f"{len(raw)} bytes, sha256 {hashlib.sha256(raw).hexdigest()[:16]}…")

    # 3. The statement's words trace verbatim to the captured captions:
    # every claimed line is one of the transcript's lines.
    lines = claim.get("statement_lines", [])
    transcript_files = [e for e in claim.get("evidence", []) if "transcript" in e["file"]]
    if lines:
        if not transcript_files:
            check("statement lines trace to captured captions", False, "no transcript evidence in bundle")
        else:
            import re

            captured = set()
            for e in transcript_files:
                f = bundle / "evidence" / e["file"]
                if f.exists():
                    for raw_line in f.read_text(encoding="utf-8", errors="replace").split("\n"):
                        captured.add(re.sub(r"^\[\d{2}:\d{2}\]\s*", "", raw_line))
            missing = [l for l in lines if l not in captured]
            check("every statement line traces verbatim to the captured captions", not missing,
                  "untraced: " + "; ".join(missing) if missing else f"all {len(lines)} lines traced")

    # 4. The statement time traces to the captured post record.
    post_file = bundle / "evidence" / "x-post.json"
    if post_file.exists():
        try:
            post = json.loads(post_file.read_text())
            ts = post["tweet"]["created_timestamp"]
            import datetime

            post_iso = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            check("statement time traces to the captured post record", post_iso == claim.get("stated_at"),
                  f"post {post_iso} vs claim {claim.get('stated_at')}")
        except Exception as e:
            check("statement time traces to the captured post record", False, f"post record unreadable: {e}")

    # 5. Time order: a statement cannot be retrieved before it was made,
    # nor anchored before it was retrieved. A backdated claim fails here
    # even before the digest is consulted.
    try:
        t_stated = parse_iso(claim["stated_at"])
        t_retrieved = parse_iso(claim["retrieved_at"])
        t_anchored = parse_iso(anchor["anchored_at"])
        check("time order holds (stated <= retrieved <= anchored)",
              t_stated <= t_retrieved <= t_anchored,
              f"stated {claim['stated_at']}, retrieved {claim['retrieved_at']}, anchored {anchor['anchored_at']}")
    except Exception as e:
        check("time order holds (stated <= retrieved <= anchored)", False, f"unparseable time: {e}")

    # 6. Certainty discipline.
    cert = claim.get("certainty")
    candidates = claim.get("candidates", [])
    brief = claim.get("interpretation", {}).get("brief", "")
    check("certainty state is a known state", cert in CERTAINTY_STATES, str(cert))
    if cert == "candidates-named":
        check("candidates-named holds at least two candidates apart", len(candidates) >= 2,
              f"{len(candidates)} candidates")
        absent = [c for c in candidates if c not in brief]
        check("every candidate appears verbatim in the claim brief", not absent,
              "absent: " + "; ".join(absent) if absent else "all candidates carried")
        check("brief carries the not-yet-known line", "Not yet known:" in brief)
    elif cert == "none-stated":
        check("none-stated carries no candidates and no statement lines",
              candidates == [] and lines == [], "an absence record invents nothing")
        check("brief carries the not-yet-known line", "Not yet known:" in brief)
    elif cert == "unknown":
        check("brief carries the not-yet-known line", "Not yet known:" in brief)
    elif cert == "verdict":
        check("a verdict references the claim it supersedes", bool(claim.get("supersedes")),
              str(claim.get("supersedes"))[:16] + "…" if claim.get("supersedes") else "missing")

    # 7–8. The chain's own records, read live: the record at the claimed
    # index carries this claim, and whatever this claim supersedes is
    # itself anchored — an upgrade floating free of the chain fails.
    contract = anchor.get("contract")
    try:
        idx = anchor.get("index")
        if idx is None:
            check("NEAR anchor record exists", False, "anchor record claims no index")
        else:
            rec = view_call(rpc_url, contract, "get", {"index": idx})
            ok = rec is not None and rec[2] == digest and rec[1] == claim["stated_at"]
            check("NEAR anchor record at the claimed index carries this claim",
                  ok, f"index {idx}, chain sha256 {str(rec[2])[:16] if rec else 'none'}…")
        if claim.get("supersedes"):
            count = view_call(rpc_url, contract, "count", {})
            found = False
            for i in range(count):
                r = view_call(rpc_url, contract, "get", {"index": i})
                if r is not None and r[2] == claim["supersedes"]:
                    found = True
                    break
            check("the superseded claim is itself anchored on the chain", found,
                  f"supersedes {str(claim['supersedes'])[:16]}…, scanned {count} records")
    except Exception as e:
        check("NEAR anchor record exists", False, f"chain read failed: {e}")

    if FAILURES:
        print(f"RESULT: FAIL — {len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("RESULT: PASS — the claim bundle is the anchored claim, byte for byte")
    return 0


def main():
    if len(sys.argv) < 2:
        print("usage: verify.py BUNDLE_DIR [--rpc URL]")
        return 2
    bundle = Path(sys.argv[1])
    rpc_url = RPC_DEFAULT
    if "--rpc" in sys.argv:
        rpc_url = sys.argv[sys.argv.index("--rpc") + 1]

    if (bundle / "claim.json").exists():
        return verify_claim(bundle, rpc_url)

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
