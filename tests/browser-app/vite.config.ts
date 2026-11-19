import { defineConfig } from 'vite';

/**
 * The page server of the wallet browser tests.
 *
 * Vite 8 forwards page errors and console errors to the dev server over its HMR socket when it
 * detects an AI agent (`server.forwardConsole` defaults to that check). On this test page the
 * socket is not connected, so each forward throws inside the page's `error` listener, which raises
 * the next page error: thousands of `Cannot read properties of undefined (reading 'send')` errors
 * that tests which expect no page errors then report. Playwright reads page errors itself, so the
 * forwarding is off and an agent run behaves as a CI run does.
 */
export default defineConfig({
  server: { forwardConsole: false },
});
