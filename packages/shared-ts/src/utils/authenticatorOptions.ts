export interface OriginPolicyInput {
  single: boolean | undefined;
  all_subdomains: boolean | undefined;
  multiple: string[] | undefined;
}

export interface AuthenticatorOptions {
  originPolicy: OriginPolicyInput;
}

type AuthenticatorOptionsLike =
  | AuthenticatorOptions
  | {
      originPolicy: {
        single: boolean | undefined;
        all_subdomains: boolean | undefined;
        multiple: readonly string[] | string[] | undefined;
      };
    };

export function cloneAuthenticatorOptions(
  options: AuthenticatorOptionsLike,
): AuthenticatorOptions {
  const multiple = options.originPolicy?.multiple;
  return {
    originPolicy: {
      single: options.originPolicy?.single,
      all_subdomains: options.originPolicy?.all_subdomains,
      multiple: Array.isArray(multiple) ? [...multiple] : undefined,
    },
  };
}
