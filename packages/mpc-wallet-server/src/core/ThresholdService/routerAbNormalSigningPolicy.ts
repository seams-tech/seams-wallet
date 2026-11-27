export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; code: string; message: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

export type RouterAbNormalSigningServerPolicy = {
  mode: 'enabled';
  signingWorkerId: string;
};
