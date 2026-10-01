#[cfg(feature = "secp256k1")]
#[path = "../fixtures/signing-vectors/v1_test_vectors.rs"]
mod vectors;

#[cfg(feature = "secp256k1")]
use vectors::*;

#[cfg(feature = "secp256k1")]
#[test]
fn vectors_v1_match_expected_outputs() {
    assert!(VECTORS_JSON.contains("\"version\": \"v1\""));
    assert!(VECTORS_JSON.contains(HEX_EXPECTED));

    assert_eq!(
        to_hex(
            signer_core::codec::hex_to_bytes(HEX_INPUT)
                .expect("hex_to_bytes")
                .as_slice()
        ),
        HEX_EXPECTED
    );
    assert_eq!(
        to_hex(
            signer_core::codec::u256_bytes_be_from_dec(U256_INPUT)
                .expect("u256")
                .as_slice()
        ),
        U256_EXPECTED
    );
    let strip_input = from_hex(STRIP_INPUT_HEX);
    assert_eq!(
        to_hex(signer_core::codec::strip_leading_zeros_slice(
            strip_input.as_slice()
        )),
        STRIP_EXPECTED
    );
    assert_eq!(
        to_hex(
            signer_core::codec::rlp_encode_bytes(from_hex(RLP_BYTES_INPUT_HEX).as_slice())
                .as_slice()
        ),
        RLP_BYTES_EXPECTED
    );
    let rlp_items = vec![from_hex(RLP_LIST_ITEM_0_HEX), from_hex(RLP_LIST_ITEM_1_HEX)];
    assert_eq!(
        to_hex(signer_core::codec::rlp_encode_list(rlp_items.as_slice()).as_slice()),
        RLP_LIST_EXPECTED
    );

    assert_eq!(
        to_hex(
            signer_core::secp256k1::validate_secp256k1_public_key_33(
                from_hex(VALIDATE_PK_HEX).as_slice(),
            )
            .expect("validate pk")
            .as_slice()
        ),
        VALIDATE_PK_HEX
    );

    assert_eq!(
        to_hex(
            signer_core::secp256k1::add_secp256k1_public_keys_33(
                from_hex(VALIDATE_PK_HEX).as_slice(),
                from_hex(ADD_RIGHT_PK_HEX).as_slice(),
            )
            .expect("add pks")
            .as_slice()
        ),
        ADD_EXPECTED
    );
}
