export type LocalWorkspaceIdentity = {
  organizationName: string;
  organizationId: string;
  projectName: string;
  projectId: string;
  environmentName: 'dev';
  environmentId: string;
};

export type LocalWalletConfig = {
  projectEnvironmentId: string;
  publishableKey: string;
  gatewayUrl: string;
  walletOrigin: string;
  signingWorkerId: string;
};

export type ReadyLocalWorkspace = {
  kind: 'ready';
  identity: LocalWorkspaceIdentity;
  walletConfig: LocalWalletConfig;
};

export type LocalWorkspaceState =
  | { kind: 'empty' }
  | { kind: 'provisioning' }
  | ReadyLocalWorkspace
  | { kind: 'failed'; message: string };

export type ProvisionLocalWorkspaceInput = {
  organizationName: string;
  projectName: string;
};

export type ProvisionLocalWorkspaceResult =
  | { ok: true; workspace: ReadyLocalWorkspace }
  | { ok: false; message: string };

export async function provisionLocalWorkspace(
  input: ProvisionLocalWorkspaceInput,
): Promise<ProvisionLocalWorkspaceResult> {
  try {
    const response = await fetch('/__local-workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json();
    if (!response.ok) return { ok: false, message: parseFailure(body) };
    return { ok: true, workspace: parseReadyWorkspace(body) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Local workspace setup failed',
    };
  }
}

function parseReadyWorkspace(value: unknown): ReadyLocalWorkspace {
  const record = requiredRecord(value, 'setup response');
  if (record.kind !== 'ready') throw new Error('Local setup returned an unexpected state');
  const identity = requiredRecord(record.identity, 'workspace identity');
  const walletConfig = requiredRecord(record.walletConfig, 'Wallet configuration');
  const environmentName = requiredString(identity.environmentName, 'environment name');
  if (environmentName !== 'dev') throw new Error('Local setup must use the dev environment');

  return {
    kind: 'ready',
    identity: {
      organizationName: requiredString(identity.organizationName, 'organisation name'),
      organizationId: requiredString(identity.organizationId, 'organisation id'),
      projectName: requiredString(identity.projectName, 'project name'),
      projectId: requiredString(identity.projectId, 'project id'),
      environmentName,
      environmentId: requiredString(identity.environmentId, 'environment id'),
    },
    walletConfig: {
      projectEnvironmentId: requiredString(
        walletConfig.projectEnvironmentId,
        'project environment id',
      ),
      publishableKey: requiredString(walletConfig.publishableKey, 'publishable key'),
      gatewayUrl: requiredHttpUrl(walletConfig.gatewayUrl, 'Gateway URL'),
      walletOrigin: requiredHttpUrl(walletConfig.walletOrigin, 'Wallet origin'),
      signingWorkerId: requiredString(walletConfig.signingWorkerId, 'signing Worker id'),
    },
  };
}

function parseFailure(value: unknown): string {
  if (!isRecord(value) || value.kind !== 'failed') return 'Local workspace setup failed';
  return requiredString(value.message, 'failure message');
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}`);
  return value;
}

function requiredHttpUrl(value: unknown, label: string): string {
  const parsed = new URL(requiredString(value, label));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ${label}`);
  }
  return parsed.origin;
}
