import { expect, test } from '@playwright/test';
import {
  provisionLocalWorkspace,
  restoreLocalWorkspace,
} from '../../examples/wallet-console-lite/src/localWorkspace';

const names = { organizationName: 'Seams Labs', projectName: 'Seams' };
const ready = {
  kind: 'ready',
  identity: {
    ...names,
    organizationId: 'org_local_wallet',
    projectId: 'local-smoke-project',
    environmentName: 'dev',
    environmentId: 'local-smoke-project:dev',
  },
  walletConfig: {
    projectEnvironmentId: 'local-smoke-project:dev',
    publishableKey: 'pk_local',
    gatewayUrl: 'http://localhost:4101',
    walletOrigin: 'http://localhost:4002',
    signingWorkerId: 'local-signing-worker',
  },
};

class LocalControllerFixture {
  readonly saved = new Map<string, string>();
  readonly storage = {
    getItem: this.saved.get.bind(this.saved),
    setItem: this.saved.set.bind(this.saved),
  };
  state: 'empty' | 'ready' | 'offline' = 'empty';
  readonly creations: unknown[] = [];

  readonly fetch: typeof fetch = async (_input, init) => {
    if (this.state === 'offline') throw new Error('Controller unavailable');
    if (init?.method === 'POST') {
      this.creations.push(JSON.parse(String(init.body)));
      this.state = 'ready';
    }
    return Response.json(this.state === 'ready' ? ready : { kind: 'empty' });
  };
}

test('project reload and controller restart restore names without storing runtime configuration', async () => {
  const controller = new LocalControllerFixture();
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.fetch = controller.fetch;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: controller.storage,
  });
  try {
    expect(await restoreLocalWorkspace()).toEqual({ kind: 'empty' });
    expect(await provisionLocalWorkspace(names)).toEqual({ ok: true, workspace: ready });
    expect([...controller.saved.values()].map(parseSavedNames)).toEqual([names]);
    expect(await restoreLocalWorkspace()).toEqual(ready);
    expect(controller.creations).toEqual([names]);

    controller.state = 'empty';
    expect(await restoreLocalWorkspace()).toEqual(ready);
    expect(controller.creations).toEqual([names, names]);

    controller.state = 'offline';
    expect(await restoreLocalWorkspace()).toEqual({
      kind: 'restore_failed',
      message: 'Controller unavailable',
    });
    expect(controller.creations).toHaveLength(2);
    controller.state = 'ready';
    expect(await restoreLocalWorkspace()).toEqual(ready);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

function parseSavedNames(value: string): unknown {
  return JSON.parse(value);
}
