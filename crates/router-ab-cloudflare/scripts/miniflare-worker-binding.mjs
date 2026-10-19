// Miniflare and Node use different Request classes. Re-issue requests by value.
export class MiniflareWorkerBinding {
  constructor(worker) {
    this.worker = worker;
  }

  async fetch(input, init) {
    const request = new Request(input, init);
    return this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}
