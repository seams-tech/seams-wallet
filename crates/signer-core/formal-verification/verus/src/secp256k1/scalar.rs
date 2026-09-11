//! Verus scalar-domain definitions used by the public-key helper proofs.

use vstd::prelude::*;

verus! {

pub type Bytes20 = [u8; 20];
pub type Bytes32 = [u8; 32];
pub type Bytes33 = [u8; 33];

pub open spec fn secp256k1_order_v1_spec() -> int {
    115792089237316195423570985008687907852837564279074904382605163141518161494337int
}

pub open spec fn secp256k1_scalar_width_bytes_v1_spec() -> nat {
    32nat
}

pub open spec fn secp256k1_compressed_public_key_width_bytes_v1_spec() -> nat {
    33nat
}

pub open spec fn ethereum_address_width_bytes_v1_spec() -> nat {
    20nat
}

pub uninterp spec fn bytes32_as_int_v1_spec(bytes: Bytes32) -> int;

pub open spec fn is_valid_nonzero_scalar_v1_spec(bytes: Bytes32) -> bool {
    0 < bytes32_as_int_v1_spec(bytes) < secp256k1_order_v1_spec()
}

pub uninterp spec fn compressed_public_key_from_scalar_v1_spec(scalar32: Bytes32) -> Bytes33;

pub uninterp spec fn ethereum_address_from_public_key_v1_spec(public_key33: Bytes33) -> Bytes20;

}
