import { createAuthWorker, type AuthWorkerEnv } from './authWorkerEnv';

// The entry of the Auth Worker for a deployment that needs no part of its own. An operator with
// its own email sender calls `createAuthWorker(env, { sendEmail })` from its own entry.

let worker: { env: AuthWorkerEnv; handler: ReturnType<typeof createAuthWorker> } | null = null;

async function fetch(request: Request, env: AuthWorkerEnv): Promise<Response> {
  if (worker?.env !== env) worker = { env, handler: createAuthWorker(env) };
  return await (
    await worker.handler
  )(request);
}

export default { fetch };
