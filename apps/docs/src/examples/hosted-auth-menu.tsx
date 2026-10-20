import {
  HostedSeamsAuthMenu,
  useSeams,
  type HostedAuthMenuOutcome,
} from '@seams/wallet/react';

export function HostedRegistration({ onOutcome }: {
  onOutcome: (outcome: HostedAuthMenuOutcome) => void;
}) {
  return <HostedSeamsAuthMenu initialMode="register" onOutcome={onOutcome} />;
}

export function SignInIntentButton({ onOpen }: { onOpen: () => void }) {
  const { seams } = useSeams();
  return (
    <button
      onPointerEnter={seams.authMenu.prepare}
      onFocus={seams.authMenu.prepare}
      onTouchStart={seams.authMenu.prepare}
      onClick={onOpen}
    >
      Sign in
    </button>
  );
}
