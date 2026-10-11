import {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuExternalAuthRequestIdFromBoundary,
  hostedAuthMenuSessionIdFromBoundary,
  type HostedAuthMenuExternalAuthRequest,
  type HostedAuthMenuExternalAuthResolutionInput,
  type HostedAuthMenuOutcome,
  type SeamsWeb,
} from './index';

declare const seams: SeamsWeb;

const authMenuSessionId = hostedAuthMenuSessionIdFromBoundary('auth-menu-bridge-session');
const externalAuthRequestId = hostedAuthMenuExternalAuthRequestIdFromBoundary(
  'auth-menu-bridge-external-request',
);
if (!authMenuSessionId || !externalAuthRequestId) {
  throw new Error('Hosted auth-menu bridge fixture identity is invalid');
}

const request = buildHostedAuthMenuOpenRequest({ authMenuSessionId });
const outcome: Promise<HostedAuthMenuOutcome> = seams.authMenu.open(request);
void outcome;

const unsubscribe = seams.authMenu.onExternalAuthRequest(
  (externalRequest: HostedAuthMenuExternalAuthRequest) => {
    const resolution: HostedAuthMenuExternalAuthResolutionInput = {
      kind: 'hosted_auth_menu_external_auth_resolution_v1',
      authMenuSessionId: externalRequest.authMenuSessionId,
      externalAuthRequestId: externalRequest.externalAuthRequestId,
      evidence: { kind: 'cancelled', reason: 'user_cancelled' },
    };
    void seams.authMenu.resolveExternalAuth(resolution);
  },
);
void unsubscribe;

void seams.authMenu.cancel({ authMenuSessionId });

void seams.authMenu.resolveExternalAuth({
  kind: 'hosted_auth_menu_external_auth_resolution_v1',
  authMenuSessionId,
  externalAuthRequestId,
  // @ts-expect-error The app bridge cannot provide the wallet-owned PM_OPEN request identity.
  requestId: 'wallet-owned-request-id',
  evidence: { kind: 'cancelled', reason: 'user_cancelled' },
});

// @ts-expect-error Hosted UI operations belong to the authMenu namespace.
seams.openHostedAuthMenu(request);
// @ts-expect-error Hosted UI cancellation has one public name.
seams.cancelHostedAuthMenu({ authMenuSessionId });
// @ts-expect-error External authentication subscription belongs to authMenu.
seams.onHostedAuthMenuExternalAuthRequest(() => {});
// @ts-expect-error External authentication resolution belongs to authMenu.
seams.resolveHostedAuthMenuExternalAuth({});
const stopEvents: () => void = seams.events.subscribe(() => {});
void stopEvents;
// @ts-expect-error General event subscriptions belong to events.
seams.onSdkLifecycleEvent(() => {});
