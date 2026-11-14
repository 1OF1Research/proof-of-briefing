//! Airspace Anchor — an append-only registry of timestamped data snapshots.
//!
//! A publisher reads an official public data feed, hashes the canonical
//! snapshot, and anchors (source, observed_at, sha256) here. Anyone can
//! later check a served snapshot against the anchored hash without
//! trusting the publisher: recompute the hash, compare with the chain.
//! The anchor proves the committed bytes are unchanged — never that the
//! bytes were true.
//!
//! Only the account that deployed the contract may publish. Reads are open.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AirspaceAnchor {
    publisher: AccountId,
    count: u64,
    records: LookupMap<u64, Record>,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Record {
    pub source: String,
    pub observed_at: String,
    pub sha256: String,
    pub block_height: u64,
}

#[near]
impl AirspaceAnchor {
    #[init]
    pub fn new() -> Self {
        Self {
            publisher: env::predecessor_account_id(),
            count: 0,
            records: LookupMap::new(b"r".to_vec()),
        }
    }

    /// Anchor one snapshot. Publisher-only. Returns the record index.
    pub fn publish(&mut self, source: String, observed_at: String, sha256: String) -> u64 {
        assert_eq!(
            env::predecessor_account_id(),
            self.publisher,
            "only the publisher may anchor snapshots"
        );
        assert_eq!(sha256.len(), 64, "sha256 must be 64 hex characters");
        let index = self.count;
        self.records.set(
            index,
            Some(Record {
                source,
                observed_at,
                sha256,
                block_height: env::block_height(),
            }),
        );
        self.count += 1;
        env::log_str(&format!("ANCHORED {}", index));
        index
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    pub fn publisher(&self) -> AccountId {
        self.publisher.clone()
    }

    /// Returns [source, observed_at, sha256, block_height] for an index.
    pub fn get(&self, index: u64) -> Option<Vec<String>> {
        self.records.get(&index).map(|r| {
            vec![
                r.source.clone(),
                r.observed_at.clone(),
                r.sha256.clone(),
                r.block_height.to_string(),
            ]
        })
    }

    /// The most recent record, same shape as `get`. None before first publish.
    pub fn latest(&self) -> Option<Vec<String>> {
        if self.count == 0 {
            None
        } else {
            self.get(self.count - 1)
        }
    }
}
