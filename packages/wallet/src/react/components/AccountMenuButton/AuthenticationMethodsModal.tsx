import React, { useEffect } from 'react';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import type {
  LinkedDeviceSummaryV1,
  LinkedOwnerCredentialMetadataV1,
  OwnerDeviceSummaryV1,
} from '@shared/device-linking';
import type { WalletAuthMethodBinding } from '@shared/utils/walletCapabilityBindings';
import { useSeams } from '../../context';
import { AccountMenuDialogFrame, useAccountMenuDialogKeyboard } from './AccountMenuDialog';
import { PlusIcon } from './icons/PlusIcon';
import './LinkedDevicesModal.css';

interface AuthenticationMethodsModalProps {
  readonly walletId: string | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly presentation?: 'modal' | 'page' | 'embedded';
  readonly onLinkDevice?: () => void;
}

type AuthenticationMethodView = {
  readonly kind: LinkedOwnerCredentialMetadataV1['kind'];
  readonly walletAuthMethodId: string;
  readonly presentation:
    | {
        readonly kind: 'passkey';
        readonly description: string;
      }
    | {
        readonly kind: 'email_otp';
        readonly emailAddress: string | null;
      };
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
          description: provider ? `${provider} passkey` : credential.device.label,
        },
      };
    }
    case 'email_otp':
      return {
        kind: 'email_otp',
        walletAuthMethodId: String(credential.walletAuthMethodId),
        presentation: {
          kind: 'email_otp',
          emailAddress: String(credential.email),
        },
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
    case 'email_otp':
      return {
        kind: 'email_otp',
        walletAuthMethodId: String(binding.walletAuthMethodId),
        presentation: { kind: 'email_otp', emailAddress: null },
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

const FOCUSABLE_DIALOG_ELEMENTS =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function methodTitle(method: AuthenticationMethodView): string {
  return method.kind === 'passkey' ? 'Passkey' : 'Email OTP';
}

function methodDescription(method: AuthenticationMethodView): string {
  switch (method.presentation.kind) {
    case 'passkey':
      return method.presentation.description;
    case 'email_otp':
      return method.presentation.emailAddress ?? 'Email OTP on this device';
  }
}

export const AuthenticationMethodsModal: React.FC<AuthenticationMethodsModalProps> = ({
  walletId,
  isOpen,
  onClose,
  presentation = 'modal',
  onLinkDevice,
}) => {
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

  useAccountMenuDialogKeyboard({
    isOpen,
    presentation,
    onClose,
    dialogRef,
    focusableSelector: FOCUSABLE_DIALOG_ELEMENTS,
  });

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
      if (presentation !== 'modal') {
        setActionState({ kind: 'idle' });
        await loadInventory();
      } else {
        onClose();
      }
    } catch (error: unknown) {
      setActionState({ kind: 'error', message: errorMessage(error) });
    }
  }, [actionState, loadInventory, onClose, presentation, walletId]);

  if (!isOpen) return null;

  const inventory =
    loadState.kind === 'loaded' || loadState.kind === 'loading' ? loadState.inventory : null;
  const methods = inventory?.methods ?? [];
  const hasPasskey = methods.some((method) => method.kind === 'passkey');
  const hasEmailOtp = methods.some((method) => method.kind === 'email_otp');
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
      title="Authentication methods"
      closeLabel="Close authentication methods"
    >
      <p className="seams-auth-methods-modal-intro">Authentication methods for this wallet.</p>

      <div className="seams-linked-devices-modal-body" aria-busy={loadState.kind === 'loading'}>
        {loadState.kind === 'idle' ? (
          <div className="seams-linked-devices-modal-placeholder" role="status">
            Checking authentication methods…
          </div>
        ) : null}

        {loadState.kind === 'error' ? (
          <div className="seams-linked-devices-modal-placeholder" role="alert">
            <span>Unable to load authentication methods: {loadState.message}</span>
            <button
              type="button"
              className="seams-linked-devices-modal-secondary"
              onClick={() => void loadInventory()}
            >
              Try again
            </button>
          </div>
        ) : null}

        {inventory ? (
          <section
            className="seams-account-menu-section"
            aria-labelledby="seams-auth-methods-active"
          >
            <h3 id="seams-auth-methods-active" className="seams-account-menu-section-label">
              Active methods
            </h3>
            <ul className="seams-linked-devices-modal-list seams-linked-devices-modal-list--grouped">
              {methods.map((method) => {
                const confirming =
                  actionState.kind === 'confirming_revoke' &&
                  actionState.method.walletAuthMethodId === method.walletAuthMethodId;
                const revoking =
                  actionState.kind === 'revoking' &&
                  actionState.method.walletAuthMethodId === method.walletAuthMethodId;
                return (
                  <AuthenticationMethodRow
                    key={method.walletAuthMethodId}
                    kind={method.kind}
                    title={methodTitle(method)}
                    description={methodDescription(method)}
                    action={
                      !confirming && canManageMethods && methods.length > 1 ? (
                        <button
                          type="button"
                          className="seams-linked-devices-modal-secondary seams-linked-devices-modal-remove"
                          disabled={actionInProgress}
                          aria-label={`Remove ${methodTitle(method)}`}
                          onClick={() => setActionState({ kind: 'confirming_revoke', method })}
                        >
                          {revoking ? 'Removing…' : 'Remove'}
                        </button>
                      ) : null
                    }
                  >
                    {confirming ? (
                      <div className="seams-linked-devices-modal-confirm">
                        <span>
                          Remove {methodTitle(method)} from this device? You will need the other
                          active method to unlock it.
                        </span>
                        <div className="seams-linked-devices-modal-confirm-actions">
                          <button
                            type="button"
                            className="seams-linked-devices-modal-secondary"
                            onClick={() => setActionState({ kind: 'idle' })}
                          >
                            Keep it
                          </button>
                          <button
                            type="button"
                            className="seams-linked-devices-modal-danger"
                            onClick={() => void revokeMethod()}
                          >
                            Remove method
                          </button>
                        </div>
                      </div>
                    ) : methods.length > 1 ? null : (
                      <span className="seams-linked-devices-modal-item-detail">
                        Add another method before removing this one.
                      </span>
                    )}
                  </AuthenticationMethodRow>
                );
              })}
            </ul>
          </section>
        ) : null}

        {inventory && (!hasPasskey || !hasEmailOtp) ? (
          <section className="seams-account-menu-section" aria-labelledby="seams-auth-methods-add">
            <h3 id="seams-auth-methods-add" className="seams-account-menu-section-label">
              Add a method
            </h3>
            {!hasPasskey ? (
              <div className="seams-linked-devices-modal-add-method">
                <button
                  type="button"
                  className="seams-linked-devices-modal-secondary seams-account-menu-wide-button"
                  disabled={actionInProgress || !canManageMethods}
                  onClick={() => void addMethod('passkey')}
                >
                  <PlusIcon size={18} strokeWidth={1.75} />
                  {actionState.kind === 'adding' && actionState.method === 'passkey'
                    ? 'Adding…'
                    : 'Add passkey'}
                </button>
                <p className="seams-linked-devices-modal-security-note">
                  Use a passkey from this device to unlock the wallet.
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
                  <label htmlFor={emailInputId}>Email address</label>
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
                    {actionState.kind === 'adding' && actionState.method === 'email_otp'
                      ? 'Adding…'
                      : 'Add Email OTP'}
                  </button>
                </form>
              </div>
            ) : null}
          </section>
        ) : null}

        {loadState.kind === 'loaded' && inventory?.kind === 'local_selection' ? (
          <section className="seams-linked-devices-modal-add-method">
            <h3>Unlock to manage methods</h3>
            <p className="seams-linked-devices-modal-security-note">
              Confirm your current authentication method to add or remove methods.
            </p>
            <button
              type="button"
              className="seams-linked-devices-modal-secondary seams-account-menu-wide-button"
              disabled={actionInProgress}
              onClick={() => void unlockOwnerSession()}
            >
              {actionState.kind === 'unlocking' ? 'Unlocking…' : 'Unlock wallet'}
            </button>
          </section>
        ) : null}

        {actionState.kind === 'error' ? (
          <div className="seams-linked-devices-modal-error" role="alert">
            {actionState.message}
          </div>
        ) : null}

        {onLinkDevice ? (
          <button type="button" className="seams-account-action primary" onClick={onLinkDevice}>
            Link a device
          </button>
        ) : null}
        <div className="seams-linked-devices-modal-live" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>
    </AccountMenuDialogFrame>
  );
};

export default AuthenticationMethodsModal;
