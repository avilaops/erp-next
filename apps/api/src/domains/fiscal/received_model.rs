//! Structural policy for a received document; never a SEFAZ or signature attestation.
#![allow(dead_code)] // Wired to persistent import only after the P0 gate.

#[derive(Debug, PartialEq, Eq)]
pub struct ReceivedMetadata {
    pub key: String,
    pub environment: String,
    pub issuer: String,
    pub issuer_name: String,
    pub recipient: String,
    pub number: u32,
    pub series: u16,
    pub issued_at: String,
    pub total_cents: i64,
    pub item_count: u16,
}

pub fn inspect_received(
    _xml: &str,
    _recipient_cnpj: &str,
) -> Result<ReceivedMetadata, &'static str> {
    Err("Received document policy not implemented")
}

#[cfg(test)]
#[path = "received_model_tests.rs"]
mod tests;
