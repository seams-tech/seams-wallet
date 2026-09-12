import { useMemo, useState, type ChangeEvent } from 'react';

type RecoveryOperation = 'export' | 'rotate' | 'restore';

export function ServerShareRecovery({ environmentId }: { environmentId: string }) {
  const [operation, setOperation] = useState<RecoveryOperation>('export');
  const [consoleUrl, setConsoleUrl] = useState('https://wallet.seams.sh');
  const [targetEnvironmentId, setTargetEnvironmentId] = useState(environmentId);
  const [recoverySetId, setRecoverySetId] = useState('<recovery-set-id>');
  const [destinationUrl, setDestinationUrl] = useState('<empty-destination-url>');
  const rotationId = useMemo(() => crypto.randomUUID(), []);

  function updateConsoleUrl(event: ChangeEvent<HTMLInputElement>) {
    setConsoleUrl(event.currentTarget.value);
  }

  function updateTargetEnvironmentId(event: ChangeEvent<HTMLInputElement>) {
    setTargetEnvironmentId(event.currentTarget.value);
  }

  return (
    <section className="panel recovery-panel">
      <div className="section-heading">
        <p className="eyebrow">Server threshold shares</p>
        <h2>Recovery</h2>
        <p className="section-description">
          Keep wrapper keys and operator credentials in Terminal. This page generates the public
          CLI commands and never reads either secret. Use the Console URL and environment ID for
          the deployment you are operating; the standalone local runtime does not impersonate
          hosted approval authority.
        </p>
      </div>

      <div className="recovery-inputs">
        <label>
          Console URL
          <input value={consoleUrl} onChange={updateConsoleUrl} inputMode="url" />
        </label>
        <label>
          Deployment environment ID
          <input value={targetEnvironmentId} onChange={updateTargetEnvironmentId} />
        </label>
      </div>

      <div className="operation-tabs" role="tablist" aria-label="Recovery operation">
        <OperationTab operation="export" active={operation} onSelect={setOperation}>
          Export
        </OperationTab>
        <OperationTab operation="rotate" active={operation} onSelect={setOperation}>
          Rotate
        </OperationTab>
        <OperationTab operation="restore" active={operation} onSelect={setOperation}>
          Restore deployment
        </OperationTab>
      </div>

      {operation === 'export' ? (
        <ExportCommands
          consoleUrl={consoleUrl}
          environmentId={targetEnvironmentId}
          recoverySetId={recoverySetId}
          onRecoverySetIdChange={setRecoverySetId}
        />
      ) : null}
      {operation === 'rotate' ? (
        <CommandSection
          title="Rotate operational shares"
          description="Starts one idempotent rotation. Public Wallet identities remain unchanged."
          commands={[
            command([
              'seams-wallet',
              'derivation-root',
              'rotate',
              '--console-url',
              consoleUrl,
              '--environment',
              targetEnvironmentId,
              '--idempotency-key',
              rotationId,
            ]),
          ]}
        />
      ) : null}
      {operation === 'restore' ? (
        <RestoreCommands
          consoleUrl={consoleUrl}
          environmentId={targetEnvironmentId}
          destinationUrl={destinationUrl}
          onDestinationUrlChange={setDestinationUrl}
        />
      ) : null}
    </section>
  );
}

function OperationTab(props: {
  operation: RecoveryOperation;
  active: RecoveryOperation;
  onSelect: (operation: RecoveryOperation) => void;
  children: string;
}) {
  function selectOperation() {
    props.onSelect(props.operation);
  }
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active === props.operation}
      className={props.active === props.operation ? 'active' : ''}
      onClick={selectOperation}
    >
      {props.children}
    </button>
  );
}

function ExportCommands(props: {
  consoleUrl: string;
  environmentId: string;
  recoverySetId: string;
  onRecoverySetIdChange: (value: string) => void;
}) {
  function updateRecoverySetId(event: ChangeEvent<HTMLInputElement>) {
    props.onRecoverySetIdChange(event.currentTarget.value);
  }
  return (
    <div className="operation-content">
      <label>
        Approved recovery set ID
        <input value={props.recoverySetId} onChange={updateRecoverySetId} />
      </label>
      <CommandSection
        title="Export recovery kit"
        description="After dashboard approval, downloads and verifies both encrypted server-share packages and their wrapper keys into one recovery ZIP."
        commands={[
          command([
            'seams-wallet',
            'derivation-root',
            'backup',
            'kit',
            '--console-url',
            props.consoleUrl,
            '--environment',
            props.environmentId,
            '--recovery-set',
            props.recoverySetId,
          ]),
        ]}
      />
    </div>
  );
}

function RestoreCommands(props: {
  consoleUrl: string;
  environmentId: string;
  destinationUrl: string;
  onDestinationUrlChange: (value: string) => void;
}) {
  function updateDestinationUrl(event: ChangeEvent<HTMLInputElement>) {
    props.onDestinationUrlChange(event.currentTarget.value);
  }
  const shared = [
    '--destination',
    props.destinationUrl,
    '--folder',
    './seams-recovery',
    '--console-url',
    props.consoleUrl,
    '--environment',
    props.environmentId,
  ];
  return (
    <div className="operation-content">
      <label>
        Empty destination deployment URL
        <input value={props.destinationUrl} onChange={updateDestinationUrl} inputMode="url" />
      </label>
      <CommandSection
        title="Restore a deployment"
        description="Extract the recovery ZIP, then let each holder import one share. The CLI verifies the manifest and activates only after both imports are ready."
        commands={[
          command(['seams-wallet', 'derivation-root', 'restore', ...shared, '--role', 'deriver-a']),
          command(['seams-wallet', 'derivation-root', 'restore', ...shared, '--role', 'deriver-b']),
          command([
            'seams-wallet',
            'derivation-root',
            'restore',
            'activate',
            '--destination',
            props.destinationUrl,
            '--session-file',
            '<restore-session-file>',
            '--console-url',
            props.consoleUrl,
            '--environment',
            props.environmentId,
          ]),
        ]}
      />
    </div>
  );
}

function CommandSection(props: {
  title: string;
  description: string;
  commands: readonly string[];
}) {
  return (
    <div className="command-section">
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.commands.map((value) => (
        <pre key={value}><code>{value}</code></pre>
      ))}
    </div>
  );
}

function command(parts: readonly string[]): string {
  return parts.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
