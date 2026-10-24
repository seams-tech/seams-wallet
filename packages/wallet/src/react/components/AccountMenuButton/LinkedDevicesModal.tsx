import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletDisplayText, walletText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';
import React, { useEffect } from 'react';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';
import type {
  LinkedDeviceSummaryV1,
  LinkedOwnerCredentialMetadataV1,
  OwnerDeviceSummaryV1,
} from '@shared/device-linking';
import type { WalletAuthMethodBinding } from '@shared/utils/walletCapabilityBindings';
import { useSeams } from '../../context';
import { AccountMenuDialogFrame } from './AccountMenuDialog';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import { LaptopIcon } from './icons/LaptopIcon';
import { LockIcon } from './icons/LockIcon';
import { MailIcon } from './icons/MailIcon';
import { SmartphoneIcon } from './icons/SmartphoneIcon';
import './LinkedDevicesModal.css';

interface LinkedDevicesModalProps {
  walletId: string | null;
  isOpen: boolean;
  onClose: () => void;
  presentation: 'page' | 'embedded';
}

type LinkedDevicesLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; devices: readonly NumberedWalletDevice[] }
  | { kind: 'error'; message: string };

/**
 * One card in the list: either a founding owner passkey (registered or
 * recovered directly, removable only through auth-method revocation) or a
 * linked-device enrollment (removable here).
 */
type WalletDeviceView =
  | { readonly kind: 'owner'; readonly owner: OwnerDeviceSummaryV1 }
  | { readonly kind: 'linked'; readonly device: LinkedDeviceSummaryV1 };

type NumberedWalletDevice = {
  readonly view: WalletDeviceView;
  readonly deviceNumber: number;
};

type RevokeState =
  | { kind: 'idle' }
  | { kind: 'confirming'; walletAuthMethodId: string }
  | { kind: 'working'; walletAuthMethodId: string }
  | { kind: 'error'; message: string };

function assertNeverWalletAuthMethodBinding(value: never): never {
  throw new Error(`Unsupported wallet auth-method binding kind: ${String(value)}`);
}

function assertRevokeSourceMethod(
  binding: WalletAuthMethodBinding,
  walletId: string,
  targetWalletAuthMethodId: string,
): void {
  switch (binding.kind) {
    case 'passkey':
      if (String(binding.scope.wallet.walletId) !== walletId) {
        throw new Error('Unlock this wallet with a sibling authentication method first.');
      }
      if (String(binding.walletAuthMethodId) === targetWalletAuthMethodId) {
        throw new Error('Unlock with the sibling authentication method before removing this one.');
      }
      return;
    case 'voiceid':
    case 'email_otp':
      if (String(binding.wallet.walletId) !== walletId) {
        throw new Error('Unlock this wallet with a sibling authentication method first.');
      }
      if (String(binding.walletAuthMethodId) === targetWalletAuthMethodId) {
        throw new Error('Unlock with the sibling authentication method before removing this one.');
      }
      return;
  }
  return assertNeverWalletAuthMethodBinding(binding);
}

function viewCreatedAtMs(view: WalletDeviceView): number {
  return view.kind === 'owner' ? view.owner.createdAtMs : view.device.createdAtMs;
}

function viewLastActivityAtMs(view: WalletDeviceView): number {
  return view.kind === 'owner' ? view.owner.lastActivityAtMs : view.device.lastActivityAtMs;
}

function viewCredential(view: WalletDeviceView): LinkedOwnerCredentialMetadataV1 {
  return view.kind === 'owner' ? view.owner.credential : view.device.credential;
}

/**
 * The card's stable identity for expand/remove state. Linked devices carry a
 * LinkedDeviceId; founding owners have only their credential.
 */
function viewId(view: WalletDeviceView): string {
  return view.kind === 'owner'
    ? String(view.owner.credential.walletAuthMethodId)
    : String(view.device.deviceId);
}

/** Identifier used only in accessibility announcements — never rendered. */
function viewDisplayId(view: WalletDeviceView): string {
  return view.kind === 'owner'
    ? String(view.owner.credential.credentialIdB64u ?? view.owner.credential.walletAuthMethodId)
    : String(view.device.deviceId);
}

/**
 * Founding owners and linked enrollments in one numbered list, newest first.
 * Device numbers still follow enrollment order (oldest = Device 1) so a
 * device keeps its spoken number as newer ones are added.
 * Revoked devices are historical records, not devices the owner can manage.
 */
