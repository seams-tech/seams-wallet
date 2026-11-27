import { expect, test } from '@playwright/test';
import { createWalletConsoleRelayProxyExtensionV1 } from '../../../packages/mpc-wallet-server/src/router/cloudflare/runtime/walletGateway';
import { WALLET_CONSOLE_SERVICE_ORIGIN_V1 } from '../../../packages/mpc-wallet-server/src/router/cloudflare/runtime/walletConsoleOps';
import { APP_ORIGIN, routerWith } from './routeHarness';

/**
 * A Console service binding. A binding answers with a fetched Response, and the runtime does
 * not let code change the headers of one. A `data:` fetch gives the same kind of Response.
 */
function consoleBinding(requestUrls: string[]) {
  return {
    async fetch(input: Request | string): Promise<Response> {
      requestUrls.push(new Request(input).url);
      const answer = await fetch('data:application/json,%7B%22wallets%22%3A%5B%5D%7D');
      expect(() => answer.headers.set('X-Probe', '1')).toThrow(TypeError);
      return answer;
    },
  };
}

test('the Gateway adds CORS headers to a wallet list that the Console answered', async () => {
  const requestUrls: string[] = [];
  const router = routerWith(
    {},
    {
      corsOrigins: [APP_ORIGIN],
      routeExtensions: [createWalletConsoleRelayProxyExtensionV1(consoleBinding(requestUrls))],
    },
  );

  const response = await router.send('GET', '/v1/wallets?limit=5', {
    headers: { Origin: APP_ORIGIN },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ wallets: [] });
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN);
  expect(requestUrls).toEqual([`${WALLET_CONSOLE_SERVICE_ORIGIN_V1}/v1/wallets?limit=5`]);
});
