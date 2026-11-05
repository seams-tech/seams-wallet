#!/bin/bash

# Install upstream prebuilt wasm-bindgen CLIs (and optionally wasm-pack) with
# pinned SHA-256 digests, so CI does not compile them from source.
#
# wasm-bindgen: one CLI per version that the SDK WASM crates lock. Each goes to
# the workspace-local toolchain root (packages/wallet/.tooling/wasm-bindgen/
# <version>/bin), which wasm-toolchain.sh checks before any cargo install. Run
# this before build-wasm.sh starts its parallel jobs.
#
# A version or platform without a pin is skipped with a warning; the build then
# compiles that CLI from source, as before. To add a pin, take the digest from
# the upstream release's .sha256sum file and check it against a local download.
#
# Usage: install-prebuilt-wasm-tools.sh [--wasm-pack-dir DIR]
#   --wasm-pack-dir DIR  also install wasm-pack ${WASM_PACK_VERSION} into DIR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SDK_ROOT/build-paths.sh"
source "$SCRIPT_DIR/wasm-toolchain.sh"

WASM_PACK_VERSION="0.15.1"

wasm_pack_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --wasm-pack-dir)
      wasm_pack_dir="${2:?--wasm-pack-dir needs a directory}"
      shift 2
      ;;
    *)
      echo "usage: install-prebuilt-wasm-tools.sh [--wasm-pack-dir DIR]" >&2
      exit 2
      ;;
  esac
done

warn() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::warning::$1"
  else
    echo "⚠️ $1" >&2
  fi
}

host_target() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "x86_64-unknown-linux-musl" ;;
    Darwin-arm64) echo "aarch64-apple-darwin" ;;
    *) echo "" ;;
  esac
}

# Digests of the upstream release tarballs, checked against each release's
# published .sha256sum file on 2026-11-06.
wasm_bindgen_sha256() {
  case "$1-$2" in
    0.2.100-x86_64-unknown-linux-musl) echo "63d6a38deb65bd7023c02bdf382ab66b0d2c0241c8582fd3413b5a808b8aeb5b" ;;
    0.2.100-aarch64-apple-darwin) echo "69f25cb910de7e19777b3f93347f5e62a64c8f81709b41ba7242d00a9543573c" ;;
    0.2.108-x86_64-unknown-linux-musl) echo "d15d7e476feec78d0ec9edc27b8f77279ec7a3e6227756e7036e5cd2066800f4" ;;
    0.2.108-aarch64-apple-darwin) echo "3903c81dc8943592dfd9d98c8c21c9a05f8265aa6b0014f641a8457cec4925dd" ;;
    0.2.113-x86_64-unknown-linux-musl) echo "0366bf5936d5e2578b06fc318a5696ddecfb66382e671e51f469b83f3494712f" ;;
    0.2.113-aarch64-apple-darwin) echo "018f748511712765e1e7d0da780b5fa4b075566a6586c78630ee659808423afd" ;;
    0.2.118-x86_64-unknown-linux-musl) echo "00b519c9fc2d6e087265da1a00f29160bfcc6a823993482bc2e691910287427b" ;;
    0.2.118-aarch64-apple-darwin) echo "f76553ae8d084dc3e96a7cef748813bf2dac4d78326166409328fc74646eef76" ;;
    *) echo "" ;;
  esac
}

wasm_pack_sha256() {
  case "$1-$2" in
    0.15.1-x86_64-unknown-linux-musl) echo "410101009739b9d01c7d5affaaad6e9c9a24b4cba6791a4805db8e89b9bf7af2" ;;
    0.15.1-aarch64-apple-darwin) echo "bcaf2a418ae39c874b072ea122fec58e11970862cbd8fd4eca2f00a17f76c536" ;;
    *) echo "" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# download_verified_tarball URL SHA256 DEST_DIR: extract the tarball's single
# top-level directory into DEST_DIR after the digest matches.
download_verified_tarball() {
  local url="$1" expected="$2" dest="$3"
  local work actual
  work="$(mktemp -d)"
  curl -fsSL --retry 3 --retry-delay 2 -o "$work/tool.tar.gz" "$url"
  actual="$(sha256_of "$work/tool.tar.gz")"
  if [ "$actual" != "$expected" ]; then
    rm -rf "$work"
    echo "❌ SHA-256 mismatch for $url" >&2
    echo "   expected $expected" >&2
    echo "   actual   $actual" >&2
    return 1
  fi
  mkdir -p "$work/extract" "$dest"
  tar -xzf "$work/tool.tar.gz" -C "$work/extract" --strip-components=1
  find "$work/extract" -maxdepth 1 -type f -perm -u+x -exec cp {} "$dest"/ \;
  rm -rf "$work"
}

target="$(host_target)"
if [ -z "$target" ]; then
  warn "No prebuilt WASM tools for $(uname -s)-$(uname -m); the build compiles them from source."
  exit 0
fi

toolchain_root="$(wasm_bindgen_toolchain_root)"
installed_versions=" "
for source_dir in \
  "$SOURCE_WASM_SIGNER" \
  "$SOURCE_ED25519_YAO_CLIENT" \
  "$SOURCE_WASM_ECDSA_CLIENT" \
  "$SOURCE_WASM_EVM_CRYPTO" \
  "$SOURCE_WASM_TEMPO_SIGNER" \
  "$SOURCE_WASM_SHAMIR3PASS_RUNTIME" \
  "$SOURCE_WASM_EMAIL_OTP_RUNTIME" \
  "$SOURCE_WASM_WALLET_CUSTODY_CEREMONY"; do
  version="$(resolve_wasm_bindgen_cli_version_from_lockfile "$SDK_ROOT/$source_dir/Cargo.lock")"
  case "$installed_versions" in *" $version "*) continue ;; esac
  installed_versions="$installed_versions$version "

  bin_dir="$toolchain_root/$version/bin"
  if [ -x "$bin_dir/wasm-bindgen" ] &&
    [ "$("$bin_dir/wasm-bindgen" --version 2>/dev/null | awk '{print $2}')" = "$version" ]; then
    echo "[prebuilt-wasm-tools] wasm-bindgen $version already in $bin_dir"
    continue
  fi
  digest="$(wasm_bindgen_sha256 "$version" "$target")"
  if [ -z "$digest" ]; then
    warn "wasm-bindgen $version ($target) has no pinned digest in install-prebuilt-wasm-tools.sh; the build compiles it from source."
    continue
  fi
  download_verified_tarball \
    "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/wasm-bindgen-$version-$target.tar.gz" \
    "$digest" "$bin_dir"
  echo "[prebuilt-wasm-tools] installed wasm-bindgen $version into $bin_dir"
done

if [ -n "$wasm_pack_dir" ]; then
  digest="$(wasm_pack_sha256 "$WASM_PACK_VERSION" "$target")"
  if [ -z "$digest" ]; then
    echo "❌ wasm-pack $WASM_PACK_VERSION ($target) has no pinned digest" >&2
    exit 1
  fi
  download_verified_tarball \
    "https://github.com/wasm-bindgen/wasm-pack/releases/download/v$WASM_PACK_VERSION/wasm-pack-v$WASM_PACK_VERSION-$target.tar.gz" \
    "$digest" "$wasm_pack_dir"
  echo "[prebuilt-wasm-tools] installed wasm-pack $("$wasm_pack_dir/wasm-pack" --version | awk '{print $2}') into $wasm_pack_dir"
fi
