import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../../crates/seams-cli/trust/release-root.json', import.meta.url), new URL('release-root.json', import.meta.url));
