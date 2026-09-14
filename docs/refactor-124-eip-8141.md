# EIP-8141 Frames implementation plan

**Status:** Planned devnet prototype. This plan does not enable Frames in the
SDK or commit to a production release.

**Research checked:** 2026-09-12.

## Decision and first milestone

Start implementation against a pinned Frames devnet. Keep production adoption
dependent on the target chain's activation, a stable specification, and review
of the account and SDK integration.

The first milestone is a reproducible demonstration:

1. Provision two existing Seams test-wallet MPC signers, A and B.
2. Deploy and fund a minimal contract account authorized by signer A.
3. Send a native-token transfer through a Frames transaction signed by A.
4. Replace the account's authorized signer with B through an A-authorized
   Frames transaction.
5. Confirm that B can transfer from the same account and A can no longer
   authorize a fresh transaction from it.

Use existing wallet provisioning to obtain independent test signers. This
milestone proves replacement of an account's authorized key. It makes no
change to client-share refresh, seed derivation, custody ceremonies, or the
recovery of a single wallet after an owner-root compromise.

## Readiness evidence

EIP-8141 is scheduled for inclusion in Hegotá. The upgrade's Sepolia, Hoodi,
and mainnet activation dates remain unset. A chain accepting ordinary EVM
transactions does not establish Frames support.
[Hegotá upgrade status](https://eips.ethereum.org/EIPS/eip-8081).

The September 4 execution-specs tracker targets `frames-devnet@v0.3.0` tests
against EIP revision `b75cbe6` from September 1. It lists no devnet launch date;
use it as a version reference, and verify the actual fixture release and
compatible client commits when implementation starts.
[Frames test release tracker](https://github.com/ethereum/execution-specs/issues/3532).

Nethermind reports matching execution results from Nethermind and ethrex on a
Frames devnet. This provides interoperability evidence for prototyping; Seams
must still reproduce its own account and signing flow.
[Cross-client devnet results](https://github.com/NethermindEth/frame-verify-gas/blob/main/DEVNET.md).

## Initial scope

- One explicitly selected devnet and one pinned protocol revision.
- An already deployed, non-upgradeable account with one replaceable signer.
- Native-token transfers and account signer replacement.
- Existing Seams threshold secp256k1 signing and confirmation infrastructure.
- Account-funded transaction fees. A test deployer pays deployment costs.
- Explicit submission, receipt interpretation, and account-state verification.

Keep the first entry point in a devnet harness. Add no production capability,
public SDK export, runtime fallback, or draft-version compatibility layer.
Replace the prototype's protocol assumptions directly when its pin changes.

Defer sponsorship, batching, token interactions, counterfactual deployment,
modular validators, ZK authorization, existing-EOA migration, and production
recovery. These can become separate milestones after the first demonstration.
Account deployment and initialization consume gas; this prototype makes no
claim of free account creation.

## Protocol details to implement from the pin

The current draft uses transaction type `0x06`, an RLP envelope, ordered frames,
and a signature list. `VERIFY` performs static validation with `APPROVE`;
`SENDER` executes with the account as caller. Execution and state gas have
separate limits. Receipts carry per-frame results without a transaction-level
status. Implement the selected revision's exact encoding, introspection,
approval, gas, and receipt rules.
[EIP-8141 specification](https://eips.ethereum.org/EIPS/eip-8141).

Use one protocol-validated secp256k1 signature with the authorized signer
explicitly identified and an empty message field, binding it to the canonical
transaction signing hash. Validation must check both metadata values; a valid
signature over a caller-chosen digest cannot authorize this transaction.

The draft encodes secp256k1 signatures as `v || r || s`; Seams currently passes
`r || s || v` internally. Adapt at the codec boundary and enforce the pin's
recovery-bit and low-s rules. Keep the signing digest and the hash of the
completed signed transaction as distinct values.
[Signature and hash definitions](https://eips.ethereum.org/EIPS/eip-8141#transaction-signatures).

## Repository integration

| Responsibility | Existing integration point | Planned change |
| --- | --- | --- |
| Transaction codec | `crates/signer-core/src/eip1559.rs` and its shared codec helpers | Add one Frames codec in signer-core, with independent reference vectors. |
| WASM boundary | `wasm/evm_crypto/src/` | Expose thin bindings to the signer-core implementation. |
| Worker transport | `packages/wallet/src/core/signingEngine/workerManager/workers/evm-crypto.worker.ts` | Add explicit Frames operations through the existing worker. |
| Intent and finalization | `packages/wallet/src/core/signingEngine/chains/evm/` | Add a Frames branch and derive confirmation from the exact transaction being signed. |
| Signing orchestration | `packages/wallet/src/core/signingEngine/flows/signEvmFamily/` | Reuse MPC authorization and signing while supplying the account's transaction identity. |
| Nonce ownership | `flows/signEvmFamily/nonceResolution.ts` and `nonce/` beneath the signing engine | Reuse the existing `chain_account` identity branch and nonce coordinator. |
| RPC | `packages/wallet/src/core/rpcClients/evm/` | Normalize the pinned client's submission and Frames receipt responses. |
| Prototype account | Proposed `tests/fixtures/evm-frames/FramesAccount.sol` | Hold the minimal account and its reproducible compiler settings. |
| Demonstration | Proposed `tests/scripts/run-evm-frames-devnet.mjs` | Orchestrate the transfer, rotation, rejection checks, and evidence capture. |

Choose the smallest necessary compiler/client tooling during the devnet setup.
Add one reproducible harness rather than a general deployment framework. Keep
account code in the fixture until production work establishes its maintained
contract location.

### Account identity and custody

The existing [EVM-family address invariant](threshold-ecdsa/evm-family-address-invariant.md)
defines a stable threshold-owner address across EVM-family targets and requires
raw EIP-1559 signing to use that owner for funding and nonce resolution.

Frames needs an explicit account binding containing the chain identity,
contract address, expected account code identity, and authorized Seams signer
identity. The account address supplies transaction sender, balance, and nonce.
The signer identity supplies the MPC key and authorization policy. Never write
the account address into the threshold-owner address field or derive another
owner key merely because the target chain changed.

The prototype displays both roles explicitly. Before public integration,
update the address-invariant document and intended-behaviour contracts to
define account funding alongside signer funding. Preserve the existing
raw EIP-1559 invariant.

### Domain and authorization boundaries

- Model the supported transaction families and operation states with exact
  discriminated unions. Require account binding and nonce before preparation
  can become signable; use branch-specific builders and exhaustive switches.
- Normalize RPC JSON, harness arguments, and worker responses at their
  boundaries. Keep raw strings and optional identity fields out of core logic.
- Define separate native-transfer and signer-replacement intents. Confirmation
  must show the selected account, chain, action, recipient or replacement
  signer, amount, and maximum fee commitment.
- Bind approval to the complete prepared transaction and current account
  authorization. Changes to any signed field require fresh authorization.
- Use typed results for unsupported chain, stale account authorization,
  admission rejection, uncertain submission, and execution failure. Diagnostic
  messages must never determine operation state.
- Add type fixtures for address-role confusion, invalid state combinations,
  direct object construction, and broad-spread escape hatches when introducing
  or changing shared domain types. Avoid domain casts.

## Delivery phases

### 0. Establish a reproducible devnet

- [ ] Select compatible execution-client and execution-specs commits. Record
  chain ID, genesis identity, activated fork, compiler version, fixture version,
  RPC behavior, and the exact commands in this document.
- [ ] Prove a minimal Frames transaction is admitted and included using the
  client's default public-mempool rules.
- [ ] Capture any mismatch between the selected client and the current EIP.
  Resolve it by choosing a consistent pin before writing the Seams codec.

**Exit:** A clean setup can reproduce a supported transaction. Modified gas
admission limits or a private submission route must be explicitly recorded;
they do not satisfy the default-admission exit condition.

### 1. Implement the codec and minimal account

- [ ] Add canonical encoding, signing-hash construction, signature adaptation,
  final serialization, and signed-transaction hash calculation in signer-core.
- [ ] Verify bytes and hashes against the pinned execution-specs fixtures or
  an independent client implementation. Cover integer boundaries, malformed
  signatures, and changes to signed fields.
- [ ] Deploy the account with signer A initialized atomically. Keep its code
  fixed, its authorized signer replaceable, and its payable receive path simple.
- [ ] Restrict validation to the intended Frames context. Check the selected
  signature, current authorized signer, and canonical-message binding before
  approving account execution and payment.
- [ ] Permit signer replacement only through an authorized account self-call.
  Reject an empty replacement signer and unauthorized direct calls. Keep
  replacement as a standalone operation and emit the old and new signer.
- [ ] Test deployment initialization and rejected takeover attempts before
  connecting the account to Seams signing.

**Exit:** Independently verified codec vectors and an account whose transfer
and signer-replacement authorization are exercised on the pinned client.

### 2. Connect Seams signing and submission

- [ ] Add the worker operations and typed Frames intent/finalization branch.
  Keep private shares inside the existing custody and signing boundaries.
- [ ] Resolve the account binding from trusted setup data, verify deployed code
  and authorized signer on-chain, and reserve the account's nonce.
- [ ] Build and confirm a native transfer, sign it with MPC signer A, verify
  the resulting signature locally, and submit the final bytes.
- [ ] Normalize admission results and per-frame receipts. Determine success
  from the required action's outcome and corroborating account/recipient state.
- [ ] Reconcile an uncertain broadcast using the signed-transaction hash and
  account nonce before retrying. Rebroadcast identical bytes; a changed
  transaction needs fresh authorization.
- [ ] Record deployment gas separately from transfer gas and record signing
  latency separately from inclusion latency.

**Exit:** A Seams-authorized native transfer succeeds through the devnet's
default admission path, with independently checked balances and nonce.

### 3. Prove signer replacement

- [ ] Verify signer B is usable through its existing test-wallet MPC flow.
- [ ] Use signer A to authorize replacement with B and await the configured
  confirmation policy before accepting the new account binding locally.
- [ ] Read the confirmed authorized signer and invalidate pending local
  approvals made against the retired binding.
- [ ] Submit a B-authorized transfer from the unchanged account address.
- [ ] Attempt an A-authorized transfer with a fresh, otherwise valid nonce and
  valid cryptographic signature. Demonstrate rejection because A is retired;
  rejection solely for nonce reuse does not prove key replacement.
- [ ] Exercise failed replacement, an uncertain submission, and reconciliation
  after a devnet reorg without reporting an unconfirmed signer as active.

**Exit:** The same funded account accepts B and rejects A. Preserve transaction
hashes, relevant receipts, account storage reads, and client rejection evidence.

### 4. Decide on product integration

- [ ] Review the prototype's measured results and spec drift before widening
  the account, API, or network scope.
- [ ] Design replacement-key custody and recovery for one user: provisioning,
  authenticated account bindings, recovery material, linked devices, session
  retirement, and export semantics. Restoring A's seed must never be presented
  as restoring authority over an account now controlled by B.
- [ ] Specify discovery and verification of account bindings on a fresh device.
  A stored address or stale recovery record cannot establish current authority.
- [ ] Update `docs/intended-behaviours.md` and matching contracts with any new
  public lifecycle behavior in the same implementation change.
- [ ] Establish the production contract location and public account API only
  after the security and activation requirements below are met.

## Verification requirements

Keep TypeScript checks in the top-level `tests/` workspace and Rust vectors
under `crates/signer-core/tests/`. Regenerate WASM and bindings through existing
build commands when their sources change. Do not hand-edit generated outputs.

| Concern | Required evidence |
| --- | --- |
| Codec correctness | Independent agreement on unsigned signing digest, final bytes, and signed-transaction hash. |
| Authorization binding | Altered recipient, amount, fee, frame order, signer metadata, or network cannot reuse approval. |
| Address separation | Account nonce/balance never silently resolve to the MPC signer's address. |
| Replay and replacement | Replayed transactions fail; signer A also fails with a fresh nonce after confirmed replacement. |
| Result interpretation | Admission, inclusion, execution failure, and confirmed success remain distinct. |
| Rotation lifecycle | Failure, ambiguous broadcast, and reorg preserve an accurate account binding. |
| Existing behavior | Focused EIP-1559 and identity coverage passes; shared public lifecycle changes also pass intended-behaviour contracts. |

Start with the relevant Rust vector test, targeted tests through
`pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts unit/<test-file>`, and
`pnpm -C tests type-check:wallet-state`. Broaden to `pnpm type-check` and
`pnpm test:intended` when shared signing, custody, persistence, or public APIs
change. Add each new test file to the appropriate existing runner or TypeScript
configuration; file creation alone does not establish coverage.

## Follow-on work and production requirements

### ZK authorization

Evaluate ZK after the transfer-and-replacement milestone. Nethermind's published
Groth16 example requires roughly 194,000 gas to verify, exceeding the current
100,000-gas public-mempool validation bound. Executing that proof in an ordinary
execution frame establishes a different capability from admitting it as
transaction authorization.
[Verifier measurements](https://github.com/NethermindEth/frame-verify-gas/blob/main/DEVNET.md).

A later proof design must establish witness custody, transaction binding,
verification cost, accepted submission path, and its precise privacy claim.
Hiding an authorization witness alone does not hide account transfers. Keep
proof-system selection and privacy-protocol design outside this prototype.

### Existing EOAs and deployment costs

Migration of a funded EOA needs separate evidence that its original key loses
all intended authority. Track the proposed EIP-8298 code-adoption path and
EIP-8151 restrictions on `ecRecover`, including applications that verify ECDSA
independently. Neither proposal is a prerequisite for this newly deployed
account prototype.
[EIP-8298](https://eips.ethereum.org/EIPS/eip-8298),
[EIP-8151](https://eips.ethereum.org/EIPS/eip-8151).

Measure sponsorship, deferred deployment, and shared-code economics only after
the basic account works. Any product claim about user-paid gas must identify
who pays deployment, initialization, and subsequent execution costs.

### Production release requirements

- Confirm activation and supported RPC behavior on each target chain.
- Rebase and rerun the prototype against the final supported protocol revision.
- Complete independent review of the account, codec, authorization binding,
  recovery, and nonce/receipt lifecycle.
- Demonstrate the replacement signer can be recovered and used from a fresh
  supported device without restoring retired authority.
- Complete account funding, confirmation, support, and failure UX with matching
  intended-behaviour contracts.
- Publish measured operating costs and the maintained deployment procedure.

Production release remains unscheduled. The immediate deliverable is the
reproducible devnet transfer-and-signer-replacement demonstration.
