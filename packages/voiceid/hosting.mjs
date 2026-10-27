import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const voicePublic = fileURLToPath(new URL('./public/', import.meta.url));

/** Compose a new deployment directory without changing either source asset tree. */
export async function composeVoiceIdWalletAssets({ walletPublicDirectory, outputDirectory }) {
  const walletPublic = path.resolve(walletPublicDirectory);
  const output = path.resolve(outputDirectory);
  if (
    containsPath(walletPublic, output) ||
    containsPath(voicePublic, output) ||
    containsPath(output, walletPublic) ||
    containsPath(output, voicePublic)
  ) {
    throw new Error('Compose VoiceID into a separate deployment directory.');
  }
  await access(path.join(walletPublic, 'sdk/voiceid-host.js'));
  const manifest = JSON.parse(
    await readFile(path.join(walletPublic, 'wallet-assets.manifest.json'), 'utf8'),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.packageName !== '@seams/wallet' ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error('Expected the static asset manifest from a compatible @seams/wallet package.');
  }
  // An existing directory is never overwritten, including either package's dist tree.
  await mkdir(output);
  for (const entry of await readdir(walletPublic)) {
    await cp(path.join(walletPublic, entry), path.join(output, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await cp(path.join(voicePublic, 'sdk/voiceid'), path.join(output, 'sdk/voiceid'), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const voiceFiles = await readdir(path.join(voicePublic, 'sdk/voiceid'));
  for (const filename of voiceFiles) manifest.assets.push(assetEntry(filename));
  manifest.assets.sort(compareAssets);
  await writeFile(
    path.join(output, 'wallet-assets.manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return output;
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

function compareAssets(left, right) {
  return left.sourceFile.localeCompare(right.sourceFile);
}

function assetEntry(filename) {
  const sourceFile = `sdk/voiceid/${filename}`;
  const extension = path.extname(filename);
  let routeClass = 'binary';
  let contentType = 'application/octet-stream';
  if (extension === '.js' || extension === '.mjs') {
    routeClass = 'javascript';
    contentType = 'text/javascript; charset=utf-8';
  } else if (extension === '.wasm') {
    routeClass = 'wasm';
    contentType = 'application/wasm';
  }
  const cachePolicy = 'public, max-age=300, must-revalidate';
  return {
    route: `/${sourceFile}`,
    sourceFile,
    owner: 'wallet_sdk_asset',
    routeClass,
    contentType,
    cachePolicy,
    requiredHeaders: [
      { name: 'Content-Type', value: contentType },
      { name: 'Cache-Control', value: cachePolicy },
      { name: 'Access-Control-Allow-Origin', value: '*' },
    ],
  };
}
