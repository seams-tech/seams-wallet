import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectBrowserGraph } from '../../packages/wallet/scripts/checks/browser-module-graph.mjs';

test('counts shared, cyclic, re-exported and lazy dependencies once per closure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-browser-graph-'));
  try {
    fs.writeFileSync(
      path.join(root, 'entry.js'),
      `
      import './shared.js';
      export { value } from './reexport.js';
      import('preact');
      import('./lazy.js');
      import(variable);
      // import('./comment.js');
      const text = "import('./string.js')";
    `,
    );
    fs.writeFileSync(path.join(root, 'shared.js'), "import './entry.js';");
    fs.writeFileSync(path.join(root, 'reexport.js'), 'export const value = 1;');
    fs.writeFileSync(path.join(root, 'lazy.js'), "import './shared.js'; import './ui.css';");
    fs.writeFileSync(path.join(root, 'ui.css'), '.surface {}');
    const entry = path.join(root, 'entry.js');
    const boot = collectBrowserGraph([entry], { root, includeDynamic: false });
    const full = collectBrowserGraph([entry, path.join(root, 'lazy.js')], {
      root,
      includeDynamic: true,
    });
    assert.equal(boot.files.length, 3);
    assert.equal(full.files.length, 5);
    assert.deepEqual(full.external, ['preact']);
    assert.deepEqual(full.unresolved, ['entry.js: import(variable)']);
    fs.unlinkSync(path.join(root, 'ui.css'));
    assert.throws(
      () => collectBrowserGraph([entry], { root, includeDynamic: true }),
      /Missing browser asset/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
