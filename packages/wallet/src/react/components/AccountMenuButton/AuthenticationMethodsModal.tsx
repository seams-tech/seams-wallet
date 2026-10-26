import { VoiceIdAvailabilityControl, VoiceIdMethodRow } from './VoiceIdAvailabilityControl';
import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import { AuthenticationMethodsView } from './AuthenticationMethodsView';
import React, { useEffect } from 'react';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import type {
  LinkedDeviceSummaryV1,
  LinkedOwnerCredentialMetadataV1,
  OwnerDeviceSummaryV1,
} from '@shared/device-linking';
import type { WalletAuthMethodBinding } from '@shared/utils/walletCapabilityBindings';
import { useSeams } from '../../context';
import { AccountMenuDialogFrame } from './AccountMenuDialog';
import { PlusIcon } from './icons/PlusIcon';
import './LinkedDevicesModal.css';

interface AuthenticationMethodsModalProps {
  readonly walletId: string | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly presentation: 'page' | 'embedded';
}

type AuthenticationMethodView = {
  readonly kind: LinkedOwnerCredentialMetadataV1['kind'];
  readonly walletAuthMethodId: string;
  readonly presentation:
    | {
        readonly kind: 'passkey';
        readonly description: string;
      }
    | { readonly kind: 'email_otp' }
    | { readonly kind: 'voiceid' };
};

type CurrentAuthorityInventory =
  | {
      readonly kind: 'owner_authority';
      readonly authorityId: string;
      readonly methods: readonly AuthenticationMethodView[];
    }
  | {
      readonly kind: 'linked_authority';
      readonly deviceId: string;
      readonly methods: readonly AuthenticationMethodView[];
    }
  | {
      readonly kind: 'local_selection';
      readonly methods: readonly [AuthenticationMethodView];
    };

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly inventory: CurrentAuthorityInventory }
  | { readonly kind: 'loaded'; readonly inventory: CurrentAuthorityInventory }
  | { readonly kind: 'error'; readonly message: string };

type ActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unlocking' }
  | { readonly kind: 'adding'; readonly method: LinkedOwnerCredentialMetadataV1['kind'] }
  | { readonly kind: 'confirming_revoke'; readonly method: AuthenticationMethodView }
  | { readonly kind: 'revoking'; readonly method: AuthenticationMethodView }
  | { readonly kind: 'error'; readonly message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Try again.';
}

function configuredWalletRpId(seams: ReturnType<typeof useSeams>['seams']): string {
  const configured = String(seams.configs.wallet.iframe?.rpIdOverride || '').trim();
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location.hostname) return window.location.hostname;
  throw new Error('Passkey addition requires a configured relying-party ID.');
}

function activeLinkedDevices(
  devices: readonly LinkedDeviceSummaryV1[],
): readonly LinkedDeviceSummaryV1[] {
  return devices.filter((device) => device.state === 'active');
}

function methodView(credential: LinkedOwnerCredentialMetadataV1): AuthenticationMethodView {
  switch (credential.kind) {
    case 'passkey': {
      const provider = credential.device.providerLabel ?? credential.device.provider;
      return {
        kind: 'passkey',
        walletAuthMethodId: String(credential.walletAuthMethodId),
        presentation: {
          kind: 'passkey',
          description: provider ?? credential.device.label,
        },
      };
    }
    case 'email_otp':
      return {
        kind: 'email_otp',
        walletAuthMethodId: String(credential.walletAuthMethodId),
        presentation: { kind: 'email_otp' },
      };
    case 'voiceid':
      return {
        kind: 'voiceid',
        walletAuthMethodId: String(credential.walletAuthMethodId),
        presentation: { kind: 'voiceid' },
      };
  }
}

function selectedMethodView(binding: WalletAuthMethodBinding): AuthenticationMethodView {
  switch (binding.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        walletAuthMethodId: String(binding.walletAuthMethodId),
        presentation: { kind: 'passkey', description: 'Passkey on this device' },
      };
    case 'voiceid':
      return {
        kind: 'voiceid',
        walletAuthMethodId: String(binding.walletAuthMethodId),
        presentation: { kind: 'voiceid' },
      };
    case 'email_otp':
      return {
        kind: 'email_otp',
        walletAuthMethodId: String(binding.walletAuthMethodId),
        presentation: { kind: 'email_otp' },
      };
  }
}

