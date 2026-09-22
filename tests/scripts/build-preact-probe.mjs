import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walletRoot = path.join(repoRoot, 'packages/wallet');
process.chdir(walletRoot);
const { default: configs } = await import('../../packages/wallet/rolldown.config.ts');
const libraryConfig = configs.find(
  (config) => Array.isArray(config.input) && config.input.includes('src/index.ts'),
);
const reactConfig = configs.find(
  (config) => Array.isArray(config.input) && config.input.includes('src/react/index.ts'),
);
const embeddedConfig = configs.find(
  (config) => config.input && 'wallet-iframe-host-runtime' in Object(config.input),
);
if (!libraryConfig || !reactConfig || !embeddedConfig)
  throw new Error('Wallet build configurations were not found');

function resolveFixture(virtualPath, id) {
  return id === virtualPath ? virtualPath : null;
}

function loadFixture(virtualPath, source, id) {
  return id === virtualPath ? source : null;
}

function isJavaScriptPlugin(plugin) {
  // Asset emitters write to the SDK dist tree independently of the output path.
  return plugin.name !== 'emit-react-css-assets' && plugin.name !== 'emit-wallet-service-static';
}

async function buildProbe(config, fixtureName) {
  const source = fs.readFileSync(path.join(repoRoot, 'tests/fixtures/ui', fixtureName), 'utf8');
  // Resolve dependencies and TSX settings from the SDK, with test source kept outside it.
  const virtualPath = path.join(walletRoot, 'src', fixtureName);
  const { output, ...options } = config;
  const bundle = await rolldown({
    ...options,
    input: virtualPath,
    plugins: [
      {
        name: 'ui-build-fixture',
        resolveId: resolveFixture.bind(null, virtualPath),
        load: loadFixture.bind(null, virtualPath, source),
      },
      ...(config.plugins ?? []).filter(isJavaScriptPlugin),
    ],
  });
  try {
    const result = await bundle.generate({
      ...output,
      dir: undefined,
      entryFileNames: 'probe.js',
      chunkFileNames: '[name]-[hash].js',
      sourcemap: false,
    });
    return result.output
      .filter((entry) => entry.type === 'chunk')
      .map((entry) => ({
        fileName: entry.fileName,
        code: entry.code,
        imports: entry.imports,
        dynamicImports: entry.dynamicImports,
      }));
  } finally {
    await bundle.close();
  }
}

const fixture = process.argv[2];
if (fixture) {
  if (path.basename(fixture) !== fixture) throw new Error('Expected a UI fixture filename');
  process.stdout.write(JSON.stringify(await buildProbe(embeddedConfig, fixture)));
} else {
  const library = await buildProbe(libraryConfig, 'PreactBuildProbe.tsx');
  const react = await buildProbe(reactConfig, 'ReactBuildProbe.tsx');
  const embedded = await buildProbe(embeddedConfig, 'PreactBuildProbe.tsx');
  process.stdout.write(JSON.stringify({ library, react, embedded }));
}
