import type { ConfirmContentDecision } from '@/core/signingEngine/uiConfirm/ui/preact/ConfirmContent';
import type { ConfirmationStatusText } from '@/core/signingEngine/uiConfirm/ui/preact/ConfirmHeader';
import type { PasskeyRegistrationDecision } from '@/core/signingEngine/uiConfirm/ui/preact/PasskeyRegistrationContent';
import type { ConfirmationContentModel } from '@/core/signingEngine/uiConfirm/ui/preact/ConfirmationContent';
import type { ConfirmationDrawerProps } from '@/core/signingEngine/uiConfirm/ui/preact/ConfirmationDrawer';

declare const confirm: () => void;

const preparing: ConfirmContentDecision = { kind: 'preparing' };
const ready: ConfirmContentDecision = { kind: 'ready', onConfirm: confirm };
// @ts-expect-error A pending operation cannot carry a confirmation action.
const pendingWithAction: ConfirmContentDecision = { kind: 'preparing', onConfirm: confirm };
// @ts-expect-error An interactive decision requires its action.
const readyWithoutAction: ConfirmContentDecision = { kind: 'ready' };
// @ts-expect-error Spreading an action into the preparing branch is invalid.
const spreadAction: ConfirmContentDecision = { ...ready, kind: 'preparing' };

void [preparing, ready, pendingWithAction, readyWithoutAction, spreadAction];

const formDecision: ConfirmContentDecision = { kind: 'form', formId: 'email-form' };
// @ts-expect-error A form submission requires an explicit form owner.
const formWithoutOwner: ConfirmContentDecision = { kind: 'form' };
// @ts-expect-error Form submission cannot also invoke a direct confirmation callback.
const formWithCallback: ConfirmContentDecision = { ...ready, kind: 'form', formId: 'email-form' };
void [formDecision, formWithoutOwner, formWithCallback];

const loadingStatus: ConfirmationStatusText = { kind: 'loading' };
const readyStatus: ConfirmationStatusText = { kind: 'ready', text: 'Ethereum' };
// @ts-expect-error A ready status must carry display text.
const missingStatusText: ConfirmationStatusText = { kind: 'ready' };
// @ts-expect-error Loading cannot also carry stale display text.
const staleLoadingText: ConfirmationStatusText = { ...readyStatus, kind: 'loading' };

void [loadingStatus, readyStatus, missingStatusText, staleLoadingText];

const registrationReady: PasskeyRegistrationDecision = { kind: 'ready', onConfirm: confirm };
// @ts-expect-error Creation in progress cannot retain an executable confirmation.
const creatingWithAction: PasskeyRegistrationDecision = { ...registrationReady, kind: 'creating' };
// @ts-expect-error A ready registration requires its activation callback.
const registrationWithoutAction: PasskeyRegistrationDecision = { kind: 'ready' };
void [registrationReady, creatingWithAction, registrationWithoutAction];

declare const registrationContent: Extract<ConfirmationContentModel, { kind: 'registration' }>;
declare const transactionContent: Extract<ConfirmationContentModel, { kind: 'transaction' }>;
// @ts-expect-error A registration cannot carry a transaction branch through a spread.
const mixedContent: ConfirmationContentModel = { ...registrationContent, transaction: transactionContent.transaction };
// @ts-expect-error Email confirmation requires its prompt and submission contract.
const missingEmail: ConfirmationContentModel = { ...transactionContent, prompt: { kind: 'email' } };
void [mixedContent, missingEmail];

type DrawerState = ConfirmationDrawerProps['state'];
const openDrawer: DrawerState = { kind: 'open', interaction: 'ready' };
const closingDrawer: DrawerState = { kind: 'closing', onClosed: confirm };
// @ts-expect-error Closing requires an explicit completion owner.
const closingWithoutOwner: DrawerState = { kind: 'closing' };
// @ts-expect-error Closing cannot retain interactive state through a spread.
const interactiveClosing: DrawerState = { ...openDrawer, kind: 'closing', onClosed: confirm };
// @ts-expect-error An open drawer cannot report close completion.
const openWithClose: DrawerState = { kind: 'open', interaction: 'ready', onClosed: confirm };
void [openDrawer, closingDrawer, closingWithoutOwner, interactiveClosing, openWithClose];
