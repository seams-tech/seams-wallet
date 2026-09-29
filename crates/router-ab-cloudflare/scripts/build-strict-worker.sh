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
worker_rustflags=""
case "$worker_build_profile" in
  dev)
    worker_output="build/dev/$role"
    worker_build_flags=(--dev --no-opt)
    worker_rustflags="${RUSTFLAGS:-}"
    if [[ -n "$worker_rustflags" ]]; then
      worker_rustflags+=" "
    fi
    worker_rustflags+="-C link-arg=-zstack-size=4194304"
    ;;
  release)
    worker_output="build/$role"
    if [[ "${ROUTER_AB_WALLET_DO_HARNESS:-}" == "enabled" && "$role" != "tenant-root-control-plane" ]]; then
      worker_output="build/wallet-do/$role"
    fi
    worker_build_flags=(--release)
    ;;
  *)
    echo "invalid ROUTER_AB_WORKER_BUILD_PROFILE: $worker_build_profile (expected dev or release)" >&2
    exit 2
    ;;
esac

run_worker_build() {
  if [[ "$worker_build_profile" == "dev" ]]; then
    RUSTFLAGS="$worker_rustflags" worker-build "$@"
  else
    worker-build "$@"
  fi
}

worker_features="strict-worker-$role-entrypoint"
if [[ "$role" == "deriver-a" && "${ROUTER_AB_WALLET_DO_HARNESS:-}" == "enabled" ]]; then
  worker_features+=",wallet-do-harness"
fi
if [[ "$role" == "router" && "${ROUTER_AB_WALLET_DO_HARNESS:-}" == "enabled" ]]; then
  worker_features+=",wallet-do-router-harness"
fi
if [[ "$role" == "deriver-b" && "${ROUTER_AB_WALLET_DO_HARNESS:-}" == "enabled" ]]; then
  worker_features+=",wallet-do-b-harness,wallet-do-b-completion-harness"
fi
if [[ "$role" == "signing-worker" && "${ROUTER_AB_WALLET_DO_HARNESS:-}" == "enabled" ]]; then
  worker_features+=",wallet-do-signing-worker-harness"
fi
# Local only: a dev D1 SigningWorker can hold a NEAR finalize between signing
# and committing, for the intended suite. The wallet object signs and commits
# in one step, so it has no such hold, and no release build has it.
if [[ "$worker_build_profile" == "dev" && "$role" == "signing-worker" \
  && "${ROUTER_AB_WALLET_DO_HARNESS:-}" != "enabled" ]]; then
  worker_features+=",local-intended-signing-hold"
fi
# Local only: a dev Router can end a registration burned when the local
# Gateway's terminal-failure fault asks, and records it like any answer.
if [[ "$worker_build_profile" == "dev" && "$role" == "router" ]]; then
  worker_features+=",local-intended-router-burn"
fi
# Local only: a dev Deriver B can run its start-acceptance clock ahead, so the
# skew E2E can check Deriver A's bound for B's timestamps.
if [[ "$worker_build_profile" == "dev" && "$role" == "deriver-b" ]]; then
  worker_features+=",local-intended-yao-clock-skew"
fi

wallet_objects=false
if [[ "${ROUTER_AB_WALLET_DO_HARNESS:-}" == "enabled" && "$role" != "tenant-root-control-plane" ]]; then
  wallet_objects=true
fi
# Whole seconds, rounded down: a source saved in the build's first second
# counts as newer, so the harness errs toward rebuilding.
started_at_ms="$(( $(date +%s) * 1000 ))"

run_worker_build \
  "${worker_build_flags[@]}" \
  --out-dir "$worker_output" \
  --features "$worker_features"

# What the private harness checks before it loads this build: its profile,
# whether it is the wallet-object variant, and when it started, which must
# follow every change to the sources it compiled. It sits beside `worker/`,
# so a deployment does not upload it.
printf '{"profile":"%s","wallet_objects":%s,"features":"%s","started_at_ms":%s}\n' \
  "$worker_build_profile" "$wallet_objects" "$worker_features" "$started_at_ms" \
  > "$worker_output/build-stamp.json"