function requireValidMethodSet(
  credentials: readonly LinkedOwnerCredentialMetadataV1[],
): readonly AuthenticationMethodView[] {
  const methods = credentials.map(methodView);
  const passkeys = methods.filter((method) => method.kind === 'passkey');
  const emailMethods = methods.filter((method) => method.kind === 'email_otp');
  if (passkeys.length > 1 || emailMethods.length > 1) {
    throw new Error('This device authority has duplicate authentication methods.');
  }
  if (methods.length === 0) {
    throw new Error('The selected device authority has no active authentication method.');
  }
  return methods;
}

function currentAuthorityInventory(input: {
  readonly selectedBinding: WalletAuthMethodBinding;
  readonly ownerDevices: readonly OwnerDeviceSummaryV1[];
  readonly devices: readonly LinkedDeviceSummaryV1[];
}): CurrentAuthorityInventory {
  const selectedMethodId = String(input.selectedBinding.walletAuthMethodId);
  const ownerMatch = input.ownerDevices.find(
    (owner) => String(owner.credential.walletAuthMethodId) === selectedMethodId,
  );
  const linkedDevices = activeLinkedDevices(input.devices);
  const linkedMatch = linkedDevices.find(
    (device) => String(device.credential.walletAuthMethodId) === selectedMethodId,
  );
  if (ownerMatch && linkedMatch) {
    throw new Error('The selected authentication method maps to multiple device authorities.');
  }
  if (ownerMatch) {
    const authorityId = String(ownerMatch.walletAuthorityId);
    const credentials = input.ownerDevices
      .filter((owner) => String(owner.walletAuthorityId) === authorityId)
      .map((owner) => owner.credential);
    return {
      kind: 'owner_authority',
      authorityId,
      methods: requireValidMethodSet(credentials),
    };
  }
  if (linkedMatch) {
    const deviceId = String(linkedMatch.deviceId);
    const credentials = linkedDevices
      .filter((device) => String(device.deviceId) === deviceId)
      .map((device) => device.credential);
    return {
      kind: 'linked_authority',
      deviceId,
      methods: requireValidMethodSet(credentials),
    };
  }
  throw new Error('The selected authentication method is unavailable on this device authority.');
}

function methodTitle(method: AuthenticationMethodView): string {
  switch (method.kind) {
    case 'passkey':
      return 'Passkey';
    case 'email_otp':
      return 'Email OTP';
    case 'voiceid':
      return 'VoiceID';
  }
}

function methodDescription(method: AuthenticationMethodView): string {
  switch (method.presentation.kind) {
    case 'passkey':
      return method.presentation.description;
    case 'email_otp':
      return 'Email OTP';
    case 'voiceid':
      return 'Voice unlock on this device';
  }
}

