import assert from 'node:assert/strict';
import { ceremonyPath, executeCeremony, interceptCeremony } from './yao-ceremony-evidence-transport.mjs';

export class CapturedCeremony {
  preparation;
  execution;
  executionRequest;
  compete = false;
  dropReply = false;

  async fetch(request, topology) {
    const worker = await topology.getWorker('deriver-a');
    if (new URL(request.url).pathname !== ceremonyPath) return worker.fetch(request);
    this.worker = worker;
    this.headers = request.headers;
    return interceptCeremony(request, worker, this);
  }

  prepared(request, receipt) {
    this.preparation = { request, receipt };
  }

  beforeStart(execution) {
    this.executionRequest = execution;
    if (this.compete) {
      this.competing = executeCeremony(this.worker, execution, this.headers);
    }
  }

  async finished(request, outcome) {
    if (outcome.status !== 'completed') return;
    this.execution = { request, response: outcome.execution };
    if (this.competing) {
      let competitor = await this.competing;
      // An overlapping claim may be refused. Once completion is durable, its retry must replay.
      if (competitor.status !== 200) competitor = await executeCeremony(this.worker, request, this.headers);
      assert.equal(competitor.status, 200, await competitor.clone().text());
      assert.deepEqual(await competitor.json(), outcome.execution);
      this.competing = undefined;
    }
    if (this.dropReply) throw new Error('E2E lost completed A reply');
  }
}
