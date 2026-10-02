import { alphabetizeStringify, sha256HexUtf8 } from '@shared/utils/digests';
import {
  createRegistrationSetupOperationId,
  parseRegistrationSetupOperationId,
} from '@shared/utils/registrationSetupOperation';
import { isPlainObject, requireCanonicalString } from '@shared/utils/validation';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import type {
  RegisterWalletInput,
  RegistrationAuthMethodInput,
} from '@shared/utils/registrationAuthMethodInput';
import type { RegistrationSignerSetSelection } from '@shared/utils/registrationSignerPlan';
import { SEAMS_WALLET_STORES } from '../schemaNames';
import { seamsWalletDB } from '../singletons';
import type { SeamsWalletDBManager } from './manager';

type SetupAttempt = {
  readonly operationId: string;
  readonly scopeDigest: string;
  readonly requestDigest: string;
} & (
  | {
      readonly state: 'pending';
      readonly walletId?: never;
      readonly registrationCeremonyId?: never;
    }
  | {
      readonly state: 'accepted';
      readonly walletId: WalletId;
      readonly registrationCeremonyId: string;
    }
);

const PREFIX = 'wallet_registration_setup:';

function storageKey(scopeDigest: string, requestDigest: string): string {
  return `${PREFIX}${scopeDigest}:${requestDigest}`;
}

function parseAttempt(raw: unknown): SetupAttempt {
  if (!isPlainObject(raw) || !isPlainObject(raw.value)) {
    throw new Error('Registration setup journal is invalid');
  }
  const value = raw.value;
  const scopeDigest = requireCanonicalString(value.scopeDigest, 'Registration setup scope digest');
  const requestDigest = requireCanonicalString(
    value.requestDigest,
    'Registration setup request digest',
  );
  const operationId = parseRegistrationSetupOperationId(value.operationId);
  if (
    !operationId ||
    !/^[a-f0-9]{64}$/u.test(scopeDigest) ||
    !/^[a-f0-9]{64}$/u.test(requestDigest) ||
    raw.key !== storageKey(scopeDigest, requestDigest)
  ) {
    throw new Error('Registration setup journal scope is invalid');
  }
  if (value.state === 'pending' && !('walletId' in value) && !('registrationCeremonyId' in value)) {
    return { state: 'pending', operationId, scopeDigest, requestDigest };
  }
  if (value.state === 'accepted') {
    const walletId = parseWalletId(value.walletId);
    if (walletId.ok) {
      return {
        state: 'accepted',
        operationId,
        scopeDigest,
        requestDigest,
        walletId: walletId.value,
        registrationCeremonyId: requireCanonicalString(
          value.registrationCeremonyId,
          'Registration setup ceremony',
        ),
      };
    }
  }
  throw new Error('Registration setup journal state is invalid');
}

export async function registrationSetupScopeDigest(input: {
  readonly relayerUrl: string;
  readonly publishableKey: string;
  readonly environmentId: string;
}): Promise<string> {
  return sha256HexUtf8(
    alphabetizeStringify({
      relayerUrl: input.relayerUrl.replace(/\/+$/u, ''),
      publishableKey: input.publishableKey,
      environmentId: input.environmentId,
    }),
  );
}

function ignoreAbortedTransaction(): void {}

export class RegistrationSetupRepository {
  constructor(private readonly manager: SeamsWalletDBManager) {}

  async begin(
    scopeDigest: string,
    request: {
      readonly wallet: RegisterWalletInput;
      readonly authMethod: RegistrationAuthMethodInput;
      readonly signerSelection: RegistrationSignerSetSelection;
    },
  ): Promise<SetupAttempt> {
    const requestDigest = await sha256HexUtf8(alphabetizeStringify(request));
    const key = storageKey(scopeDigest, requestDigest);
    const candidate: SetupAttempt = {
      state: 'pending',
      operationId: createRegistrationSetupOperationId(),
      scopeDigest,
      requestDigest,
    };
    const database = await this.manager.getDB();
    const transaction = database.transaction(SEAMS_WALLET_STORES.appState, 'readwrite');
    const stored: unknown = await transaction.store.get(key);
    const attempt = stored === undefined ? candidate : parseAttempt(stored);
    if (stored === undefined) await transaction.store.put({ key, value: attempt });
    await transaction.done;
    return attempt;
  }

  async accept(
    attempt: SetupAttempt,
    response: { readonly walletId: WalletId; readonly registrationCeremonyId: string },
  ): Promise<void> {
    const key = storageKey(attempt.scopeDigest, attempt.requestDigest);
    const database = await this.manager.getDB();
    const transaction = database.transaction(SEAMS_WALLET_STORES.appState, 'readwrite');
    const stored = parseAttempt(await transaction.store.get(key));
    if (
      stored.operationId !== attempt.operationId ||
      (stored.state === 'accepted' &&
        (stored.walletId !== response.walletId ||
          stored.registrationCeremonyId !== response.registrationCeremonyId))
    ) {
      transaction.abort();
      await transaction.done.catch(ignoreAbortedTransaction);
      throw new Error('Registration setup response changed its operation, wallet or ceremony');
    }
    const accepted: SetupAttempt = {
      state: 'accepted',
      operationId: stored.operationId,
      scopeDigest: stored.scopeDigest,
      requestDigest: stored.requestDigest,
      walletId: response.walletId,
      registrationCeremonyId: response.registrationCeremonyId,
    };
    await transaction.store.put({ key, value: accepted });
    await transaction.done;
  }

  async complete(input: {
    readonly walletId: WalletId;
    readonly registrationCeremonyId: string;
  }): Promise<void> {
    const database = await this.manager.getDB();
    const transaction = database.transaction(SEAMS_WALLET_STORES.appState, 'readwrite');
    const records = await transaction.store.getAll(IDBKeyRange.bound(PREFIX, `${PREFIX}\uffff`));
    const attempts = records.map(parseAttempt);
    for (const attempt of attempts) {
      if (
        attempt.state === 'accepted' &&
        attempt.walletId === input.walletId &&
        attempt.registrationCeremonyId === input.registrationCeremonyId
      ) {
        await transaction.store.delete(storageKey(attempt.scopeDigest, attempt.requestDigest));
      }
    }
    await transaction.done;
  }
}

export const registrationSetupRepository = new RegistrationSetupRepository(seamsWalletDB);
