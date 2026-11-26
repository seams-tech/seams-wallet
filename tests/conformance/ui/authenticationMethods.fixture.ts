import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthenticationMethodsModal } from '../../../packages/mpc-wallet/src/react/components/AccountMenuButton/AuthenticationMethodsModal';
import { provideSeams } from './seamsContextStub';

/**
 * A page module that renders today's Authentication methods screen of the account menu. The
 * check sets `window.__authMethods.scenario` before it loads the module; the fake wallet below
 * answers like the Wallet Gateway and records every call in `window.__authMethods.calls`.
 */

export type MethodKind = 'passkey' | 'email_otp' | 'voiceid';

export type ScenarioMethod = {
  readonly kind: MethodKind;
  readonly id: string;
  readonly authorityId: string;
};

export type AuthMethodsScenario = {
  readonly walletId: string;
  /** The owner methods that the device list returns. */
  readonly methods: readonly ScenarioMethod[];
  /** The method of the current Wallet Session; null for a locked wallet. */
  readonly selected: ScenarioMethod | null;
  readonly voiceIdConfigured: boolean;
  readonly voiceIdAvailability: 'enabled' | 'disabled' | 'not_enrolled';
  readonly removalFailure: string | null;
};

export type AuthMethodsCall = { readonly name: string; readonly input: unknown };

type AuthMethodsWindow = Window & {
  __authMethods: { scenario: AuthMethodsScenario; calls: AuthMethodsCall[] };
};

const state = (window as unknown as AuthMethodsWindow).__authMethods;
const scenario = state.scenario;
let methods = [...scenario.methods];
let voiceIdAvailability = scenario.voiceIdAvailability;

function record(name: string, input: unknown): void {
  state.calls.push({ name, input });
}

function credentialOf(method: ScenarioMethod) {
  switch (method.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        walletAuthMethodId: method.id,
        credentialIdB64u: `credential-${method.id}`,
        device: { label: 'Conformance laptop', providerLabel: 'Conformance keychain' },
      };
    case 'email_otp':
      return { kind: 'email_otp', walletAuthMethodId: method.id };
    case 'voiceid':
      return { kind: 'voiceid', walletAuthMethodId: method.id, deviceKeyId: 'conformance-key' };
  }
}

function addedMethod(kind: MethodKind): ScenarioMethod {
  return { kind, id: `added-${kind}`, authorityId: scenario.selected?.authorityId ?? '' };
}

function availability() {
  const method = methods.find((candidate) => candidate.kind === 'voiceid');
  return voiceIdAvailability === 'not_enrolled' || !method
    ? { kind: 'not_enrolled' }
    : { kind: voiceIdAvailability, walletAuthMethodId: method.id };
}

const seams = {
  configs: {
    authMethods: scenario.voiceIdConfigured ? [{ kind: 'voiceid' }] : [],
    wallet: { iframe: { rpIdOverride: 'example.localhost' } },
  },
  devices: {
    list: async (input: unknown) => {
      record('devices.list', input);
      return {
        devices: [],
        nextCursor: null,
        ownerDevices: methods.map((method) => ({
          walletId: scenario.walletId,
          walletAuthorityId: method.authorityId,
          credential: credentialOf(method),
          createdAtMs: 1,
          lastActivityAtMs: 1,
        })),
      };
    },
  },
  registration: {
    addPasskey: async (input: unknown) => {
      record('registration.addPasskey', input);
      methods = [...methods, addedMethod('passkey')];
    },
    addEmail: async (input: unknown) => {
      record('registration.addEmail', input);
      methods = [...methods, addedMethod('email_otp')];
    },
    removeAuthMethod: async (input: { walletAuthMethodId: string }) => {
      record('registration.removeAuthMethod', input);
      if (scenario.removalFailure) throw new Error(scenario.removalFailure);
      methods = methods.filter((method) => method.id !== input.walletAuthMethodId);
    },
    getAuthMethodAvailability: async (input: unknown) => {
      record('registration.getAuthMethodAvailability', input);
      return availability();
    },
    setAuthMethodEnabled: async (input: { enabled: boolean }) => {
      record('registration.setAuthMethodEnabled', input);
      voiceIdAvailability = input.enabled ? 'enabled' : 'disabled';
      return availability();
    },
    activateAuthMethod: async (input: unknown) => {
      record('registration.activateAuthMethod', input);
      return { kind: 'cancelled' };
    },
  },
};

const selected = scenario.selected;
provideSeams({
  seams,
  loginState: selected
    ? {
        isLoggedIn: true,
        access: 'owner',
        walletId: scenario.walletId,
        currentAuthMethod: {
          kind: 'selected',
          binding: { kind: selected.kind, walletAuthMethodId: selected.id },
        },
      }
    : { isLoggedIn: false, walletId: null, currentAuthMethod: { kind: 'none' } },
  refreshSession: async (walletId: string) => record('refreshSession', walletId),
});

const root = document.createElement('div');
root.id = 'auth-methods-root';
document.body.append(root);
createRoot(root).render(
  createElement(AuthenticationMethodsModal, {
    walletId: scenario.walletId,
    isOpen: true,
    onClose: () => record('onClose', null),
    presentation: 'page',
  }),
);
