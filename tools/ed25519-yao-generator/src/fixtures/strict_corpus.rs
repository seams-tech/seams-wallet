//! Shape and encoding shared by the strict host-only vector corpora. Each corpus is its pretty
//! JSON with one trailing LF, and its parser accepts exactly those bytes.

use serde::Serialize;

/// A strict corpus: fixed schema, protocol identifier and evidence scope, then ordered cases.
#[derive(Serialize)]
pub struct StrictVectorCorpusV1<Case> {
    pub(crate) schema: String,
    pub(crate) protocol_id: String,
    pub(crate) evidence_scope: String,
    pub(crate) cases: Vec<Case>,
}

impl<Case> StrictVectorCorpusV1<Case> {
    /// Returns the fixed corpus schema.
    pub fn schema(&self) -> &str {
        &self.schema
    }

    /// Returns the fixed protocol identifier.
    pub fn protocol_id(&self) -> &str {
        &self.protocol_id
    }

    /// Returns the narrow host-only evidence scope.
    pub fn evidence_scope(&self) -> &str {
        &self.evidence_scope
    }

    /// Returns the exact case count.
    pub fn case_count(&self) -> usize {
        self.cases.len()
    }
}

/// Encodes a fixed corpus as pretty JSON with one trailing LF.
pub(crate) fn canonical_json_bytes<T: Serialize>(corpus: &T) -> Vec<u8> {
    let mut encoded = serde_json::to_vec_pretty(corpus).expect("fixed corpus serializes");
    encoded.push(b'\n');
    encoded
}

/// Returns the canonical corpus when `encoded` is exactly its canonical encoding.
pub(crate) fn parse_canonical_json<T: Serialize>(
    encoded: &[u8],
    canonical: impl FnOnce() -> T,
) -> Option<T> {
    let corpus = canonical();
    (encoded == canonical_json_bytes(&corpus)).then_some(corpus)
}
