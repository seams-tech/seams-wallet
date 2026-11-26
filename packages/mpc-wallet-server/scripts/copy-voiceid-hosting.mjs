// Copies the built VoiceID host plugin, its models and its compose command into `voiceid/`,
// which the package publishes as `@seams/host/voiceid` and the `seams-voiceid-host` command.
// Build `packages/voiceid` first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const voiceIdDist = path.resolve(packageRoot, '../voiceid/dist');
const outputRoot = path.join(packageRoot, 'voiceid');
const entries = ['hosting.mjs', 'hosting.d.mts', 'compose-host.mjs', 'public'];

for (const entry of entries) {
  if (!fs.existsSync(path.join(voiceIdDist, entry))) {
    throw new Error(`Missing ${path.join(voiceIdDist, entry)}. Run pnpm -C packages/voiceid build.`);
  }
}
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot);
for (const entry of entries) {
  fs.cpSync(path.join(voiceIdDist, entry), path.join(outputRoot, entry), { recursive: true });
}
// Silent on success: `npm pack --json` prints this package's prepack output with its JSON.
fs.chmodSync(path.join(outputRoot, 'compose-host.mjs'), 0o755);
