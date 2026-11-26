import type { ThemeMode } from '@/core/types/seams';
import type {
  ExportKeypairWithUIDeps,
  SigningEngineExportKeypairWithUIInput,
  SigningEngineResolveExactKeyExportLaneInput,
  SigningEngineResolveExactKeyExportLaneResult,
} from './exportKeypairOperation';
import type { KeyExportEventCallback } from './keyExportFlow';

export type RecoveryPublicDeps = {
  laneSelection: ExportKeypairWithUIDeps['laneSelection'];
  ecdsa: Omit<ExportKeypairWithUIDeps['ecdsa'], 'theme'>;
  ed25519Yao: Omit<ExportKeypairWithUIDeps['ed25519Yao'], 'theme'>;
  sessionLifecycle: ExportKeypairWithUIDeps['sessionLifecycle'];
  getTheme: () => ThemeMode;
};

export type RecoveryPublicEcdsaSessionStoreDeps = RecoveryPublicDeps['ecdsa']['sessionStore'];

function exportKeypairDeps(deps: RecoveryPublicDeps): ExportKeypairWithUIDeps {
  return {
    laneSelection: deps.laneSelection,
    sessionLifecycle: deps.sessionLifecycle,
    ecdsa: {
      ...deps.ecdsa,
      theme: deps.getTheme(),
    },
    ed25519Yao: {
      ...deps.ed25519Yao,
      theme: deps.getTheme(),
    },
  };
}

export async function exportKeypairWithUI(
  deps: RecoveryPublicDeps,
  input: SigningEngineExportKeypairWithUIInput,
): Promise<{ accountId: string; exportedSchemes: Array<'ed25519' | 'secp256k1'> }> {
  const { exportKeypairWithUI: exportKeypairWithUIValue } = await import('./exportKeypairOperation');
  return await exportKeypairWithUIValue(exportKeypairDeps(deps), input);
}

export async function resolveExactKeyExportLane(
  deps: RecoveryPublicDeps,
  input: SigningEngineResolveExactKeyExportLaneInput,
): Promise<SigningEngineResolveExactKeyExportLaneResult> {
  const { resolveExactKeyExportLane: resolveExactKeyExportLaneValue } = await import('./exportKeypairOperation');
  return await resolveExactKeyExportLaneValue(exportKeypairDeps(deps), input);
}

export type {
  SigningEngineExportKeypairWithUIInput,
  SigningEngineResolveExactKeyExportLaneInput,
  SigningEngineResolveExactKeyExportLaneResult,
  KeyExportEventCallback,
};
