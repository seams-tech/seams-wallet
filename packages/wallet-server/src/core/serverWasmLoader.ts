/**
 * Starts a wasm-bindgen module on the server. Node reads the `.wasm` file from
 * disk. A Cloudflare Worker uses the module that the bundler embedded, or else
 * fetches one of the URLs. Each caller keeps its own static `import()` of the
 * `.wasm` file, because a bundler can only embed a literal path.
 */
export async function initializeServerWasm(input: {
  readonly label: string;
  /** The caller's `import.meta.url`. It is not a valid base in every Worker bundle. */
  readonly baseUrl: string | undefined;
  /** Package-relative `.wasm` paths, tried in order. */
  readonly paths: readonly string[];
  readonly loadBundled: () => Promise<unknown>;
  readonly initialize: (moduleOrPath: WebAssembly.Module | URL) => Promise<void>;
}): Promise<void> {
  if (isNodeEnvironment()) {
    const { fileURLToPath } = await import('node:url');
    const { readFile } = await import('node:fs/promises');
    for (const url of resolveUrls(input.baseUrl, input.paths)) {
      try {
        const bytes = await readFile(fileURLToPath(url));
        await input.initialize(await WebAssembly.compile(new Uint8Array(bytes)));
        return;
      } catch {
        // Try the next package layout.
      }
    }
    throw new Error(`[${input.label}] Failed to initialize WASM from filesystem candidates`);
  }

  const bundled = await input.loadBundled().catch(() => null);
  if (isObjectWithModule(bundled)) {
    await input.initialize(bundled.default);
    return;
  }
  let lastError: unknown = null;
  for (const url of resolveUrls(input.baseUrl, input.paths)) {
    try {
      await input.initialize(url);
      return;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`[${input.label}] Failed to initialize WASM`);
}

/** Resolves the paths that form a valid URL against the base and skips the others. */
function resolveUrls(baseUrl: string | undefined, paths: readonly string[]): URL[] {
  const urls: URL[] = [];
  for (const path of paths) {
    try {
      urls.push(new URL(path, baseUrl));
    } catch {
      // This bundle has no usable base for this path.
    }
  }
  return urls;
}

function isObjectWithModule(value: unknown): value is { readonly default: WebAssembly.Module } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { default?: unknown }).default instanceof WebAssembly.Module
  );
}

function isNodeEnvironment(): boolean {
  const processObject = (globalThis as { process?: { versions?: { node?: string } } }).process;
  const isNode = Boolean(processObject?.versions?.node);
  const webSocketPair = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
  const navigatorObject = (globalThis as { navigator?: { userAgent?: unknown } }).navigator;
  const isCloudflareWorker =
    typeof webSocketPair !== 'undefined' ||
    (typeof navigatorObject?.userAgent === 'string' &&
      navigatorObject.userAgent.includes('Cloudflare-Workers'));
  return isNode && !isCloudflareWorker;
}
