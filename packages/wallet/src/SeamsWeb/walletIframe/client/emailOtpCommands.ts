import type { AuthCapability } from '@/SeamsWeb/signingSurface/types';
import { unlockWithEmailCode, type EmailOtpAuthCommands } from '@/SeamsWeb/publicApi/auth';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';

export function createApplicationEmailOtpCommands(
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): EmailOtpAuthCommands {
  const commands = new ApplicationEmailOtpCommands(walletIframe);
  return {
    requestEmailCode: commands.requestEmailCode.bind(commands),
    unlockWithEmailCode,
    startGoogleSignIn: commands.startGoogleSignIn.bind(commands),
  };
}

class ApplicationEmailOtpCommands {
  constructor(private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>) {}

  async requestEmailCode(
    args: Parameters<AuthCapability['requestEmailCode']>[0],
  ): ReturnType<AuthCapability['requestEmailCode']> {
    const router = await this.walletIframe.requireRouter();
    return await router.requestEmailCode(args);
  }

  async startGoogleSignIn(
    args: Parameters<AuthCapability['startGoogleSignIn']>[0],
  ): ReturnType<AuthCapability['startGoogleSignIn']> {
    const router = await this.walletIframe.requireRouter();
    return await router.startGoogleSignIn(args);
  }
}
