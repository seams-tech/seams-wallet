import { isFunction, isPlainObject } from '@shared/utils/validation';
import type { AuthMethodName } from '../shared/protocol';

// The host half of the plugin contract. A plugin is code of the operator on the account origin.
// The account frame loads it from a fixed path, and only when the app enables it. The MPC wallet
// is a plugin, and it owns each worker. The auth core starts no worker.

export const PLUGIN_API_VERSION = 1;

/** The proof of a method as a plugin gets it, for its own server to check. */
export type PluginProof =
  | { readonly factor: 'webauthn'; readonly assertion: object }
  | { readonly factor: 'device_key'; readonly signatureB64u: string }
  /** For an email code, the signed statement of the Auth Worker. */
  | { readonly factor: 'email_code'; readonly statement: string };

export type PluginProveResult =
  | {
      readonly kind: 'proved';
      readonly accountId: string;
      readonly methodId: string;
      readonly method: AuthMethodName;
      readonly proof: PluginProof;
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type PluginProveRequest = {
  /** One of the audiences that the plugin registered. */
  readonly audience: string;
  readonly challenge: string;
  /** A purpose from the operator's list for the audience. The email names it. */
  readonly purpose?: string;
  /** Limits the proof to one method of the account. */
  readonly methodId?: string;
  /**
   * A port to a worker of the plugin. For a passkey, the core asks for the PRF result of
   * `prfSalt` and sends it into this port. The plugin's page code never gets it.
   */
  readonly secretSink?: MessagePort;
  readonly prfSalt?: ArrayBuffer;
  /** For a device key: the bytes of the plugin's own message for its audience. */
  readonly deviceKeyMessage?: Uint8Array<ArrayBuffer>;
};

/** What the auth core gives a plugin. */
export type PluginHost = {
  readonly appOrigin: string;
  /** The account of the login session, or null. */
  account(): Promise<{ readonly accountId: string } | null>;
  prove(request: PluginProveRequest): Promise<PluginProveResult>;
  /** A part of the account frame for the plugin's own screen, shown in the dialog. */
  openSurface(title: string): { readonly element: HTMLElement; close(): void };
};

export type AuthPluginInstance = {
  /** A channel from the plugin's page SDK. The auth core does not read its messages. */
  connect(port: MessagePort): void;
  /** False refuses the removal of a method, for example of the last method of a wallet. */
  beforeMethodRemoval?(method: {
    readonly id: string;
    readonly method: AuthMethodName;
  }): Promise<boolean>;
};

export type AuthPlugin = {
  readonly pluginApiVersion: typeof PLUGIN_API_VERSION;
  readonly id: string;
  /** The audiences that only this plugin can ask for. The app page cannot ask for them. */
  readonly audiences: readonly string[];
  start(host: PluginHost): AuthPluginInstance;
};

function isAuthPlugin(value: unknown, id: string): value is AuthPlugin {
  return (
    isPlainObject(value) &&
    value.pluginApiVersion === PLUGIN_API_VERSION &&
    value.id === id &&
    Array.isArray(value.audiences) &&
    value.audiences.every((audience) => typeof audience === 'string') &&
    isFunction(value.start)
  );
}

export type LoadedPlugin = { readonly plugin: AuthPlugin; readonly instance: AuthPluginInstance };

/**
 * Loads the plugins that the app enabled, each from `/sdk/<id>/host.js` on the account origin.
 * A plugin that is not installed, or that speaks another version, is left out.
 */
export function loadPlugins(
  ids: readonly string[],
  hostFor: (plugin: AuthPlugin) => PluginHost,
): Map<string, Promise<LoadedPlugin | null>> {
  const plugins = new Map<string, Promise<LoadedPlugin | null>>();
  for (const id of ids) {
    plugins.set(
      id,
      (async () => {
        try {
          const module: unknown = await import(/* @vite-ignore */ `/sdk/${id}/host.js`);
          const plugin = isPlainObject(module) ? module.plugin : null;
          if (!isAuthPlugin(plugin, id)) return null;
          return { plugin, instance: plugin.start(hostFor(plugin)) };
        } catch {
          return null;
        }
      })(),
    );
  }
  return plugins;
}
