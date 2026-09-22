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
  | { kind: 'restoring' }
  | { kind: 'restore_failed'; message: string }
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

const savedWorkspaceKey = 'seams-wallet-console-lite.workspace';

export async function restoreLocalWorkspace(): Promise<LocalWorkspaceState> {
  try {
    const response = await fetch('/__local-workspace', { cache: 'no-store' });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(parseFailure(body));
    const record = requiredRecord(body, 'workspace response');
    if (record.kind === 'ready') {
      const workspace = parseReadyWorkspace(record);
      rememberWorkspace(workspace);
      return workspace;
    }
    if (record.kind !== 'empty' && record.kind !== 'failed') {
      throw new Error('Local controller returned an unexpected workspace state');
    }
    const saved = readSavedWorkspace();
    if (saved) {
      const result = await provisionLocalWorkspace(saved);
      return result.ok ? result.workspace : { kind: 'restore_failed', message: result.message };
    }
    return record.kind === 'empty'
      ? { kind: 'empty' }
      : { kind: 'failed', message: parseFailure(record) };
  } catch (error) {
    return {
      kind: 'restore_failed',
      message: error instanceof Error ? error.message : 'Could not reconnect to the local project',
    };
  }
}

function readSavedWorkspace(): ProvisionLocalWorkspaceInput | null {
  try {
    const saved = localStorage.getItem(savedWorkspaceKey);
    if (!saved) return null;
    const record = requiredRecord(JSON.parse(saved), 'saved project');
    return {
      organizationName: requiredString(record.organizationName, 'organisation name'),
      projectName: requiredString(record.projectName, 'project name'),
    };
  } catch {
    return null;
  }
}

function rememberWorkspace(workspace: ReadyLocalWorkspace): void {
  try {
    localStorage.setItem(
      savedWorkspaceKey,
      JSON.stringify({
        organizationName: workspace.identity.organizationName,
        projectName: workspace.identity.projectName,
      }),
    );
  } catch {
    // The running controller can still restore the project when storage is unavailable.
  }
}

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
    const workspace = parseReadyWorkspace(body);
    rememberWorkspace(workspace);
    return { ok: true, workspace };
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
