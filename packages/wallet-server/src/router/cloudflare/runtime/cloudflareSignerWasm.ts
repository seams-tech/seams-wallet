export async function loadCloudflareSignerWasmModule() {
  return (await import('../../../wasm/signer')).default;
}

export async function loadCloudflareMlDsaSignerWasmModule() {
  return (await import('../../../wasm/mlDsaSigner')).default;
}
