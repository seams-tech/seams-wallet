import { buildEmailOtpSigningPrompt } from './otpPrompt/signingPrompt';
import { selectStepUpMethod } from './methodSelection';
import type { StepUpMethodRunners } from './methodRunners';
import type {
  EmailOtpConfirmPrompt,
  EmailOtpStepUpConfirmation,
  PasskeyPromptPlan,
  PasskeyStepUpConfirmation,
  StepUpPolicy,
  StepUpWarmSessionAuthorization,
} from './types';

type SelectableLane = {
  authMethod: 'passkey' | 'email_otp';
};

type PreparedStepUpAuth<TPasskeyAuthorization, TEmailOtpAuthorization> =
  | {
      method: 'warm_session';
      authorization: StepUpWarmSessionAuthorization;
    }
  | {
      method: 'passkey';
      prompt: PasskeyPromptPlan;
      complete: (confirmation: PasskeyStepUpConfirmation) => Promise<TPasskeyAuthorization>;
    }
  | {
      method: 'email_otp';
      prompt: EmailOtpConfirmPrompt;
      complete: (confirmation: EmailOtpStepUpConfirmation) => Promise<TEmailOtpAuthorization>;
    };

export async function prepareStepUpAuth<
  TLane extends SelectableLane,
  TOperation,
  TPasskeyAuthorization,
  TEmailOtpAuthorization,
>(args: {
  operation: TOperation;
  selectedLane: TLane;
  policy: StepUpPolicy;
  methods: StepUpMethodRunners<TLane, TOperation, TPasskeyAuthorization, TEmailOtpAuthorization>;
}): Promise<PreparedStepUpAuth<TPasskeyAuthorization, TEmailOtpAuthorization>> {
  const route = selectStepUpMethod({
    selectedLane: args.selectedLane,
    policy: args.policy,
    methods: args.methods,
  });

  if (route.method === 'warm_session') {
    return {
      method: 'warm_session',
      authorization: route.authorization,
    };
  }

  if (route.method === 'passkey') {
    const prompt = await route.runner.prepare();
    return {
      method: 'passkey',
      prompt,
      complete: async (confirmation) =>
        await route.runner.complete({
          operation: args.operation,
          selectedLane: args.selectedLane,
          policy: args.policy,
          prompt,
          confirmation,
        }),
    };
  }

  const challenge = await route.runner.prepareChallenge({
    operation: args.operation,
    selectedLane: args.selectedLane,
    policy: args.policy,
  });
  const promptRef: { prompt?: EmailOtpConfirmPrompt } = {};
  const prompt = buildEmailOtpSigningPrompt({
    challenge,
    resend: route.runner.resendChallenge
      ? async () =>
          await route.runner.resendChallenge!({
            operation: args.operation,
            selectedLane: args.selectedLane,
            policy: args.policy,
            currentPrompt: promptRef.prompt || prompt,
          })
      : undefined,
  });
  promptRef.prompt = prompt;
  return {
    method: 'email_otp',
    prompt,
    complete: async (confirmation) =>
      await route.runner.complete({
        operation: args.operation,
        selectedLane: args.selectedLane,
        policy: args.policy,
        prompt,
        confirmation,
      }),
  };
}
