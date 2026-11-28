// The account origin for an operator: the document of the account frame, its
// Content-Security-Policy and the name of its script. `pnpm build:account-origin` builds the
// script into `dist/account-origin`. The operator serves the document at ACCOUNT_FRAME_PATH and
// the script beside it, and each plugin and gate under `/sdk/` on the same origin.
export {
  ACCOUNT_FRAME_SCRIPT,
  accountFrameCsp,
  accountFrameHtml,
  type AccountOriginConfig,
} from '../../auth/src/origin/document';
export { ACCOUNT_FRAME_PATH } from '../../auth/src/shared/protocol';
