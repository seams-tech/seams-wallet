import type { useSeams } from '@seams/wallet/react';

type Seams = ReturnType<typeof useSeams>['seams'];
type VoiceIdContext = {
  walletId: string;
  auth: Seams['auth'];
  registration: Seams['registration'];
};
type Activation = Awaited<ReturnType<Seams['registration']['activateAuthMethod']>>;
type Unlock = Awaited<ReturnType<Seams['auth']['unlockWithAuthMethod']>>;
type Session = Awaited<ReturnType<Seams['auth']['getSession']>>;

declare global {
  interface Window {
    __seamsIntendedVoiceId?: {
      activate(): Promise<Activation>;
      unlock(walletAuthMethodId: string): Promise<Unlock>;
      session(): Promise<Session>;
    };
  }
}

export class IntendedVoiceIdHelpers {
  constructor(private readonly readContext: () => VoiceIdContext) {}

  install(): void {
    window.__seamsIntendedVoiceId = {
      activate: this.activate.bind(this),
      unlock: this.unlock.bind(this),
      session: this.session.bind(this),
    };
  }

  private async activate(): Promise<Activation> {
    const context = this.readContext();
    return await context.registration.activateAuthMethod({
      walletId: context.walletId,
      method: 'voiceid',
    });
  }

  private async unlock(walletAuthMethodId: string): Promise<Unlock> {
    const context = this.readContext();
    return await context.auth.unlockWithAuthMethod({
      walletId: context.walletId,
      walletAuthMethodId,
      method: 'voiceid',
    });
  }

  private async session(): Promise<Session> {
    const context = this.readContext();
    return await context.auth.getSession(context.walletId);
  }
}
