export type RegistrationSetupRateLimitInput = {
  readonly apiKeyId: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly sourceIp: string;
};

export type RegistrationSetupRateLimit = (
  input: RegistrationSetupRateLimitInput,
) => Promise<{ readonly allowed: boolean }>;
