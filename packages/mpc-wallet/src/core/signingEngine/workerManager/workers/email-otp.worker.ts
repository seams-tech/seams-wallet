/**
 * Email OTP worker: runs inside the wallet custody iframe and holds OTP-released factor secrets,
 * warm signing material and Ed25519 Yao clients off the main thread.
 */
import { WorkerControlMessage } from '@/core/signingEngine/workerManager/workerTypes';
import { handleEmailOtpWorkerMessage, postToMainThread } from './email-otp/dispatch';

setTimeout(() => {
  postToMainThread({ type: WorkerControlMessage.WORKER_READY, ready: true });
}, 0);

self.addEventListener('message', handleEmailOtpWorkerMessage);
