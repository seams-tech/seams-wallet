import {
  activateWalletRegistration,
  completeWalletRegistrationNearProvisioning,
  respondWalletRegistration,
} from './walletRegistration';

type RespondArgs = Parameters<typeof respondWalletRegistration>[0];
type ActivateArgs = Parameters<typeof activateWalletRegistration>[0];
type NearProvisioningArgs = Parameters<typeof completeWalletRegistrationNearProvisioning>[0];

declare const validRespondEcdsa: RespondArgs & { signerPlanKind: 'evm_family_ecdsa' };
declare const validRespondNear: RespondArgs & { signerPlanKind: 'near_ed25519' };
declare const validActivateEcdsa: ActivateArgs & { signerPlanKind: 'evm_family_ecdsa' };
declare const validPasskeyNearProvisioningWithSeal: NearProvisioningArgs & {
  auth: { kind: 'passkey' };
  sessionSeal: {
    thresholdSessionId: string;
    ciphertext: string;
  };
};

const validRespond: RespondArgs = validRespondEcdsa;
const validNearRespond: RespondArgs = validRespondNear;
const validActivate: ActivateArgs = validActivateEcdsa;

// @ts-expect-error Ed25519-only respond requests cannot carry ECDSA proof bundles.
const mixedRespond: RespondArgs = {
  ...validRespond,
  signerPlanKind: 'near_ed25519',
};

// @ts-expect-error ECDSA respond requests must carry their proof bundle.
const missingRespondEcdsa: RespondArgs = {
  ...validNearRespond,
  signerPlanKind: 'evm_family_ecdsa',
};

const mixedActivate: ActivateArgs = {
  ...validActivate,
  // @ts-expect-error NEAR-only registration has no activation request.
  signerPlanKind: 'near_ed25519',
};

const { ecdsa: removedEcdsa, ...withoutEcdsa } = validActivate;
// @ts-expect-error ECDSA activation requests must carry their activation facts.
const missingActivateEcdsa: ActivateArgs = withoutEcdsa;
void removedEcdsa;

const emailOtpProvisioningWithSessionSeal: NearProvisioningArgs = {
  ...validPasskeyNearProvisioningWithSeal,
  auth: {
    kind: 'email_otp',
    // @ts-expect-error Email OTP provisioning cannot carry a passkey session seal.
    enrollment: {
      enrollmentSealKeyVersion: 'seal-key-v1',
      serverSealedFactorCiphertextB64u: 'server-sealed-factor',
      clientUnlockPublicKeyB64u: 'client-unlock-key',
      unlockKeyVersion: 'unlock-key-v1',
    },
  },
};

void mixedRespond;
void missingRespondEcdsa;
void mixedActivate;
void missingActivateEcdsa;
void emailOtpProvisioningWithSessionSeal;