function visibleWalletDevices(
  ownerDevices: readonly OwnerDeviceSummaryV1[],
  devices: readonly LinkedDeviceSummaryV1[],
): readonly NumberedWalletDevice[] {
  const views: WalletDeviceView[] = [
    ...ownerDevices.map((owner): WalletDeviceView => ({ kind: 'owner', owner })),
    ...devices.map((device): WalletDeviceView => ({ kind: 'linked', device })),
  ];
  return views
    .sort(
      (left, right) =>
        viewCreatedAtMs(left) - viewCreatedAtMs(right) || viewId(left).localeCompare(viewId(right)),
    )
    .map((view, index) => ({ view, deviceNumber: index + 1 }))
    .filter(({ view }) => view.kind === 'owner' || view.device.state !== 'revoked')
    .reverse();
}

function isActiveWalletMethod(view: WalletDeviceView): boolean {
  return view.kind === 'owner' || view.device.state === 'active';
}

function canRemoveWalletMethod(
  target: WalletDeviceView,
  devices: readonly NumberedWalletDevice[],
): boolean {
  const activeMethodCount = devices.filter(({ view }) => isActiveWalletMethod(view)).length;
  return isActiveWalletMethod(target) ? activeMethodCount > 1 : activeMethodCount > 0;
}

/**
 * The one chip a row may carry. Silence is the healthy state: an active
 * method shows nothing, the session's own method shows "In use now", and
 * only genuinely interesting lifecycle states get a label.
 */
function standingChip(
  view: WalletDeviceView,
  isSelectedMethod: boolean,
): { readonly label: string; readonly tone: 'active' | 'pending' | 'off' } | null {
  if (isSelectedMethod) return { label: 'In use now', tone: 'active' };
  if (view.kind === 'owner') return null;
  switch (view.device.state) {
    case 'active':
      return null;
    case 'provisioning':
      return { label: 'Finishing setup', tone: 'pending' };
    case 'suspended':
      return { label: 'Paused', tone: 'off' };
    case 'expired':
      return { label: 'Expired', tone: 'off' };
    case 'revoked':
      return { label: 'Removed', tone: 'off' };
  }
}

/** Raw lifecycle state, exposed as a data attribute for tests and tooling. */
function deviceStateAttr(view: WalletDeviceView): string {
  return view.kind === 'owner' ? 'active' : view.device.state;
}

