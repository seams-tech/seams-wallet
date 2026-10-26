# Meteor browser acceptance — 2026-10-26

The direct adapter connected `cyan-loong.testnet`, submitted a zero-deposit
`set_greeting` call, and verified final execution and exact readback.
See [machine-readable evidence](refactor-185-meteor-testnet-20261026.json).

## Facts

| Fact | Instrument | Result |
| --- | --- | --- |
| Meteor was installed and unlocked. | User screenshot and Chrome accessibility state | Account `cyan-loong.testnet`, extension build `261022-1955`. |
| Initial page detection sampled too early. | Local acceptance page, initial load versus explicit refresh | Both Meteor globals changed from absent to present. |
| The SDK failed before approval. | Local adapter diagnostic and Vite stack | `safe-buffer` accessed an externalized Node `buffer` module. |
| Package validation failed with the SDK dependency. | `pnpm license:notices` | Several SDK dependencies had no license field. |
| The direct transport can connect. | Real extension prompt and correlated terminal reply | `closed_success` returned the selected testnet account. |
| Reconnect is part of the protocol. | Local status-only diagnostics and SDK protocol reference | Received `attempting_reconnect` and `connected` replies. |
| Diagnostic approval windows overlapped. | Chrome Window menu and each request's URL | Three windows belonged to earlier local acceptance requests. |
| A clean request reached signing review. | Real extension review | Correct signer, receiver, method, greeting, gas, and zero deposit. |
| Execution succeeded on chain. | Wallet response and independent NEAR RPC | Final success, transaction identity match, exact readback. |

## Causes assessed

| Candidate | Evidence | Assessment |
| --- | --- | --- |
| Meteor was absent | User screenshot and live globals | Rejected. |
| Loopback IP alone prevented injection | Both IP and localhost were checked; delayed refresh succeeded | Insufficient as an explanation. |
| Initial detection label was stale | Initial versus refreshed UI | Confirmed for the label, not the SDK exception. |
| Browser-incompatible SDK dependency | Stack identified `safe-buffer` and externalized `buffer` | Confirmed for the pre-approval exception. |
| Missing reconnect handling | Protocol reference and real status messages | Confirmed implementation gap. |
| Stale replies canceled another request | Adapter canceled unmatched IDs; SDK dispatch ignores them | Fixed isolation gap. Not isolated as the sole cause of the failed signing attempt. |
| Overlapping approval windows disturbed the handshake | Three old windows; clean request succeeded after cleanup and fixes | Plausible contributor; individual causal effect is unproven. |
| Invalid transaction encoding | Real wallet decoded the requested call and execution succeeded | Rejected for the verified request. |

An independent read-only review confirmed the SDK transport checks, missing license
metadata, reconnect behavior, and stale-ID handling. The reviewer did not operate
Chrome or edit files.

The SDK dependency was removed. The direct adapter has no parent-frame discovery
path, no on-chain key grant, and no Node Buffer dependency. Temporary diagnostics
were removed after the real run. Six controlled browser cases pass, including
handshake replay, stale IDs, popup source binding, and disconnect cleanup.

The controlled tests do not establish real HOT or Intear compatibility. The run
also does not establish an EVM extension or threshold-wallet composition result.
