import type {
  WalletCustodyKeySetCeremonyInput,
  WalletCustodyCeremonyKeySetInput,
  WalletCustodyCeremonyStepRunner,
  MlDsaKeySetCeremonyInput,
} from './ceremonyDriver';
import { runMlDsaCustodyKeySetCeremony } from './ceremonyDriver';
import type { Variant } from '@shared/utils/variant';

declare const runStep: WalletCustodyCeremonyStepRunner;
declare const keySetRun: WalletCustodyCeremonyKeySetInput;

// @ts-expect-error recovery must name the registered manifest it reproduces.
const recoveryWithoutManifest: WalletCustodyKeySetCeremonyInput = {
  runStep,
  keySetRun,
  custody: {
    origin: 'recover',
    custodyJson: '{}',
    recoveryCode: new ArrayBuffer(20),
  },
};
void recoveryWithoutManifest;

const recoveryWithManifest: WalletCustodyKeySetCeremonyInput = {
  runStep,
  keySetRun,
  custody: {
    origin: 'recover_and_reseal',
    custodyJson: '{}',
    recoveryCode: new ArrayBuffer(20),
    replacementFactorJson: '{}',
    replacementFactorSecret: new ArrayBuffer(32),
  },
  recordedKeyManifestDigestB64u: 'registered-manifest-digest',
};
void recoveryWithManifest;

const recoveryWithoutReplacementFactor: WalletCustodyKeySetCeremonyInput = {
  runStep,
  keySetRun,
  // @ts-expect-error resealing requires the replacement factor and its secret.
  custody: {
    origin: 'recover_and_reseal',
    custodyJson: '{}',
    recoveryCode: new ArrayBuffer(20),
  },
  recordedKeyManifestDigestB64u: 'registered-manifest-digest',
};
void recoveryWithoutReplacementFactor;

declare const mlDsaEstablish: Variant<MlDsaKeySetCeremonyInput, 'kind', 'establish'>;
declare const mlDsaRecovery: Variant<MlDsaKeySetCeremonyInput, 'kind', 'recover'>;
declare const mlDsaJoin: Variant<MlDsaKeySetCeremonyInput, 'kind', 'join'>;

// @ts-expect-error Recovery must use the existing key manifest, including through broad spreads.
runMlDsaCustodyKeySetCeremony({ ...mlDsaRecovery, protocolInputs: mlDsaEstablish.protocolInputs });
// @ts-expect-error Existing custody cannot create another recovery set.
runMlDsaCustodyKeySetCeremony({ ...mlDsaJoin, recoveryCodesJson: '[]' });
// @ts-expect-error A recovery ceremony must seal a replacement factor.
runMlDsaCustodyKeySetCeremony({ ...mlDsaRecovery, replacementFactorSecret: undefined });
// @ts-expect-error A recovery code cannot enter an establishing ceremony.
runMlDsaCustodyKeySetCeremony({ ...mlDsaEstablish, recoveryCode: new ArrayBuffer(32) });
runMlDsaCustodyKeySetCeremony({
  ...mlDsaJoin,
  // @ts-expect-error The canonical seed cannot enter the protocol inputs.
  protocolInputs: { ...mlDsaJoin.protocolInputs, canonicalSeed: new Uint8Array(32) },
});
