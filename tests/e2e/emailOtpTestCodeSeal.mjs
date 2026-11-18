/**
 * The code seal for tests that build the Email OTP issuer or verifier
 * directly. The server keeps each code encrypted under a key from the Email
 * OTP seal root; tests use a fixed root.
 */
export function emailOtpTestCodeSeal(api) {
  const seal = api.createEmailOtpCodeSeal(Buffer.alloc(32, 7).toString('base64url'));
  return {
    sealEmailOtpCode: async (input) => ({ ok: true, otpCodeSealedB64u: await seal.seal(input) }),
    openEmailOtpCode: async (input) => ({ ok: true, otpCode: await seal.open(input) }),
  };
}
