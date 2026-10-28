import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {} from '../fixtures/ui/VoiceIdMicrophoneProbe';

class MicrophoneServer {
  private readonly server = createServer(this.handle.bind(this));
  private readonly chunks: { fileName: string; code: string }[] = JSON.parse(
    execFileSync(process.execPath, [
      path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
      'VoiceIdMicrophoneProbe.ts',
    ], { encoding: 'utf8' }),
  );

  async start(): Promise<string> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Microphone server has no port');
    return `http://localhost:${address.port}/microphone-check`;
  }

  close(): void {
    this.server.closeAllConnections();
    this.server.close();
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    void this.respond(request, response).catch(response.destroy.bind(response));
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/microphone-check') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><script type="module" src="/microphone-probe/probe.js"></script></html>',
      );
      return;
    }
    if (pathname.startsWith('/microphone-probe/')) {
      const chunk = this.chunks.find(matchesChunk.bind(null, path.basename(pathname)));
      response.statusCode = chunk ? 200 : 404;
      response.setHeader('Content-Type', 'text/javascript');
      response.end(chunk?.code ?? '');
      return;
    }
    const file = pathname === '/microphone-speech.wav'
      ? path.resolve(import.meta.dirname, '../fixtures/audio/aurora/natural/0.wav')
      : path.resolve(import.meta.dirname, '../../packages/voiceid/dist/public', pathname.slice(1));
    response.setHeader(
      'Content-Type',
      /\.m?js$/.test(pathname) ? 'text/javascript' : 'application/octet-stream',
    );
    response.end(await readFile(file));
  }
}

function matchesChunk(name: string, chunk: { fileName: string }): boolean {
  return chunk.fileName === name;
}

test(
  'VoiceID retains its physical microphone across defaults and reload, then recovers from unplugging',
  microphoneJourney,
);

async function microphoneJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  test.setTimeout(120_000);
  const server = new MicrophoneServer();
  try {
    await page.goto(await server.start());
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await page.evaluate(holdEnumeration);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-enumeration', 'waiting');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(page.evaluate.bind(page, snapshot)).toMatchObject({ tracks: ['ended'] });
    const cancelledOpening = await page.evaluate(snapshot);
    await page.evaluate(releaseEnumeration);
    await expect(page.locator('body')).toHaveAttribute('data-result', 'failed');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-listening', 'true');
    await page.evaluate(stopUnexpectedly);
    await expect(page.locator('body')).toHaveAttribute('data-result', 'failed');
    const unexpectedStop = await page.evaluate(snapshot);
    expect(unexpectedStop.tracks).not.toContain('live');
    await record(page);
    expect(await quality(page)).toMatchObject({ microphone: 'desk', microphoneSelection: 'default' });

    await page.evaluate(changeDefault);
    await record(page);
    expect(await quality(page)).toMatchObject({ microphone: 'desk', microphoneSelection: 'preferred' });
    expect((await page.evaluate(snapshot)).requests.at(-1)?.exact).toBe('desk');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await page.evaluate(changeDefault);
    await record(page);
    expect(await quality(page)).toMatchObject({ microphone: 'desk', microphoneSelection: 'preferred' });

    await page.evaluate(disconnect);
    await record(page);
    const replacement = await quality(page);
    expect(replacement).toMatchObject({ microphone: 'headset', microphoneSelection: 'replacement' });
    const fallbackRequests = (await page.evaluate(snapshot)).requests.slice(-2);
    expect(fallbackRequests.map(exactDevice)).toEqual(['desk', null]);

    await page.evaluate(reconnect);
    await record(page);
    expect(await quality(page)).toMatchObject({ microphone: 'desk', microphoneSelection: 'preferred' });
    const beforeDenied = (await page.evaluate(snapshot)).requests.length;
    await page.evaluate(deny);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-result', 'failed');
    expect((await page.evaluate(snapshot)).requests).toHaveLength(beforeDenied + 1);

    await page.locator('body').evaluate(clearListening);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-listening', 'true');
    await page.evaluate(interrupt);
    await expect(page.locator('body')).toHaveAttribute('data-result', 'failed');
    await expect(page.locator('body')).toHaveAttribute('data-error', /microphone disconnected/);
    const interrupted = await page.evaluate(snapshot);
    expect(interrupted.tracks).not.toContain('live');
    await record(page);
    const finalQuality = await quality(page);
    expect(finalQuality).toMatchObject({
      microphone: 'desk',
      microphoneSelection: 'preferred',
      processing: {
        sampleRate: 16_000,
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true,
      },
    });
    const final = await page.evaluate(snapshot);
    expect(final.tracks).not.toContain('live');
    for (const request of final.requests) {
      expect(request.processing).toMatchObject({
        channelCount: 1,
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true,
      });
    }
    await page.getByRole('button', { name: 'Use system microphone', exact: true }).click();
    await record(page);
    const manuallySelected = await quality(page);
    expect(manuallySelected).toMatchObject({ microphone: 'headset', microphoneSelection: 'default' });
    await page.screenshot({ path: testInfo.outputPath('microphone-recovered.png') });
    await writeFile(
      testInfo.outputPath('voiceid-microphone.json'),
      JSON.stringify(
        {
          status: 'passed',
          inputBoundary: 'simulated_device_selection_with_real_browser_media_streams',
          audioPipeline: 'real_mediarecorder_and_silero_vad',
          physicalMicrophoneAccuracy: 'not_measured',
          cancelledOpening,
          unexpectedStop,
          replacement,
          fallbackRequests,
          interrupted,
          finalQuality,
          final,
          manuallySelected,
        },
        null,
        2,
      ),
    );
  } finally {
    server.close();
  }
}

async function record(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-result', 'captured', { timeout: 20_000 });
}

async function quality(page: Page): Promise<unknown> {
  const raw = await page.locator('body').getAttribute('data-quality');
  if (!raw) throw new Error('Capture did not report quality');
  return JSON.parse(raw);
}

function exactDevice(
  request: ReturnType<Window['microphoneProbe']['snapshot']>['requests'][number],
): string | null {
  return request.exact;
}
function snapshot() {
  return window.microphoneProbe.snapshot();
}
function changeDefault(): void {
  window.microphoneProbe.setDefault('headset');
}
function disconnect(): void {
  window.microphoneProbe.disconnectDesk();
}
function reconnect(): void {
  window.microphoneProbe.reconnectDesk();
}
function deny(): void {
  window.microphoneProbe.denyNext();
}
function interrupt(): void {
  window.microphoneProbe.interrupt();
}
function clearListening(body: HTMLElement): void {
  delete body.dataset.listening;
}
function holdEnumeration(): void {
  window.microphoneProbe.holdEnumeration();
}
function releaseEnumeration(): void {
  window.microphoneProbe.releaseEnumeration();
}
function stopUnexpectedly(): void {
  window.microphoneProbe.stopUnexpectedly();
}
