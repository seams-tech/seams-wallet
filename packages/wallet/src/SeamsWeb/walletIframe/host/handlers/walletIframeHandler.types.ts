import type {
  ChildToParentEnvelope,
  ParentToChildEnvelope,
  ParentToChildType,
  ProgressPayload,
  PMGetExactWalletSessionStatePayload,
  PreferencesChangedPayload,
} from '../../shared/messages';
import type { WalletIframeExactSessionSnapshot } from '../../shared/exactSessionState';
import type { WalletHostRuntime } from '@/SeamsWeb/walletIframe/host/WalletHostRuntime';

export type Req<T extends ParentToChildType> = Extract<ParentToChildEnvelope, { type: T }>;

export type HandlerMap = Partial<{
  [K in ParentToChildType]: (req: Extract<ParentToChildEnvelope, { type: K }>) => Promise<void>;
}>;

export interface HandlerDeps {
  getWalletRuntime(): WalletHostRuntime;
  readPreferences(): PreferencesChangedPayload;
  publishCurrentSession(): Promise<void>;
  observeSession(
    payload: PMGetExactWalletSessionStatePayload,
    publish: (snapshot: WalletIframeExactSessionSnapshot) => void,
  ): Promise<void>;
  post(msg: ChildToParentEnvelope): void;
  postProgress(requestId: string | undefined, payload: ProgressPayload): void;
  isCancelled(requestId: string | undefined): boolean;
  respondIfCancelled(requestId: string | undefined): boolean;
}
