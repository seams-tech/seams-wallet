# Spec 1: Runtime and platform boundaries

Wallet runs partly in the user's client and partly on a server. The client
handles interaction and client cryptography. The server checks permissions,
stores shared state, and participates in signing.

## From an application to a signature

An application calls the Wallet SDK when it needs to open a wallet or request a
signature. The SDK coordinates the Wallet UI and client cryptography. The
Gateway, the public entry point to the Wallet server, checks whether the request
is allowed.

The client then works with the server's signing services to produce the
signature. Submission to a blockchain is a separate step from producing it.
[Spec 3](spec-3-wallet-sessions-and-execution-lanes.md) explains signing
permission, and [Spec 5](spec-5-router-ab-threshold-protocol.md) explains the
server roles.

Wallet authentication screens run in Wallet-owned documents. The application
controls when to open them and receives their results through the SDK.

## TypeScript and Rust

TypeScript coordinates user flows, permissions, storage, and network requests.
Rust implements cryptography and operates on secret material. In the browser,
Rust runs through WebAssembly.

The boundary between them carries public information, typed commands, and
encrypted material. JavaScript does not inspect Rust's internal secrets. Rust
defines the cryptographic command formats, including the encodings shared with
TypeScript.

Domain types describe valid states explicitly. Input from a request, database,
provider, or worker is checked when it enters the system. The rest of the code
uses that checked representation.

## Connecting to the environment

Wallet logic uses interfaces for storage, authentication, and transport.
Adapters implement those interfaces for IndexedDB, server databases, WebAuthn,
and external providers. This keeps application flows independent of a particular
browser or hosting platform.

Applications assemble the adapters and supply trusted configuration. Native and
embedded clients follow the same contracts and explicitly report any unsupported
capabilities.

The same separation applies to packaging. Published packages include the code
and assets required to run, without depending on source files from the repository.
Hosted Wallet documents remain separate bundles even when served together.

## Finding the code

The [client package](../packages/wallet/src),
[server package](../packages/wallet-server/src), and
[Rust cryptographic core](../crates/signer-core/src) are the main starting points.

The public repository also contains the hosted Wallet UI, examples, and recovery
CLI. The private Seams repository contains production Console composition and
deployment configuration.

Continue with [authentication and custody](spec-2-auth-custody-and-credentials.md).
