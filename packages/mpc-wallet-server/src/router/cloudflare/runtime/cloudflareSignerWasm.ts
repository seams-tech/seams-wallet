export async function loadCloudflareSignerWasmModule() {
  return (await import('../../../wasm/signer')).default;
}
