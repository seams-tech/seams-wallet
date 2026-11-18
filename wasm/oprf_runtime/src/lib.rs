//! The partially oblivious PRF of RFC 9497 (POPRF mode, ristretto255-SHA512).
//!
//! The client keeps a private input and learns `F(k, input, info)`. The server
//! applies its key `k` to a blinded element, so it learns neither the input nor
//! the output. The public `info` input selects a different function for each
//! value, so a key evaluation for one `info` never yields the output of another.
//! The proof lets the client check that the server used the key of its public key.

use std::cell::RefCell;
use std::collections::HashMap;

use rand_core::OsRng;
use voprf::{
    BlindedElement, EvaluationElement, Group, PoprfClient, PoprfServer, Proof, Ristretto255,
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

type Suite = Ristretto255;

#[derive(Default)]
struct ClientStore {
    next_handle: u32,
    clients: HashMap<u32, PoprfClient<Suite>>,
}

thread_local! {
    static CLIENTS: RefCell<ClientStore> = RefCell::new(ClientStore::default());
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsError::new(&message.into()).into()
}

fn server_from_seed(seed: &[u8], key_info: &[u8]) -> Result<PoprfServer<Suite>, String> {
    if seed.len() != 32 {
        return Err("OPRF key seed must be 32 bytes".into());
    }
    PoprfServer::<Suite>::new_from_seed(seed, key_info)
        .map_err(|error| format!("OPRF key derivation failed: {error:?}"))
}

/// A blinded input. The blind stays in this module under `handle` until
/// `oprf_client_finalize` or `oprf_client_discard` removes it.
#[wasm_bindgen]
pub struct OprfBlind {
    handle: u32,
    blinded_element: Vec<u8>,
}

#[wasm_bindgen]
impl OprfBlind {
    #[wasm_bindgen(getter)]
    pub fn handle(&self) -> u32 {
        self.handle
    }

    #[wasm_bindgen(getter, js_name = blindedElement)]
    pub fn blinded_element(&self) -> Vec<u8> {
        self.blinded_element.clone()
    }
}

/// The server's answer: the evaluated element and the proof that it used its key.
#[wasm_bindgen]
pub struct OprfEvaluation {
    evaluated_element: Vec<u8>,
    proof: Vec<u8>,
}

#[wasm_bindgen]
impl OprfEvaluation {
    #[wasm_bindgen(getter, js_name = evaluatedElement)]
    pub fn evaluated_element(&self) -> Vec<u8> {
        self.evaluated_element.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn proof(&self) -> Vec<u8> {
        self.proof.clone()
    }
}

fn client_blind(input: &[u8]) -> Result<OprfBlind, String> {
    let blinded = PoprfClient::<Suite>::blind(input, &mut OsRng)
        .map_err(|error| format!("OPRF blind failed: {error:?}"))?;
    let blinded_element = blinded.message.serialize().to_vec();
    let handle = CLIENTS.with(|store| {
        let mut store = store.borrow_mut();
        let handle = store
            .next_handle
            .checked_add(1)
            .ok_or("OPRF client handle space exhausted")?;
        store.next_handle = handle;
        store.clients.insert(handle, blinded.state);
        Ok::<u32, String>(handle)
    })?;
    Ok(OprfBlind {
        handle,
        blinded_element,
    })
}

fn client_finalize(
    handle: u32,
    input: &[u8],
    evaluated_element: &[u8],
    proof: &[u8],
    public_key: &[u8],
    info: &[u8],
) -> Result<Vec<u8>, String> {
    let client = CLIENTS
        .with(|store| store.borrow_mut().clients.remove(&handle))
        .ok_or("Unknown OPRF client handle")?;
    let evaluated = EvaluationElement::<Suite>::deserialize(evaluated_element)
        .map_err(|_| "OPRF evaluated element is invalid")?;
    let proof = Proof::<Suite>::deserialize(proof).map_err(|_| "OPRF proof is invalid")?;
    let public_key = <Suite as Group>::deserialize_elem(public_key)
        .map_err(|_| "OPRF public key is invalid")?;
    let mut output = client
        .finalize(input, &evaluated, &proof, public_key, Some(info))
        .map_err(|error| format!("OPRF finalize failed: {error:?}"))?;
    let result = output.to_vec();
    output.zeroize();
    Ok(result)
}

fn client_discard(handle: u32) -> bool {
    CLIENTS.with(|store| store.borrow_mut().clients.remove(&handle).is_some())
}

fn server_evaluate(
    seed: &[u8],
    key_info: &[u8],
    blinded_element: &[u8],
    info: &[u8],
) -> Result<OprfEvaluation, String> {
    let server = server_from_seed(seed, key_info)?;
    let blinded = BlindedElement::<Suite>::deserialize(blinded_element)
        .map_err(|_| "OPRF blinded element is invalid")?;
    let evaluation = server
        .blind_evaluate(&mut OsRng, &blinded, Some(info))
        .map_err(|error| format!("OPRF evaluation failed: {error:?}"))?;
    Ok(OprfEvaluation {
        evaluated_element: evaluation.message.serialize().to_vec(),
        proof: evaluation.proof.serialize().to_vec(),
    })
}

fn server_public_key(seed: &[u8], key_info: &[u8]) -> Result<Vec<u8>, String> {
    let server = server_from_seed(seed, key_info)?;
    Ok(<Suite as Group>::serialize_elem(server.get_public_key()).to_vec())
}

#[wasm_bindgen]
pub fn init_oprf_runtime() {}

#[wasm_bindgen]
pub fn oprf_client_blind(input: &[u8]) -> Result<OprfBlind, JsValue> {
    client_blind(input).map_err(js_error)
}

/// Removes the blind, checks the proof against `public_key` and returns the
/// 64-byte output. The handle is gone after this call, even when it fails.
#[wasm_bindgen]
pub fn oprf_client_finalize(
    handle: u32,
    input: &[u8],
    evaluated_element: &[u8],
    proof: &[u8],
    public_key: &[u8],
    info: &[u8],
) -> Result<Vec<u8>, JsValue> {
    client_finalize(handle, input, evaluated_element, proof, public_key, info).map_err(js_error)
}

/// Drops a blind that will not be finalized.
#[wasm_bindgen]
pub fn oprf_client_discard(handle: u32) -> bool {
    client_discard(handle)
}

/// Evaluates a blinded element under the key that `seed` and `key_info` derive.
#[wasm_bindgen]
pub fn oprf_server_evaluate(
    seed: &[u8],
    key_info: &[u8],
    blinded_element: &[u8],
    info: &[u8],
) -> Result<OprfEvaluation, JsValue> {
    server_evaluate(seed, key_info, blinded_element, info).map_err(js_error)
}

#[wasm_bindgen]
pub fn oprf_server_public_key(seed: &[u8], key_info: &[u8]) -> Result<Vec<u8>, JsValue> {
    server_public_key(seed, key_info).map_err(js_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: &str) -> Vec<u8> {
        let clean: String = value.chars().filter(|c| !c.is_whitespace()).collect();
        (0..clean.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&clean[index..index + 2], 16).unwrap())
            .collect()
    }

    // RFC 9497, Appendix A.1.3 (POPRF mode, ristretto255-SHA512).
    const SEED: &str = "a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3";
    const KEY_INFO: &str = "74657374206b6579";
    const PK: &str = "c647bef38497bc6ec077c22af65b696efa43bff3b4a1975a3e8e0a1c5a79d631";
    const INFO: &str = "7465737420696e666f";
    const VECTORS: [(&str, &str); 2] = [
        (
            "00",
            "ca688351e88afb1d841fde4401c79efebb2eb75e7998fa9737bd5a82a152406d\
             38bd29f680504e54fd4587eddcf2f37a2617ac2fbd2993f7bdf45442ace7d221",
        ),
        (
            "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
            "7c6557b276a137922a0bcfc2aa2b35dd78322bd500235eb6d6b6f91bc5b56a52\
             de2d65612d503236b321f5d0bebcbc52b64b92e426f29c9b8b69f52de98ae507",
        ),
    ];

    fn round_trip(seed: &[u8], key_info: &[u8], input: &[u8], info: &[u8]) -> Vec<u8> {
        let blind = client_blind(input).unwrap();
        let evaluation =
            server_evaluate(seed, key_info, &blind.blinded_element, info).unwrap();
        let public_key = server_public_key(seed, key_info).unwrap();
        client_finalize(
            blind.handle,
            input,
            &evaluation.evaluated_element,
            &evaluation.proof,
            &public_key,
            info,
        )
        .unwrap()
    }

    #[test]
    fn the_rfc_vectors_hold_through_the_blinded_protocol() {
        let seed = hex(SEED);
        let key_info = hex(KEY_INFO);
        assert_eq!(server_public_key(&seed, &key_info).unwrap(), hex(PK));
        for (input, output) in VECTORS {
            assert_eq!(round_trip(&seed, &key_info, &hex(input), &hex(INFO)), hex(output));
        }
    }

    #[test]
    fn another_info_or_key_gives_another_output() {
        let seed = hex(SEED);
        let key_info = hex(KEY_INFO);
        let input = b"device input";
        let base = round_trip(&seed, &key_info, input, b"wallet-a");
        assert_ne!(base, round_trip(&seed, &key_info, input, b"wallet-b"));
        assert_ne!(base, round_trip(&[7; 32], &key_info, input, b"wallet-a"));
        assert_eq!(base, round_trip(&seed, &key_info, input, b"wallet-a"));
    }

    #[test]
    fn an_evaluation_for_another_info_fails_the_proof() {
        let seed = hex(SEED);
        let key_info = hex(KEY_INFO);
        let input = b"device input";
        let blind = client_blind(input).unwrap();
        let evaluation =
            server_evaluate(&seed, &key_info, &blind.blinded_element, b"wallet-b").unwrap();
        let public_key = server_public_key(&seed, &key_info).unwrap();
        let finalized = client_finalize(
            blind.handle,
            input,
            &evaluation.evaluated_element,
            &evaluation.proof,
            &public_key,
            b"wallet-a",
        );
        assert!(finalized.is_err());
        assert!(!client_discard(blind.handle));
    }

    #[test]
    fn a_seed_that_is_not_32_bytes_is_refused() {
        assert!(server_from_seed(&[1; 16], b"key").is_err());
    }
}