export const AuthenticationMethodsModal: React.FC<AuthenticationMethodsModalProps> = ({
  walletId,
  isOpen,
  onClose,
  presentation,
}) => {
  const locale = useWalletLocale();
  const { seams, loginState, refreshSession } = useSeams();
  const [loadState, setLoadState] = React.useState<LoadState>({ kind: 'idle' });
  const [actionState, setActionState] = React.useState<ActionState>({ kind: 'idle' });
  const [emailAddress, setEmailAddress] = React.useState('');
  const [announcement, setAnnouncement] = React.useState('');
  const loadSequence = React.useRef(0);
  const seamsRef = React.useRef(seams);
  const loginStateRef = React.useRef(loginState);
  const refreshSessionRef = React.useRef(refreshSession);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const emailInputId = React.useId();
  seamsRef.current = seams;
  loginStateRef.current = loginState;
  refreshSessionRef.current = refreshSession;

  const selectedWalletAuthMethodId =
    loginState.isLoggedIn && loginState.currentAuthMethod.kind === 'selected'
      ? String(loginState.currentAuthMethod.binding.walletAuthMethodId)
      : null;

  const loadInventory = React.useCallback(async () => {
    if (!walletId) {
      setLoadState({ kind: 'error', message: 'Wallet identity is unavailable. Try again.' });
      return;
    }
    if (!selectedWalletAuthMethodId) {
      setLoadState({ kind: 'error', message: 'Unlock this wallet to manage authentication.' });
      return;
    }
    const currentLoginState = loginStateRef.current;
    if (!currentLoginState.isLoggedIn || currentLoginState.currentAuthMethod.kind !== 'selected') {
      setLoadState({ kind: 'error', message: 'Unlock this wallet to manage authentication.' });
      return;
    }
    const localInventory: CurrentAuthorityInventory = {
      kind: 'local_selection',
      methods: [selectedMethodView(currentLoginState.currentAuthMethod.binding)],
    };
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoadState({ kind: 'loading', inventory: localInventory });
    try {
      const result = await seamsRef.current.devices.list({
        walletId,
        limit: 50,
        cursor: null,
      });
      const inventory = currentAuthorityInventory({
        selectedBinding: currentLoginState.currentAuthMethod.binding,
        ownerDevices: result.ownerDevices,
        devices: result.devices,
      });
      if (loadSequence.current === sequence) {
        setLoadState({ kind: 'loaded', inventory });
      }
    } catch (error: unknown) {
      if (loadSequence.current === sequence) {
        setLoadState({ kind: 'loaded', inventory: localInventory });
      }
    }
  }, [selectedWalletAuthMethodId, walletId]);

  useEffect(() => {
    if (!isOpen) {
      loadSequence.current += 1;
      setLoadState({ kind: 'idle' });
      setActionState({ kind: 'idle' });
      setEmailAddress('');
      setAnnouncement('');
      return;
    }
    void loadInventory();
  }, [isOpen, loadInventory]);

  const addMethod = React.useCallback(
    async (method: LinkedOwnerCredentialMetadataV1['kind']) => {
      if (!walletId || actionState.kind === 'adding') return;
      const normalizedEmail = emailAddress.trim();
      if (method === 'email_otp' && !normalizedEmail) {
        setActionState({ kind: 'error', message: 'Enter the email address to verify.' });
        return;
      }
      setActionState({ kind: 'adding', method });
      setAnnouncement(method === 'passkey' ? 'Adding a passkey…' : 'Adding Email OTP…');
      try {
        if (method === 'passkey') {
          await seamsRef.current.registration.addPasskey({
            walletId,
            rpId: configuredWalletRpId(seamsRef.current),
          });
        } else {
          await seamsRef.current.registration.addEmail({
            walletId,
            emailAddress: normalizedEmail,
          });
        }
        await refreshSessionRef.current(walletId);
        setEmailAddress('');
        setActionState({ kind: 'idle' });
        setAnnouncement(method === 'passkey' ? 'Passkey added.' : 'Email OTP added.');
        await loadInventory();
      } catch (error: unknown) {
        setActionState({ kind: 'error', message: errorMessage(error) });
      }
    },
    [actionState.kind, emailAddress, loadInventory, walletId],
  );

  const unlockOwnerSession = React.useCallback(async () => {
    if (!walletId || actionState.kind === 'unlocking') return;
    setActionState({ kind: 'unlocking' });
    setAnnouncement('Unlocking wallet management…');
    try {
      const result = await seamsRef.current.auth.unlock(walletId);
      if (!result.success) {
        throw new Error(result.error);
      }
      await refreshSessionRef.current(walletId);
      setActionState({ kind: 'idle' });
      setAnnouncement('Wallet management unlocked.');
      await loadInventory();
      dialogRef.current?.focus({ preventScroll: true });
    } catch (error: unknown) {
      setActionState({ kind: 'error', message: errorMessage(error) });
    }
  }, [actionState.kind, loadInventory, walletId]);

  const revokeMethod = React.useCallback(async () => {
    if (!walletId || actionState.kind !== 'confirming_revoke') return;
    const method = actionState.method;
    setActionState({ kind: 'revoking', method });
    setAnnouncement(`Removing ${methodTitle(method)}…`);
    try {
      await seamsRef.current.registration.removeAuthMethod({
        walletId,
        walletAuthMethodId: method.walletAuthMethodId,
      });
      await refreshSessionRef.current(walletId);
      setActionState({ kind: 'idle' });
      await loadInventory();
    } catch (error: unknown) {
      setActionState({ kind: 'error', message: errorMessage(error) });
    }
  }, [actionState, loadInventory, walletId]);

  if (!isOpen) return null;

  const inventory =
    loadState.kind === 'loaded' || loadState.kind === 'loading' ? loadState.inventory : null;
  const methods = inventory?.methods ?? [];
  const hasPasskey = methods.some((method) => method.kind === 'passkey');
  const hasEmailOtp = methods.some((method) => method.kind === 'email_otp');
  const hasVoiceId = methods.some((method) => method.kind === 'voiceid');
  const voiceIdConfigured = seams.configs.authMethods.some(isVoiceIdPlugin);
  const canManageMethods =
    loadState.kind === 'loaded' && loadState.inventory.kind !== 'local_selection';
  const actionInProgress =
    actionState.kind === 'unlocking' ||
    actionState.kind === 'adding' ||
    actionState.kind === 'revoking';

  return (
    <AccountMenuDialogFrame
      presentation={presentation}
      onClose={onClose}
      dialogRef={dialogRef}
      contentClassName="seams-auth-methods-modal-content"
      titleId="seams-auth-methods-modal-title"
      title={walletText(locale, 'Authentication methods')}
    >
      <AuthenticationMethodsView walletLabel={walletId ?? 'Wallet'}>
        <div className="seams-linked-devices-modal-body" aria-busy={loadState.kind === 'loading'}>
          {loadState.kind === 'idle' ? (
            <div className="seams-linked-devices-modal-placeholder" role="status">
              <WalletText message="Checking authentication methods…" />
            </div>
          ) : null}

          {loadState.kind === 'error' ? (
            <div className="seams-linked-devices-modal-placeholder" role="alert">
              <span>
                <WalletText message="Unable to load authentication methods:" />{' '}
                <WalletText copy={loadState.message} />
              </span>
              <button
                type="button"
                className="seams-linked-devices-modal-secondary"
                onClick={() => void loadInventory()}
              >
                <WalletText message="Try again" />
              </button>
            </div>
          ) : null}

          {inventory ? (
            <section
              className="seams-account-menu-section"
              aria-labelledby="seams-auth-methods-active"
            >
              <h3 id="seams-auth-methods-active" className="seams-account-menu-section-label">
                <WalletText message="Active authentication methods" />
              </h3>
              <ul className="seams-account-method-tiles">
                {methods.map((method) => {
                  const confirming =
                    actionState.kind === 'confirming_revoke' &&
                    actionState.method.walletAuthMethodId === method.walletAuthMethodId;
                  const revoking =
                    actionState.kind === 'revoking' &&
                    actionState.method.walletAuthMethodId === method.walletAuthMethodId;
                  const title = walletDisplayText(locale, methodTitle(method));
                  const chip =
                    method.walletAuthMethodId === selectedWalletAuthMethodId
                      ? 'In use now'
                      : undefined;
                  const remove =
                    !confirming && canManageMethods && methods.length > 1 ? (
                      <button
                        type="button"
                        className="seams-auth-method-text-action"
                        data-tone="danger"
                        disabled={actionInProgress}
                        aria-label={walletDisplayText(locale, `Remove ${methodTitle(method)}`)}
                        onClick={() => setActionState({ kind: 'confirming_revoke', method })}
                      >
                        {revoking ? (
                          <WalletText message="Removing…" />
                        ) : (
                          <WalletText message="Remove" />
                        )}
                      </button>
                    ) : null;
                  const confirmation = confirming ? (
                    <div className="seams-linked-devices-modal-confirm">
                      <span>
                        <WalletText
                          message="Remove {value0} from this device? You will need the other active method to unlock it."
                          values={{ value0: title }}
                        />
                      </span>
                      <div className="seams-linked-devices-modal-confirm-actions">
                        <button
                          type="button"
                          className="seams-linked-devices-modal-secondary"
                          onClick={() => setActionState({ kind: 'idle' })}
                        >
                          <WalletText message="Keep it" />
                        </button>
                        <button
                          type="button"
                          className="seams-linked-devices-modal-danger"
                          onClick={() => void revokeMethod()}
                        >
                          <WalletText message="Remove method" />
                        </button>
                      </div>
                    </div>
                  ) : null;
                  const hint =
                    methods.length > 1 ? null : (
                      <span className="seams-linked-devices-modal-item-detail">
                        <WalletText message="Add another method before removing this one." />
                      </span>
                    );
                  return method.kind === 'voiceid' && voiceIdConfigured && walletId ? (
                    <VoiceIdMethodRow
                      key={method.walletAuthMethodId}
                      walletId={walletId}
                      onChanged={loadInventory}
                      disabled={actionInProgress}
                      title={title}
                      chip={chip}
                      remove={remove}
                      confirmation={confirmation}
                    >
                      {hint}
                    </VoiceIdMethodRow>
                  ) : (
                    <AuthenticationMethodRow
                      key={method.walletAuthMethodId}
                      kind={method.kind}
                      title={title}
                      chip={chip}
                      description={walletDisplayText(locale, methodDescription(method))}
                      action={remove}
                      footer={confirmation}
                    >
                      {hint}
                    </AuthenticationMethodRow>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {inventory && (!hasPasskey || !hasEmailOtp || (voiceIdConfigured && !hasVoiceId)) ? (
            <section
              className="seams-account-menu-section"
              aria-labelledby="seams-auth-methods-add"
            >
              <h3 id="seams-auth-methods-add" className="seams-account-menu-section-label">
                <WalletText message="Add a method" />
              </h3>
              {voiceIdConfigured && !hasVoiceId && walletId ? (
                <VoiceIdAvailabilityControl
                  walletId={walletId}
                  onChanged={loadInventory}
                  disabled={actionInProgress || !canManageMethods}
                />
              ) : null}
              {!hasPasskey ? (
                <div className="seams-linked-devices-modal-add-method">
                  <button
                    type="button"
                    className="seams-linked-devices-modal-secondary seams-account-menu-wide-button"
                    disabled={actionInProgress || !canManageMethods}
                    onClick={() => void addMethod('passkey')}
                  >
                    <PlusIcon size={18} strokeWidth={1.75} />
                    {actionState.kind === 'adding' && actionState.method === 'passkey' ? (
                      <WalletText message="Adding…" />
                    ) : (
                      <WalletText message="Add passkey" />
                    )}
                  </button>
                  <p className="seams-linked-devices-modal-security-note">
                    <WalletText message="Use a passkey from this device to unlock the wallet." />
                  </p>
                </div>
              ) : null}

              {!hasEmailOtp ? (
                <div className="seams-linked-devices-modal-add-method">
                  <form
                    className="seams-linked-devices-modal-otp-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void addMethod('email_otp');
                    }}
                  >
                    <label htmlFor={emailInputId}>
                      <WalletText message="Email address" />
                    </label>
                    <input
                      id={emailInputId}
                      className="seams-linked-devices-modal-otp-input"
                      type="email"
                      autoComplete="email"
                      required
                      value={emailAddress}
                      disabled={actionInProgress || !canManageMethods}
                      onChange={(event) => {
                        setEmailAddress(event.currentTarget.value);
                        if (actionState.kind === 'error') setActionState({ kind: 'idle' });
                      }}
                    />
                    <button
                      type="submit"
                      className="seams-linked-devices-modal-secondary"
                      disabled={actionInProgress || !canManageMethods}
                    >
                      {actionState.kind === 'adding' && actionState.method === 'email_otp' ? (
                        <WalletText message="Adding…" />
                      ) : (
                        <WalletText message="Add Email OTP" />
                      )}
                    </button>
                  </form>
                </div>
              ) : null}
            </section>
          ) : null}

          {loadState.kind === 'loaded' && inventory?.kind === 'local_selection' ? (
            <section className="seams-linked-devices-modal-add-method">
              <h3>
                <WalletText message="Unlock to manage methods" />
              </h3>
              <p className="seams-linked-devices-modal-security-note">
                <WalletText message="Confirm your current authentication method to add or remove methods." />
              </p>
              <button
                type="button"
                className="seams-linked-devices-modal-secondary seams-account-menu-wide-button"
                disabled={actionInProgress}
                onClick={() => void unlockOwnerSession()}
              >
                {actionState.kind === 'unlocking' ? (
                  <WalletText message="Unlocking…" />
                ) : (
                  <WalletText message="Unlock wallet" />
                )}
              </button>
            </section>
          ) : null}

          {actionState.kind === 'error' ? (
            <div className="seams-linked-devices-modal-error" role="alert">
              <WalletText copy={actionState.message} />
            </div>
          ) : null}

          <div className="seams-linked-devices-modal-live" role="status" aria-live="polite">
            <WalletText copy={announcement} />
          </div>
        </div>
      </AuthenticationMethodsView>
    </AccountMenuDialogFrame>
  );
};

export default AuthenticationMethodsModal;

function isVoiceIdPlugin(plugin: { kind: string }): boolean {
  return plugin.kind === 'voiceid';
}
