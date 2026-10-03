import { expect, type BrowserContext, type Route, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LINKED_DEVICE_REQUEST_PROOF_HEADER_V1 } from '@shared/device-linking/requestProof';
import { parseLinkedDeviceRequestProofV1 } from '@server/core/deviceLinking/requestProof';

type Attempt = { readonly body: string; readonly proof: string; readonly status: number };

export class LostLinkedAcknowledgement {
  private readonly attempts: Attempt[] = [];
  private readonly handler = this.intercept.bind(this);

  constructor(
    private readonly context: BrowserContext,
    private readonly lostReplies: 1 | 2,
  ) {}

  async arm(): Promise<void> {
    await this.context.route('**/receipt', this.handler);
  }

  async release(): Promise<void> {
    await this.context.unroute('**/receipt', this.handler);
  }

  retainedProofNonces(): string[] {
    return this.attempts.slice(1).map(acknowledgementNonce);
  }

  private async intercept(route: Route): Promise<void> {
    const request = route.request();
    const body = request.postData() ?? '';
    if (request.method() !== 'POST' || !body.includes('"local_authority_activation_final_ack_v1"')) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    this.attempts.push({
      body,
      proof: request.headers()[LINKED_DEVICE_REQUEST_PROOF_HEADER_V1] ?? '',
      status: response.status(),
    });
    if (this.attempts.length <= this.lostReplies && response.status() === 204) {
      await route.abort('connectionreset');
      return;
    }
    await route.fulfill({ response });
  }

  async verify(testInfo: TestInfo): Promise<void> {
    expect(this.attempts).toHaveLength(this.lostReplies + 1);
    const [lost] = this.attempts;
    expect(lost.status).toBe(204);
    expect(lost.proof).not.toBe('');
    const proofs = new Set([lost.proof]);
    for (const replay of this.attempts.slice(1)) {
      expect(replay.status).toBe(204);
      expect(replay.body).toBe(lost.body);
      expect(replay.proof).not.toBe('');
      expect(proofs.has(replay.proof)).toBe(false);
      proofs.add(replay.proof);
    }
    const evidence = JSON.stringify({
      kind: 'linked_device_lost_acknowledgement_evidence_v1',
      statuses: this.attempts.map(acknowledgementStatus),
      lostReplies: this.lostReplies,
      exactAcknowledgementReplayed: true,
      freshDeviceProof: true,
      scope: 'Local real-protocol cleanup committed before the first response was lost; SDK retried and completed linking.',
    }, null, 2);
    await testInfo.attach('linked-device-lost-acknowledgement', { body: evidence, contentType: 'application/json' });
    const traceDirectory = process.env.SEAMS_INTENDED_TRACE_DIR;
    if (traceDirectory) {
      await mkdir(traceDirectory, { recursive: true });
      await writeFile(path.join(traceDirectory, 'linked-device-lost-acknowledgement.json'), `${evidence}\n`);
    }
  }
}

function acknowledgementStatus(attempt: Attempt): number {
  return attempt.status;
}

function acknowledgementNonce(attempt: Attempt): string {
  const raw: unknown = JSON.parse(Buffer.from(attempt.proof, 'base64url').toString('utf8'));
  return parseLinkedDeviceRequestProofV1(raw).requestNonceB64u;
}
