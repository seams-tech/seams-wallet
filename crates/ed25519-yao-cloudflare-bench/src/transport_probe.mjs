import { DurableObject } from "cloudflare:workers";

const TOKEN_HEADER = "x-ml-dsa-probe-token";
const ENCODER = new TextEncoder();
const MAX_BYTES = 64_000_000;
const WINDOW_FRAMES = 8;

function jsonError(status, message) {
  return Response.json({ ok: false, error: message }, { status });
}

function authorized(request, env) {
  return typeof env.PROBE_TOKEN === "string" && env.PROBE_TOKEN.length >= 32 &&
    request.headers.get(TOKEN_HEADER) === env.PROBE_TOKEN;
}

function parseProbe(request) {
  const url = new URL(request.url);
  const bytes = Number(url.searchParams.get("bytes"));
  const chunkBytes = Number(url.searchParams.get("chunk_bytes"));
  const receiverDelayMs = Number(url.searchParams.get("receiver_delay_ms") ?? "0");
  const path = url.searchParams.get("path");
  const transport = url.searchParams.get("transport");
  const fault = url.searchParams.get("fault") ?? "none";
  const wallet = url.searchParams.get("wallet");
  if (![8_000_000, 32_000_000, MAX_BYTES].includes(bytes) ||
      ![65_536, 131_072].includes(chunkBytes) ||
      !["direct", "wallet-do"].includes(path) ||
      !["http", "websocket"].includes(transport) ||
      !["none", "truncate"].includes(fault) ||
      !Number.isInteger(receiverDelayMs) || receiverDelayMs < 0 || receiverDelayMs > 20 ||
      typeof wallet !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(wallet)) {
    throw new Error("Invalid bounded transport probe parameters");
  }
  return { bytes, chunkBytes, receiverDelayMs, path, transport, fault, wallet };
}

function metadata(request, env, insideDo) {
  return {
    role: env.PROBE_ROLE,
    incoming_request_colo: request.cf?.colo ?? null,
    actual_execution_colo: insideDo ? "unknown: Durable Object location is not exposed" : request.cf?.colo ?? null,
    inside_wallet_do: insideDo,
    intended_worker_placement: "default request placement; no same-region guarantee",
    intended_do_location_hint: env.PROBE_DO_HINT,
    actual_do_location: insideDo ? "unknown" : "not-applicable",
    d1_placement: "not-applicable: this probe uses no D1",
  };
}

function walletStub(env, wallet) {
  return env.PROBE_WALLETS.get(env.PROBE_WALLETS.idFromName(wallet), { locationHint: env.PROBE_DO_HINT });
}

