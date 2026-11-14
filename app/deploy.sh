#!/bin/sh
# Deploy the anchor contract to the house testnet account and initialize it.
# Runs on the machine holding near-cli + the testnet key (mx in the fleet).
set -eu
cd "$HOME/near-build-airspace"
WASM="contract/target/wasm32-unknown-unknown/release/airspace_anchor.wasm"
printf '\n' | script -qec "./bin/near contract deploy agentembassy.testnet use-file $WASM with-init-call new json-args '{}' prepaid-gas '100 TeraGas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send" /dev/null
