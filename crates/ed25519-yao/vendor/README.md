# CryProt code dependency for the ML-DSA prototype

Source: https://github.com/robinhundt/CryProt
Commit: `1e5cb7ac039cc72896f4c85572180c8d13c34d85`.
License: MIT. Each package retains its license and original source.

Only the core primitives and Expand-Convolute encoder are included.
Two upstream dead-code suppression attributes are removed to satisfy repository policy.
All functional source remains unchanged. Manifests resolve workspace fields locally,
disable publishing, and restrict CPU feature detection to its supported targets.
The unused code-package CPU detection dependency is removed.
These changes let the portable encoder compile for `wasm32-unknown-unknown`.
Network, PPRF, and OT packages are excluded. Our adapter uses the existing transport
and genuine base OT, with a fixed protocol width across native and Wasm targets.