function eventStream() {
  let controller;
  const stream = new ReadableStream({
    start(value) { controller = value; },
  });
  return {
    stream,
    emit(value) { controller.enqueue(ENCODER.encode(`${JSON.stringify(value)}\n`)); },
    close() { controller.close(); },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checksumUpdate(state, bytes) {
  let a = state.a;
  let b = state.b;
  for (let offset = 0; offset < bytes.length; offset += 5552) {
    const end = Math.min(offset + 5552, bytes.length);
    for (let index = offset; index < end; index += 1) {
      a += bytes[index];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  state.a = a;
  state.b = b;
}

function checksumHex(state) {
  return (((state.b << 16) | state.a) >>> 0).toString(16).padStart(8, "0");
}

class Receiver {
  constructor(probe, emit) {
    this.probe = probe;
    this.emit = emit;
    this.payloadBytes = 0;
    this.wireBytes = 0;
    this.frames = 0;
    this.checksum = { a: 1, b: 0 };
    this.header = new Uint8Array(8);
    this.headerUsed = 0;
    this.remaining = 0;
    this.startedAt = Date.now();
  }

  consume(bytes) {
    this.wireBytes += bytes.length;
    let offset = 0;
    while (offset < bytes.length) {
      if (this.remaining === 0) {
        const count = Math.min(8 - this.headerUsed, bytes.length - offset);
        this.header.set(bytes.subarray(offset, offset + count), this.headerUsed);
        this.headerUsed += count;
        offset += count;
        if (this.headerUsed !== 8) continue;
        const view = new DataView(this.header.buffer);
        const sequence = view.getUint32(0);
        const length = view.getUint32(4);
        const expected = Math.min(this.probe.chunkBytes, this.probe.bytes - this.payloadBytes);
        if (sequence !== this.frames || length !== expected || length === 0) {
          throw new Error("Invalid frame sequence or payload length");
        }
        this.headerUsed = 0;
        this.remaining = length;
      }
      const count = Math.min(this.remaining, bytes.length - offset);
      if (count === 0) continue;
      if (this.payloadBytes === 0) this.emit({ event: "first_byte", receiver_clock_ms: Date.now() - this.startedAt });
      checksumUpdate(this.checksum, bytes.subarray(offset, offset + count));
      this.payloadBytes += count;
      this.remaining -= count;
      offset += count;
      if (this.remaining === 0) this.frames += 1;
      if (this.payloadBytes === this.probe.bytes) {
        this.emit({ event: "last_byte", receiver_clock_ms: Date.now() - this.startedAt });
      }
    }
  }

  finish() {
    if (this.payloadBytes !== this.probe.bytes || this.remaining !== 0 || this.headerUsed !== 0) {
      throw new Error(`Truncated payload: received ${this.payloadBytes} of ${this.probe.bytes} bytes`);
    }
    return {
      event: "receiver_complete",
      payload_bytes: this.payloadBytes,
      wire_bytes: this.wireBytes,
      application_frames: this.frames,
      checksum_adler32: checksumHex(this.checksum),
      receiver_clock_ms: Date.now() - this.startedAt,
    };
  }
}

function makeFrame(sequence, offset, length) {
  const frame = new Uint8Array(length + 8);
  const header = new DataView(frame.buffer);
  header.setUint32(0, sequence);
  header.setUint32(4, length);
  for (let index = 0; index < length; index += 1) frame[index + 8] = (offset + index) & 255;
  return frame;
}

async function sendHttp(writer, probe) {
  let offset = 0;
  let sequence = 0;
  const actual = probe.bytes - (probe.fault === "truncate" ? 1 : 0);
  while (offset < probe.bytes) {
    const length = Math.min(probe.chunkBytes, probe.bytes - offset);
    const frame = makeFrame(sequence, offset, length);
    const transmitted = Math.min(frame.length, actual - offset + 8);
    await writer.write(frame.subarray(0, transmitted));
    offset += length;
    sequence += 1;
  }
  await writer.close();
  return sequence;
}

async function readEvents(body, receive) {
  if (body === null) throw new Error("Missing receiver event stream");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let end = pending.indexOf("\n");
    while (end !== -1) {
      receive(JSON.parse(pending.slice(0, end)));
      pending = pending.slice(end + 1);
      end = pending.indexOf("\n");
    }
    if (pending.length > 16_384) throw new Error("Oversized receiver event");
  }
  if (pending !== "") throw new Error("Truncated receiver event");
}

async function receiveHttp(request, probe, output) {
  const receiver = new Receiver(probe, output.emit);
  try {
    if (request.body === null) throw new Error("Missing byte stream");
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receiver.consume(value);
      if (probe.receiverDelayMs > 0) await sleep(probe.receiverDelayMs);
    }
    output.emit(receiver.finish());
  } catch (error) {
    output.emit({ event: "receiver_error", error: error.message, payload_bytes: receiver.payloadBytes });
  } finally {
    output.close();
  }
}

function receiveWebSocket(request, probe, info) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.binaryType = "arraybuffer";
  server.accept();
  const receiver = new Receiver(probe, value => server.send(JSON.stringify(value)));
  let pending = Promise.resolve();
  let finished = false;
  const handle = async event => {
    if (finished) return;
    try {
      if (typeof event.data === "string") {
        if (event.data !== "end") throw new Error("Unexpected control frame");
        server.send(JSON.stringify(receiver.finish()));
        finished = true;
        server.close(1000, "complete");
        return;
      }
      receiver.consume(new Uint8Array(event.data));
      if (probe.receiverDelayMs > 0) await sleep(probe.receiverDelayMs);
      if (receiver.frames % WINDOW_FRAMES === 0 || receiver.payloadBytes === probe.bytes) {
        server.send(JSON.stringify({ event: "credit", application_frames: receiver.frames }));
      }
    } catch (error) {
      finished = true;
      server.send(JSON.stringify({ event: "receiver_error", error: error.message, payload_bytes: receiver.payloadBytes }));
      server.close(1000, "rejected");
    }
  };
  server.addEventListener("message", event => { pending = pending.then(() => handle(event)); });
  server.send(JSON.stringify({ event: "receiver_ready", receiver: info }));
  return new Response(null, { status: 101, webSocket: client });
}

function receiverEndpoint(request, env, ctx, insideDo, probe) {
  const info = metadata(request, env, insideDo);
  if (probe.transport === "websocket") return receiveWebSocket(request, probe, info);
  const output = eventStream();
  output.emit({ event: "receiver_ready", receiver: info });
  ctx.waitUntil(receiveHttp(request, probe, output));
  return new Response(output.stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

async function runHttp(request, env, probe, output) {
  const upload = new TransformStream();
  const headers = new Headers({ [TOKEN_HEADER]: env.PROBE_TOKEN, "content-type": "application/octet-stream" });
  const url = new URL(request.url);
  url.pathname = "/receive";
  const startedAt = Date.now();
  const response = await env.PROBE_B.fetch(new Request(url, { method: "POST", headers, body: upload.readable, duplex: "half" }));
  if (!response.ok) throw new Error(`Receiver HTTP ${response.status}`);
  output.emit({ event: "setup", sender_clock_ms: Date.now() - startedAt });
  let complete = false;
  let receiverError = null;
  const receive = value => {
    output.emit(value);
    if (value.event === "receiver_complete") complete = true;
    if (value.event === "receiver_error") receiverError = value.error;
  };
  const sending = sendHttp(upload.writable.getWriter(), probe);
  const reading = readEvents(response.body, receive);
  await Promise.all([sending, reading]);
  if (receiverError !== null) throw new Error(receiverError);
  if (!complete) throw new Error("Receiver omitted completion acknowledgement");
}

class SocketInbox {
  constructor(socket) {
    this.queue = [];
    this.waiter = null;
    this.failure = null;
    socket.addEventListener("message", event => {
      try {
        if (typeof event.data !== "string") throw new Error("Unexpected receiver binary frame");
        const value = JSON.parse(event.data);
        if (this.waiter !== null) {
          const waiter = this.waiter;
          this.waiter = null;
          waiter.resolve(value);
        } else this.queue.push(value);
      } catch (error) { this.fail(error); }
    });
    socket.addEventListener("error", () => this.fail(new Error("Receiver WebSocket error")));
    socket.addEventListener("close", () => this.fail(new Error("Receiver WebSocket closed")));
  }

  fail(error) {
    this.failure = error;
    if (this.waiter !== null) {
      this.waiter.reject(error);
      this.waiter = null;
    }
  }

  next() {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
}

async function runWebSocket(request, env, probe, output) {
  const url = new URL(request.url);
  url.pathname = "/receive";
  const response = await env.PROBE_B.fetch(new Request(url, { headers: { Upgrade: "websocket", [TOKEN_HEADER]: env.PROBE_TOKEN } }));
  if (response.status !== 101 || response.webSocket === null) throw new Error(`Receiver WebSocket HTTP ${response.status}`);
  const socket = response.webSocket;
  try {
    socket.binaryType = "arraybuffer";
    const inbox = new SocketInbox(socket);
    socket.accept();
    output.emit({ event: "setup" });
    let offset = 0;
    let sequence = 0;
    const actual = probe.bytes - (probe.fault === "truncate" ? 1 : 0);
    let ready = false;
    while (!ready) {
      const value = await inbox.next();
      output.emit(value);
      ready = value.event === "receiver_ready";
    }
    while (offset < probe.bytes) {
      const limit = Math.min(sequence + WINDOW_FRAMES, Math.ceil(probe.bytes / probe.chunkBytes));
      while (sequence < limit) {
        const length = Math.min(probe.chunkBytes, probe.bytes - offset);
        const frame = makeFrame(sequence, offset, length);
        socket.send(frame.subarray(0, Math.min(frame.length, actual - offset + 8)));
        offset += length;
        sequence += 1;
      }
      if (probe.fault === "truncate" && offset === probe.bytes) break;
      let acknowledged = false;
      while (!acknowledged) {
        const value = await inbox.next();
        if (value.event === "receiver_error") throw new Error(value.error);
        acknowledged = value.event === "credit" && value.application_frames >= sequence;
        if (value.event !== "credit") output.emit(value);
      }
    }
    socket.send("end");
    while (true) {
      const value = await inbox.next();
      output.emit(value);
      if (value.event === "receiver_error") throw new Error(value.error);
      if (value.event === "receiver_complete") break;
    }
  } finally {
    if (socket.readyState === 1) socket.close(1000, "probe finished");
  }
}

async function runProbe(request, env, probe, output) {
  try {
    if (probe.transport === "http") await runHttp(request, env, probe, output);
    else await runWebSocket(request, env, probe, output);
    output.emit({ event: "sender_ack", ok: true });
  } catch (error) {
    output.emit({ event: "sender_ack", ok: false, error: error.message });
  } finally { output.close(); }
}

function senderEndpoint(request, env, ctx, insideDo, probe) {
  const output = eventStream();
  output.emit({
    event: "start", benchmark_only: true, probe, sender: metadata(request, env, insideDo),
    clock_scope: "Worker clocks omit own CPU time; use driver client_wall_ms and tail cpuTime/wallTime",
    sender_max_application_frame_bytes: probe.chunkBytes + 8,
    websocket_window_frames: probe.transport === "websocket" ? WINDOW_FRAMES : null,
    sender_max_inflight_payload_bytes: probe.transport === "websocket" ? WINDOW_FRAMES * probe.chunkBytes : probe.chunkBytes,
  });
  ctx.waitUntil(runProbe(request, env, probe, output));
  return new Response(output.stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

async function route(request, env, ctx, insideDo) {
  if (!authorized(request, env)) return jsonError(401, "Probe authentication required");
  let probe;
  try { probe = parseProbe(request); }
  catch (error) { return jsonError(400, error.message); }
  const pathname = new URL(request.url).pathname;
  if ((env.PROBE_ROLE === "a" && pathname !== "/probe") ||
      (env.PROBE_ROLE === "b" && pathname !== "/receive")) return jsonError(404, "Unknown probe route");
  if (probe.path === "wallet-do" && !insideDo) return walletStub(env, probe.wallet).fetch(request);
  if (env.PROBE_ROLE === "a") return senderEndpoint(request, env, ctx, insideDo, probe);
  return receiverEndpoint(request, env, ctx, insideDo, probe);
}

export class ProbeWallet extends DurableObject {
  fetch(request) { return route(request, this.env, this.ctx, true); }
}

export default { fetch(request, env, ctx) { return route(request, env, ctx, false); } };
