import { asRecordOrArray } from '@shared/utils/validation';

type CredentialWithExtensionOutputs = {
  response?: unknown;
  clientExtensionResults?: unknown;
};

function getPrfResultsFromCredential(credential: unknown): {
  first?: string;
  second?: string;
} {
  try {
    const credentialRecord = asRecordOrArray(credential);
    const clientExtensionResults = asRecordOrArray(credentialRecord?.clientExtensionResults);
    const prf = asRecordOrArray(clientExtensionResults?.prf);
    const results = asRecordOrArray(prf?.results);
    if (!results) return {};

    const first = typeof results.first === 'string' ? results.first.trim() : '';
    const second = typeof results.second === 'string' ? results.second.trim() : '';

    return {
      ...(first ? { first } : {}),
      ...(second ? { second } : {}),
    };
  } catch {
    return {};
  }
}

export function getPrfFirstB64uFromCredential(credential: unknown): string | null {
  return getPrfResultsFromCredential(credential).first ?? null;
}

export function redactCredentialExtensionOutputs<C extends CredentialWithExtensionOutputs>(
  credential: C,
): C {
  const response = credential.response;
  const responseWithoutExtensions =
    response && typeof response === 'object'
      ? (() => {
          const cloned = { ...(response as Record<string, unknown>) };
          if ('clientExtensionResults' in cloned) cloned.clientExtensionResults = null;
          return cloned;
        })()
      : response;

  return {
    ...credential,
    response: responseWithoutExtensions,
    clientExtensionResults: null,
  } as C;
}
