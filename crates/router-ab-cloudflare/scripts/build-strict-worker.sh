#!/usr/bin/env bash

set -euo pipefail

role="${1:-}"
case "$role" in
  router|deriver-a|deriver-b|signing-worker|tenant-root-control-plane) ;;
  *)
    echo "usage: build-strict-worker.sh <router|deriver-a|deriver-b|signing-worker|tenant-root-control-plane>" >&2
    exit 2
    ;;
esac

worker_build_profile="${ROUTER_AB_WORKER_BUILD_PROFILE:-release}"
# Target features of every release Worker. With WebAssembly SIMD the compiler
# vectorizes the label, block and buffer arithmetic of the Yao roles; no source
# line names a vector instruction. The constant-time codegen gate in
# crates/ed25519-yao/scripts/check_constant_time_codegen.mjs reads this line
# and inspects modules built with the same features.
worker_release_target_features="+simd128"
worker_rustflags="${RUSTFLAGS:-}"
if [[ -n "$worker_rustflags" ]]; then
  worker_rustflags+=" "
fi
case "$worker_build_profile" in
  dev)
    worker_output="build/dev/$role"
    worker_build_flags=(--dev --no-opt)
    worker_rustflags+="-C link-arg=-zstack-size=4194304"
    ;;
  release)
    worker_output="build/$role"
    worker_build_flags=(--release)
    worker_rustflags+="-C target-feature=$worker_release_target_features"
    ;;
  *)
    echo "invalid ROUTER_AB_WORKER_BUILD_PROFILE: $worker_build_profile (expected dev or release)" >&2
    exit 2
    ;;
esac

run_worker_build() {
  RUSTFLAGS="$worker_rustflags" worker-build "$@"
}

worker_features="strict-worker-$role-entrypoint"
# Local only: a dev Router can end a registration burned when the local
# Gateway's terminal-failure fault asks, and records it like any answer.
if [[ "$worker_build_profile" == "dev" && "$role" == "router" ]]; then
  worker_features+=",local-intended-router-burn"
fi
# Local only: a dev Deriver B can burn a pair before completion to exercise
# the completion fence.
if [[ "$worker_build_profile" == "dev" && "$role" == "deriver-b" ]]; then
  worker_features+=",wallet-do-b-completion-harness"
fi

wallet_objects=false
if [[ "$role" != "tenant-root-control-plane" ]]; then
  wallet_objects=true
fi
# Use the same millisecond precision as the harness filesystem timestamps.
# Rounding to seconds incorrectly rejects sources saved just before this build.
started_at_ms="$(node -p 'Date.now()')"

run_worker_build \
  "${worker_build_flags[@]}" \
  --out-dir "$worker_output" \
  --features "$worker_features"

# worker-build retains the names section even in release mode. Remove that
# debug metadata after its final rewrite; keep development stack traces intact.
if [[ "$worker_build_profile" == "release" ]]; then
  node ./scripts/strip-wasm-debug.mjs "$worker_output/index_bg.wasm"
fi

# What the private harness checks before it loads this build: its profile,
# whether it is the wallet-object variant, and when it started, which must
# follow every change to the sources it compiled. It sits beside `worker/`,
# so a deployment does not upload it.
printf '{"profile":"%s","wallet_objects":%s,"features":"%s","started_at_ms":%s}\n' \
  "$worker_build_profile" "$wallet_objects" "$worker_features" "$started_at_ms" \
  > "$worker_output/build-stamp.json"
