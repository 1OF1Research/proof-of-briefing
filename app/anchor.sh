#!/bin/sh
# Anchor one snapshot on NEAR testnet. Runs on the machine that holds the
# near-cli binary and the testnet key (mx in the house fleet).
#
#   anchor.sh SNAPSHOT_JSON SNAPSHOT_ID DATA_DIR
#
# Calls the anchor contract's publish(source, observed_at, sha256), then
# writes DATA_DIR/anchor.json from the chain's own read-back: the record
# is re-read from the contract before the proof is written, so the proof
# never claims more than the chain holds.
set -eu
SNAPSHOT_JSON="$1"
SNAPSHOT_ID="$2"
DATA_DIR="$3"
NEAR_BIN="${NEAR_BIN:-$HOME/near-build-airspace/bin/near}"
ACCOUNT="agentembassy.testnet"
CONTRACT="agentembassy.testnet"

OBSERVED_AT=$(python3 -c "import json,sys; print(json.load(open('$SNAPSHOT_JSON'))['observed_at'])")
SOURCE="${SOURCE_LABEL:-FAA NAS Status + NOAA Aviation Weather Center (proof-of-briefing/1)}"

OUT=$("$NEAR_BIN" contract call-function as-transaction "$CONTRACT" publish \
  json-args "{\"source\": \"$SOURCE\", \"observed_at\": \"$OBSERVED_AT\", \"sha256\": \"$SNAPSHOT_ID\"}" \
  prepaid-gas '30 TeraGas' attached-deposit '0 NEAR' \
  sign-as "$ACCOUNT" network-config testnet sign-with-legacy-keychain send 2>&1)
echo "$OUT" > "$DATA_DIR/anchor-cli-output.txt"
TX=$(echo "$OUT" | grep -oE 'Transaction ID: [A-Za-z0-9]+' | head -1 | sed 's/Transaction ID: //')
if [ -z "$TX" ]; then
  TX=$(echo "$OUT" | grep -oE 'txns?/[A-Za-z0-9]{32,}' | head -1 | sed 's|.*/||')
fi

# Read the record back from the chain (RPC, not the CLI's word).
python3 - "$CONTRACT" "$SNAPSHOT_ID" "$OBSERVED_AT" "$TX" "$DATA_DIR" <<'PY'
import base64, json, sys, urllib.request
from datetime import datetime, timezone

contract, snap_id, observed_at, tx, data_dir = sys.argv[1:6]

def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": "a", "method": method, "params": params}).encode()
    req = urllib.request.Request("https://rpc.testnet.near.org", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["result"]

def view(method_name, args):
    res = rpc("query", {"request_type": "call_function", "finality": "final",
                        "account_id": contract, "method_name": method_name,
                        "args_base64": base64.b64encode(json.dumps(args).encode()).decode()})
    return json.loads(bytes(res["result"]).decode())

count = view("count", {})
index = count - 1
rec = view("get", {"index": index})
assert rec is not None and rec[2] == snap_id, f"chain read-back mismatch: {rec}"
block = rpc("block", {"block_id": int(rec[3])})
ts_ns = block["header"]["timestamp"]
anchored_at = datetime.fromtimestamp(ts_ns / 1e9, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

proof = {
    "schema": "anchor/1",
    "method": "contract",
    "network": "testnet",
    "contract": contract,
    "publisher": contract,
    "snapshot_id": snap_id,
    "source": rec[0],
    "observed_at": rec[1],
    "index": index,
    "block_height": int(rec[3]),
    "anchored_at": anchored_at,
    "tx_hash": tx or None,
    "explorer_url": f"https://testnet.nearblocks.io/address/{contract}",
    "tx_url": f"https://testnet.nearblocks.io/txns/{tx}" if tx else None,
}
with open(f"{data_dir}/anchor.json", "w") as f:
    json.dump(proof, f, indent=2)
print(json.dumps(proof, indent=2))
PY
