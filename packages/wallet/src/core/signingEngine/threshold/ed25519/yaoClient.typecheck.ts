import {
  type RouterAbEd25519YaoExportSeedInputV1,
  type RouterAbEd25519YaoExportCustodyEnvelopeV1,
  type RouterAbEd25519YaoExportEmailOtpFactorReleaseV1,
} from './yaoClient';
import * as yaoClient from './yaoClient';

// @ts-expect-error The WASM implementation constructor is internal.
const forgedActiveClient = new yaoClient.WasmRouterAbEd25519YaoActiveClientV1({});

void forgedActiveClient;

declare const exportRequest: RouterAbEd25519YaoExportSeedInputV1['request'];
declare const exportTransport: RouterAbEd25519YaoExportSeedInputV1['transport'];
declare const custodyEnvelope: RouterAbEd25519YaoExportCustodyEnvelopeV1;
declare const passkeyAuthorization: Extract<
  RouterAbEd25519YaoExportSeedInputV1['authorization'],
  { kind: 'passkey' }
>;
declare const emailOtpAuthorization: Extract<
  RouterAbEd25519YaoExportSeedInputV1['authorization'],
  { kind: 'email_otp_factor' }
>;

const validPasskeyExport = {
  request: exportRequest,
  transport: exportTransport,
  custodyEnvelope,
  authorization: passkeyAuthorization,
} satisfies RouterAbEd25519YaoExportSeedInputV1;

const validEmailOtpExport = {
  request: exportRequest,
  transport: exportTransport,
  authorization: emailOtpAuthorization,
  resolveCustodyEnvelope: async (_release: RouterAbEd25519YaoExportEmailOtpFactorReleaseV1) =>
    custodyEnvelope,
} satisfies RouterAbEd25519YaoExportSeedInputV1;

void validPasskeyExport;
void validEmailOtpExport;
