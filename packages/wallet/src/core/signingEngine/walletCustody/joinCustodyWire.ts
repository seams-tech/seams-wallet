/**
 * Turning a fetched custody envelope into the wire the ceremony joins with.
 *
 * Two things make this more than a rename.
 *
 * **`envelopeBinding` is a composite, not the record's `binding`.** It is
 * `{walletId, envelopeId, factor, envelopeRevision, binding}` — the values the
 * envelope was sealed against. Passing the inner binding alone would send a
 * wire that decrypts against the wrong AAD, and the failure would read as a
 * bad passkey rather than a bad projection.
 *
 * **The wasm side parses with `deny_unknown_fields`.** Handing it the stored
 * record, or a superset, fails at the boundary. So this projects exactly the
 * five fields `JoinCustodyWireV1` declares, and the test that pins the key set
 * is load-bearing rather than decorative.
 *
 * Lifecycle is checked here as well as on the server. The server gates what it
 * serves, but this also runs against the same-device continuity cache, and a
 * revoked envelope read from local storage must not open custody either.
 */

import {
  custodyEnvelopeOwnershipWireV1,
  parsePasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';

export type JoinCustodyWireResult =
  | { readonly ok: true; readonly custodyJson: string }
  | { readonly ok: false; readonly reason: string };

export function joinCustodyWireFromEnvelopeRecord(record: unknown): JoinCustodyWireResult {
  let envelope: ReturnType<typeof parsePasskeyCustodyEnvelopeRecord>;
  try {
    envelope = parsePasskeyCustodyEnvelopeRecord(record, 'custody envelope');
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'custody envelope is invalid',
    };
  }

  const state = envelope.lifecycle.state;
  if (state !== 'active') {
    /* Named rather than generic: "revoked" and "retired" mean different things
       to the person holding the device, and the caller decides which to say. */
    return { ok: false, reason: `custody envelope is ${state}` };
  }
  if (envelope.binding.kind !== 'wallet_custody_seed_v1') {
    return { ok: false, reason: 'generic custody wire rejects non-seed envelopes' };
  }

  return {
    ok: true,
    custodyJson: JSON.stringify({
      envelopeBinding: {
        walletId: envelope.walletId,
        envelopeId: envelope.envelopeId,
        factor: envelope.factor,
        envelopeRevision: envelope.envelopeRevision,
        binding: envelope.binding,
        ownership: custodyEnvelopeOwnershipWireV1(envelope.ownership),
      },
      nonceB64u: envelope.nonceB64u,
      sealedCustodySecretB64u: envelope.sealedCustodySecretB64u,
      aadHashB64u: envelope.aadHashB64u,
      ciphertextDigestB64u: envelope.ciphertextDigestB64u,
    }),
  };
}
