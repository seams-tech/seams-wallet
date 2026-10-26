# Optional VoiceID package — 2026-10-27

VoiceID is now owned by `@seams/voiceid`. Its implementation, models, worklet,
inference runtime, and voice visuals are absent from `@seams/wallet`.
The Wallet retains the authentication contract, storage ownership, custody,
session installation, signing, and the versioned trusted-host API.
Enrollment deletion stays at the Wallet persistence boundary so revocation can
remove local samples without loading the optional package.

The descriptor is imported from `@seams/voiceid`. React voice visuals are imported
from `@seams/voiceid/react`, with card CSS from `@seams/voiceid/styles`.
The former Wallet re-exports are removed.

## Two explicit installation steps

The app installs the optional package and enables its descriptor. The Wallet host
operator separately composes the package's assets into a new deployment directory.
The hosting helper extends the existing asset manifest and preserves its source
asset trees. It does not discover packages automatically or modify the base build.

The core loader checks configuration before importing the fixed same-origin
`/sdk/voiceid/host.js` URL. Both packages check host API version 1. Missing or
incompatible installations fail explicitly. The app cannot select executable URLs.
Enabling the descriptor alone does not load the plugin. Loading the plugin shell
does not download models. Inference downloads begin during a VoiceID action.

The plugin uses the Wallet host's exported helpers and instances. It does not bundle
a second Wallet runtime. Browser storage names, model hashes, worker responsibilities,
and the 0.5 speaker threshold are unchanged. The engine asset now lives under
`/sdk/voiceid/`; the three model URLs retain their existing paths.

## Reproducible package assets

The three exported model binaries were previously local ignored files. They are now
tracked release assets in the optional package (12,529,501 bytes total), with their
existing provenance and licenses. The build requires all three files. ONNX Runtime
is copied from its pinned dependency. A clean checkout can build the same package.
Model [hashes and package boundaries](package-boundary.json) are recorded here.

The packed-package check verifies that Wallet has no VoiceID, ONNX Runtime, or
voice-glow dependency and contains no model or inference-engine files. It imports
the packed VoiceID descriptor and React entry, then composes assets from the packed
packages. The original Wallet asset tree remains without a VoiceID directory.

## Validation

The [plugin loading record](plugin-loading.json) shows that enabling the descriptor
does not load code. A separate browser case rejects absent and incompatible plugin
installations. The three-browser loading journey verifies cold download, retry,
real inference, and cache behavior from the new asset location.

The production composed-wallet journeys cover Email OTP without voice downloads,
first-passkey addition, ES256/RS256 enrollment management, VoiceID unlock, Arc
signing for both signer setups, NEAR signing, and the manual demo. They use local
Workers, virtual passkeys, deterministic audio, and deterministic chain RPC responses.
They do not establish a new live-chain transfer or human-speech acceptance result.

See [test results](results.json). Package builds, packed consumers, workspace types,
bundle analysis, documentation and example builds, and the bloat check also passed.
Raw logs and browser artifacts are retained at `/private/tmp/voiceid-split-20261027`.
Raw service logs are excluded because they can contain test authentication credentials.

## Release and integration

See the [package README](../../../packages/voiceid/README.md) for app imports and
the explicit `seams-voiceid-host` deployment command.

This change targets 0.24.0. The new package declares that version and requires Wallet
0.24.0. The existing Wallet and server manifests remain at 0.23.0 until the release
version bump. The release workflow requires all three versions to match before
publishing. It publishes VoiceID after Wallet and supports a VoiceID-only retry.
No package was published and no hosted deployment was changed by this task.