/** "today" / "yesterday" / a plain date — never a timestamp with seconds. */
function friendlyDay(value: number, now: number, locale: WalletLocale): string {
  const then = new Date(value);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysAgo = Math.floor((startOfToday.getTime() - then.setHours(0, 0, 0, 0)) / dayMs);
  if (daysAgo <= 0) return walletText(locale, 'today');
  if (daysAgo === 1) return walletText(locale, 'yesterday');
  if (daysAgo < 7) return walletText(locale, '{value0} days ago', { value0: daysAgo });
  return new Date(value).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function shortDisplayId(value: string): string {
  return value.length <= 12 ? value : `…${value.slice(-8)}`;
}

/** The row title: what the person recognizes, never the wire model. */
function credentialDescription(credential: LinkedOwnerCredentialMetadataV1): string {
  switch (credential.kind) {
    case 'passkey':
      return credential.device.label;
    case 'email_otp':
      return 'Email OTP';
    case 'voiceid':
      return 'VoiceID';
  }
}

/**
 * One quiet metadata sentence per row, led by the device number — the same
 * number the remove announcements speak, so a person can tell twins apart.
 * Titles can repeat — two platform passkeys share a label — so when this
 * row's title collides with another visible row, the created-at day is
 * appended as a second human disambiguator.
 */
function deviceMetaLine(
  view: WalletDeviceView,
  deviceNumber: number,
  titleCollides: boolean,
  now: number,
  locale: WalletLocale,
): string {
  const credential = viewCredential(view);
  const parts: string[] = [walletText(locale, 'Device {value0}', { value0: deviceNumber })];
  if (credential.kind === 'passkey') {
    parts.push(walletText(locale, credential.device.synced ? 'Synced passkey' : 'Passkey'));
    const provider = credential.device.providerLabel ?? credential.device.provider;
    if (provider) parts.push(provider);
  } else if (credential.kind === 'email_otp') {
    parts.push(walletText(locale, 'Email OTP'));
  } else {
    parts.push(walletDisplayText(locale, 'VoiceID'));
  }
  if (titleCollides)
    parts.push(
      walletText(locale, 'Added {value0}', {
        value0: friendlyDay(viewCreatedAtMs(view), now, locale),
      }),
    );
  parts.push(
    walletText(locale, 'Last used {value0}', {
      value0: friendlyDay(viewLastActivityAtMs(view), now, locale),
    }),
  );
  return parts.join(' · ');
}

/** Icon for the row: what kind of thing holds this credential. */
function credentialIcon(credential: LinkedOwnerCredentialMetadataV1): React.ReactElement {
  if (credential.kind === 'email_otp') return <MailIcon size={20} strokeWidth={1.75} />;
  if (credential.kind === 'voiceid') return <LaptopIcon size={20} strokeWidth={1.75} />;
  return credential.device.os === 'ios' || credential.device.os === 'android' ? (
    <SmartphoneIcon size={20} strokeWidth={1.75} />
  ) : (
    <LaptopIcon size={20} strokeWidth={1.75} />
  );
}

/** "sign in with ___ first" — names the actual sibling instead of "the sibling method". */
function siblingMethodName(siblings: readonly WalletDeviceView[], locale: WalletLocale): string {
  if (siblings.length === 1) {
    const credential = viewCredential(siblings[0]);
    if (credential.kind === 'email_otp') return walletText(locale, 'your email code');
    if (credential.kind === 'voiceid') return walletDisplayText(locale, 'your VoiceID method');
    return walletText(locale, 'your "{value0}" passkey', { value0: credential.device.label });
  }
  if (siblings.every((view) => viewCredential(view).kind === 'email_otp')) {
    return walletText(locale, 'your email code');
  }
  return walletText(locale, 'another sign-in method');
}

function selectedMethodRemovalHint(
  target: WalletDeviceView,
  devices: readonly NumberedWalletDevice[],
  locale: WalletLocale,
): string {
  const targetMethodId = String(viewCredential(target).walletAuthMethodId);
  const siblings = devices
    .map(({ view }) => view)
    .filter(
      (view) =>
        isActiveWalletMethod(view) &&
        String(viewCredential(view).walletAuthMethodId) !== targetMethodId,
    );
  const self = walletText(
    locale,
    viewCredential(target).kind === 'email_otp' ? 'your email code' : 'this passkey',
  );
  return walletText(
    locale,
    "You're signed in with {value0}. To remove it, sign in with {value1} first.",
    { value0: self, value1: siblingMethodName(siblings, locale) },
  );
}

function deviceDescription(view: WalletDeviceView, deviceNumber: number): string {
  return `Device ${deviceNumber}, ${credentialDescription(viewCredential(view))} (ID ${shortDisplayId(viewDisplayId(view))})`;
}

function linkedDevicesLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Try again.';
}

const LINKED_DEVICES_LOAD_TIMEOUT_MS = 20_000;

function withLinkedDevicesLoadTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Loading your devices timed out. Try again.'));
    }, LINKED_DEVICES_LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export const LinkedDevicesModal: React.FC<LinkedDevicesModalProps> = ({
  walletId,
  isOpen,
  onClose,
  presentation,
}) => {
  const locale = useWalletLocale();
  const { seams, loginState } = useSeams();
  const [loadState, setLoadState] = React.useState<LinkedDevicesLoadState>({ kind: 'idle' });
  const [revokeState, setRevokeState] = React.useState<RevokeState>({ kind: 'idle' });
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const loadSeq = React.useRef(0);
  const seamsRef = React.useRef(seams);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  seamsRef.current = seams;

  const loadDevices = React.useCallback(async () => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    if (!walletId) {
      setLoadState({ kind: 'error', message: 'Wallet identity is unavailable. Try again.' });
      return;
    }
    setLoadState({ kind: 'loading' });
    try {
      const result = await withLinkedDevicesLoadTimeout(
        seamsRef.current.devices.list({ walletId, limit: 50, cursor: null }),
      );
      if (loadSeq.current === seq) {
        setLoadState({
          kind: 'loaded',
          devices: visibleWalletDevices(result.ownerDevices, result.devices),
        });
      }
    } catch (error: unknown) {
      if (loadSeq.current === seq) {
        setLoadState({ kind: 'error', message: linkedDevicesLoadErrorMessage(error) });
      }
    }
  }, [walletId]);

  useEffect(() => {
    if (!isOpen) {
      loadSeq.current += 1;
      setLoadState({ kind: 'idle' });
      setSelectedDeviceId(null);
      setRevokeState({ kind: 'idle' });
      setAnnouncement('');
      return;
    }
    void loadDevices();
  }, [isOpen, loadDevices]);

  const revokeMethod = React.useCallback(
    async (view: WalletDeviceView, deviceNumber: number) => {
      if (!walletId) return;
      const walletAuthMethodId = String(viewCredential(view).walletAuthMethodId);
      const description = deviceDescription(view, deviceNumber);
      try {
        if (!loginState.isLoggedIn || loginState.currentAuthMethod.kind !== 'selected') {
          throw new Error('Unlock this wallet with a sibling authentication method first.');
        }
        assertRevokeSourceMethod(
          loginState.currentAuthMethod.binding,
          walletId,
          walletAuthMethodId,
        );
        setRevokeState({ kind: 'working', walletAuthMethodId });
        setAnnouncement(`Removing ${description}…`);
        await seams.registration.removeAuthMethod({
          walletId,
          walletAuthMethodId,
        });
        setAnnouncement(`${description} can no longer use this wallet.`);
        setRevokeState({ kind: 'idle' });
        await loadDevices();
      } catch (error: unknown) {
        setRevokeState({ kind: 'error', message: linkedDevicesLoadErrorMessage(error) });
      }
    },
    [loadDevices, loginState, seams, walletId],
  );

  if (!isOpen) return null;

  const devices = loadState.kind === 'loaded' ? loadState.devices : [];
  const selectedDevice = devices.find((entry) => viewId(entry.view) === selectedDeviceId);
  const visibleDevices = selectedDevice ? [selectedDevice] : devices;
  const showEmpty = loadState.kind === 'loaded' && devices.length === 0;
  const selectedWalletAuthMethodId =
    loginState.isLoggedIn && loginState.currentAuthMethod.kind === 'selected'
      ? String(loginState.currentAuthMethod.binding.walletAuthMethodId)
      : null;

  return (
    <AccountMenuDialogFrame
      presentation={presentation}
      onClose={selectedDevice ? setSelectedDeviceId.bind(null, null) : onClose}
      dialogRef={dialogRef}
      contentClassName="seams-linked-devices-inventory-content"
      titleId="seams-linked-devices-modal-title"
      title={walletDisplayText(locale, selectedDevice ? 'Device details' : 'Linked devices')}
    >
      {selectedDevice ? (
        <AccountMenuDeviceDetails
          title={walletDisplayText(
            locale,
            credentialDescription(viewCredential(selectedDevice.view)),
          )}
          description={walletDisplayText(
            locale,
            deviceMetaLine(
              selectedDevice.view,
              selectedDevice.deviceNumber,
              false,
              Date.now(),
              locale,
            ),
          )}
          details={[{ label: 'Status', value: deviceStateAttr(selectedDevice.view) }]}
        />
      ) : (
        <p className="seams-linked-devices-modal-subtitle">
          <WalletText message="Anything listed here can unlock this wallet." />
        </p>
      )}

      <div className="seams-linked-devices-modal-body">
        {loadState.kind === 'loading' || loadState.kind === 'idle' ? (
          <div className="seams-linked-devices-modal-placeholder" role="status">
            <WalletText message="Checking your devices…" />
          </div>
        ) : null}

        {loadState.kind === 'error' ? (
          <div className="seams-linked-devices-modal-placeholder" role="alert">
            <span>
              <WalletText message="Unable to load your devices:" />{' '}
              <WalletText copy={loadState.message} />
            </span>
            <button
              type="button"
              className="seams-linked-devices-modal-secondary"
              onClick={() => void loadDevices()}
            >
              <WalletText message="Try again" />
            </button>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="seams-linked-devices-modal-placeholder">
            <WalletText message="No other devices are using this wallet." />
          </div>
        ) : null}

        {devices.length > 0 ? (
          <ul className="seams-linked-devices-modal-list seams-linked-devices-modal-list--grouped">
            {visibleDevices.map(({ view, deviceNumber }) => {
              const cardId = viewId(view);
              const title = credentialDescription(viewCredential(view));
              const titleCollides = devices.some(
                (other) =>
                  viewId(other.view) !== cardId &&
                  credentialDescription(viewCredential(other.view)) === title,
              );
              const walletAuthMethodId = String(viewCredential(view).walletAuthMethodId);
              const isSelectedMethod = walletAuthMethodId === selectedWalletAuthMethodId;
              const chip = standingChip(view, isSelectedMethod);
              const hasRemovableSibling = canRemoveWalletMethod(view, devices);
              const confirming =
                revokeState.kind === 'confirming' &&
                revokeState.walletAuthMethodId === walletAuthMethodId;
              const working =
                revokeState.kind === 'working' &&
                revokeState.walletAuthMethodId === walletAuthMethodId;
              const revocationInProgress = revokeState.kind === 'working';
              const showRemoveButton = hasRemovableSibling && !isSelectedMethod && !confirming;
              if (presentation === 'embedded' && !selectedDevice) {
                return (
                  <AuthenticationMethodRow
                    key={cardId}
                    kind={viewCredential(view).kind}
                    icon={credentialIcon(viewCredential(view))}
                    title={walletDisplayText(locale, title)}
                    description={walletDisplayText(
                      locale,
                      deviceMetaLine(view, deviceNumber, titleCollides, Date.now(), locale),
                    )}
                    onSelect={setSelectedDeviceId.bind(null, cardId)}
                  />
                );
              }
              return (
                <li
                  key={cardId}
                  className="seams-linked-devices-modal-item seams-linked-devices-modal-item--row"
                  data-detail={selectedDevice ? 'true' : undefined}
                  data-device-kind={view.kind}
                  data-device-state={deviceStateAttr(view)}
                >
                  <span className="seams-linked-devices-modal-item-icon" aria-hidden="true">
                    {credentialIcon(viewCredential(view))}
                  </span>
                  <div className="seams-linked-devices-modal-item-content">
                    <div className="seams-linked-devices-modal-item-main">
                      <span className="seams-linked-devices-modal-item-name">
                        <WalletText copy={title} />
                      </span>
                      {chip ? (
                        <span className={`seams-linked-devices-modal-standing tone-${chip.tone}`}>
                          <WalletText copy={chip.label} />
                        </span>
                      ) : null}
                    </div>
                    <div className="seams-linked-devices-modal-item-detail">
                      <WalletText
                        copy={deviceMetaLine(view, deviceNumber, titleCollides, Date.now(), locale)}
                      />
                    </div>
                    {isSelectedMethod && hasRemovableSibling ? (
                      <div className="seams-linked-devices-modal-hint">
                        <LockIcon size={15} strokeWidth={1.75} />
                        <span>
                          <WalletText copy={selectedMethodRemovalHint(view, devices, locale)} />
                        </span>
                      </div>
                    ) : null}
                    {confirming ? (
                      <div className="seams-linked-devices-modal-confirm">
                        <span>
                          <WalletText
                            message="Remove {value0}? It will lose access right away."
                            values={{ value0: title }}
                          />
                        </span>
                        <div className="seams-linked-devices-modal-confirm-actions">
                          <button
                            type="button"
                            className="seams-linked-devices-modal-secondary"
                            onClick={() => setRevokeState({ kind: 'idle' })}
                          >
                            <WalletText message="Keep it" />
                          </button>
                          <button
                            type="button"
                            className="seams-linked-devices-modal-danger"
                            onClick={() => void revokeMethod(view, deviceNumber)}
                          >
                            <WalletText message="Yes, remove" />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {showRemoveButton ? (
                    <button
                      type="button"
                      className="seams-linked-devices-modal-secondary seams-linked-devices-modal-remove"
                      disabled={revocationInProgress}
                      aria-label={walletDisplayText(
                        locale,
                        `Remove ${deviceDescription(view, deviceNumber)}`,
                      )}
                      onClick={() => setRevokeState({ kind: 'confirming', walletAuthMethodId })}
                    >
                      {working ? (
                        <WalletText message="Removing…" />
                      ) : (
                        <WalletText message="Remove" />
                      )}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {revokeState.kind === 'error' ? (
          <div className="seams-linked-devices-modal-error" role="alert">
            <WalletText copy={revokeState.message} />
          </div>
        ) : null}

        <div className="seams-linked-devices-modal-live" role="status" aria-live="polite">
          <WalletText copy={announcement} />
        </div>
      </div>
    </AccountMenuDialogFrame>
  );
};

export default LinkedDevicesModal;
