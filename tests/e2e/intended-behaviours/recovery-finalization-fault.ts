import type { Route } from '@playwright/test';

export type RecoveryFinalizeFailure = { injected: boolean };

export async function failFirstRecoveryFinalization(
  failure: RecoveryFinalizeFailure,
  route: Route,
): Promise<void> {
  if (failure.injected) {
    await route.continue();
    return;
  }
  failure.injected = true;
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'temporary_failure' }),
  });
}

export async function concealFirstRecoveryFinalizationResponse(
  failure: RecoveryFinalizationResponseLoss,
  route: Route,
): Promise<void> {
  /* The lost-response contract needs exactly one committed finalization.
     The flag flips before the server round-trip so a concurrent or
     straggling duplicate submission is refused without reaching the server
     instead of committing the operation the replay is expected to find. */
  if (failure.injected) {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, code: 'response_lost' }),
    });
    return;
  }
  failure.injected = true;
  const status = await failure.commit(route);
  if (status !== 200) {
    throw new Error(`Recovery finalization failed before response loss: ${status}`);
  }
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'response_lost' }),
  });
}

export type CommitRecoveryFinalization = (route: Route) => Promise<number>;

type RecoveryFinalizationResponseLoss = {
  injected: boolean;
  readonly commit: CommitRecoveryFinalization;
};

export function createRecoveryFinalizationResponseLoss(
  commit: CommitRecoveryFinalization = fetchRecoveryFinalizationStatus,
): RecoveryFinalizationResponseLoss {
  return { injected: false, commit };
}

export async function fetchRecoveryFinalizationStatus(route: Route): Promise<number> {
  const response = await route.fetch();
  return response.status();
}
