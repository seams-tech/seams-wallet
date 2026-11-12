#!/usr/bin/env bash
# The Rust outputs that Validate wallet builds once per run, caches, and hands to its
# test jobs as one archive: the WASM packages, the Ed25519 Yao client package, the five
# release Workers and the Linux local tool. Release wallet packages ships the Workers and
# the local tool of the Validate run for the released commit.
#
#   bash scripts/rust-build-outputs.sh build                     build every output from source
#   bash scripts/rust-build-outputs.sh pack <archive>            write every output to a .tgz
#   bash scripts/rust-build-outputs.sh check <archive>           require every Worker file and the tool
#   bash scripts/rust-build-outputs.sh unpack <archive>          restore every output
#   bash scripts/rust-build-outputs.sh unpack-workers <archive>  restore the Workers and local tools
#
# scripts/rust-build-inputs.mjs hashes this file, so a change here changes the cache key.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

worker_build=crates/router-ab-cloudflare/build
worker_roles=(signing-worker deriver-a deriver-b router tenant-root-control-plane)
local_tool="$worker_build/local-tools/linux-x64/router_ab_local_init"

worker_paths=()
for role in "${worker_roles[@]}"; do worker_paths+=("$worker_build/$role"); done
worker_paths+=("$worker_build/local-tools")

usage() {
  echo "usage: rust-build-outputs.sh <build | pack|check|unpack|unpack-workers <archive>>" >&2
  exit 2
}

build_outputs() {
  pnpm run build:wasm
  pnpm run build:workers
  pnpm run build:local-tools
}

check_archive() {
  local archive="$1" listing entry missing=0
  listing="$(tar -tzf "$archive")"
  for role in "${worker_roles[@]}"; do
    for entry in index.js index_bg.wasm build-stamp.json; do
      if ! grep -qxF "$worker_build/$role/$entry" <<<"$listing"; then
        echo "$archive has no $worker_build/$role/$entry" >&2
        missing=1
      fi
    done
  done
  if ! grep -qxF "$local_tool" <<<"$listing"; then
    echo "$archive has no $local_tool" >&2
    missing=1
  fi
  return "$missing"
}

pack_outputs() {
  local archive="$1"
  mkdir -p "$(dirname "$archive")"
  tar -czf "$archive" wasm/*/pkg crates/router-ab-ed25519-yao-client/pkg "${worker_paths[@]}"
  check_archive "$archive"
}

unpack_outputs() {
  local archive="$1"
  check_archive "$archive"
  tar -xzf "$archive"
  test -x "$local_tool"
  # The Worker freshness guards (`requireCurrentWorkerBuild` in
  # crates/router-ab-cloudflare/scripts/test-private-d1.mjs) compare each build stamp with
  # source file times. A checkout gives every source the current time, so an unpacked build
  # would read as stale. The cache key proves that these sources equal the ones that made
  # the build, so give the tracked Rust sources a time before any build stamp.
  git ls-files -z -- crates wasm | TZ=UTC xargs -0 touch -h -t 197001010000.01
}

unpack_workers() {
  local archive="$1"
  check_archive "$archive"
  tar -xzf "$archive" "${worker_paths[@]}"
  test -x "$local_tool"
}

case "${1:-}" in
  build)
    [[ $# -eq 1 ]] || usage
    build_outputs
    ;;
  pack | check | unpack | unpack-workers)
    [[ $# -eq 2 ]] || usage
    case "$1" in
      pack) pack_outputs "$2" ;;
      check) check_archive "$2" ;;
      unpack) unpack_outputs "$2" ;;
      unpack-workers) unpack_workers "$2" ;;
    esac
    ;;
  *) usage ;;
esac
