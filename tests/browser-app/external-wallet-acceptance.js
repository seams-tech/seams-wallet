import { ExternalNearController } from '../../packages/wallet/dist/esm/externalNear/index.js';

const rpc = 'https://rpc.testnet.near.org';
const controller = new ExternalNearController({
  network: 'testnet',
  rpcUrl: rpc,
  wallets: ['meteor', 'intear'],
});
const hotController = new ExternalNearController({
  network: 'mainnet',
  rpcUrl: 'https://rpc.mainnet.near.org',
  wallets: ['hot'],
});
const hotResult = document.getElementById('hot-result');
const availability = document.getElementById('availability');
const result = document.getElementById('result');
let submission = null;
let greeting = '';
function detectWallets() {
  availability.textContent = `Meteor direct API detected: ${Boolean(window.meteorComV2)}. HOT extension detected: ${Boolean(window.hotExtension)}.`;
}
detectWallets();
window.addEventListener('focus', detectWallets);
document.getElementById('detect').addEventListener('click', detectWallets);
document.getElementById('meteor').addEventListener('click', connectMeteor);
document.getElementById('intear').addEventListener('click', connectIntear);
document.getElementById('disconnect').addEventListener('click', disconnect);
document.getElementById('sign-message').addEventListener('click', signOwnershipMessage);
document.getElementById('greeting').addEventListener('click', sendGreeting);
document.getElementById('check').addEventListener('click', checkOutcome);
window.addEventListener('pagehide', disconnect);
document.getElementById('hot').addEventListener('click', connectHot);
document.getElementById('hot-disconnect').addEventListener('click', disconnectHot);
window.addEventListener('pagehide', disconnectHot);
async function connectHot() {
  detectWallets();
  hotResult.textContent = 'Waiting for HOT account approval…';
  hotResult.textContent = JSON.stringify(await hotController.connect('hot'), null, 2);
}
function disconnectHot() {
  hotController.disconnect();
  hotResult.textContent = 'Disconnected locally.';
}
async function connectMeteor() {
  await connect('meteor');
}
async function connectIntear() {
  await connect('intear');
}
async function connect(wallet) {
  detectWallets();
  result.textContent = `Waiting for ${wallet}…`;
  result.textContent = JSON.stringify(await controller.connect(wallet), null, 2);
}
function disconnect() {
  controller.disconnect();
  result.textContent = 'Disconnected locally.';
}
async function signOwnershipMessage() {
  const connection = controller.getSnapshot().connection;
  if (connection.kind !== 'connected') {
    result.textContent = 'Connect Meteor first.';
    return;
  }
  const params = {
    message: `Seams ownership acceptance ${new Date().toISOString()}`,
    recipient: location.host,
    nonce: crypto.getRandomValues(new Uint8Array(32)),
    state: crypto.randomUUID(),
  };
  result.textContent = 'Approve the ownership message in Meteor.';
  const signed = await controller.signMessage(connection, params);
  const evidence = {
    accountId: connection.accountId,
    network: connection.network,
    message: params.message,
    recipient: params.recipient,
    nonce: Array.from(params.nonce),
    state: params.state,
    signed,
  };
  result.textContent = JSON.stringify(evidence, null, 2);
}
async function sendGreeting() {
  const connection = controller.getSnapshot().connection;
  if (connection.kind !== 'connected') {
    result.textContent = 'Connect a testnet wallet first.';
    return;
  }
  greeting = `Seams connector acceptance ${new Date().toISOString()}`;
  result.textContent = `Approve in ${connection.wallet}: ${greeting}`;
  const sent = await controller.sendTransaction(connection, {
    receiverId: 'seams-v1.testnet',
    actions: [
      {
        type: 'FunctionCall',
        methodName: 'set_greeting',
        args: { greeting },
        gas: '10000000000000',
        deposit: '0',
      },
    ],
  });
  result.textContent = JSON.stringify(sent, null, 2);
  if (sent.ok) {
    submission = sent.value;
    await checkOutcome();
  }
}
async function checkOutcome() {
  if (!submission) return;
  const outcome = await controller.checkOutcome(submission);
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'readback',
      method: 'query',
      params: {
        request_type: 'call_function',
        account_id: 'seams-v1.testnet',
        method_name: 'get_greeting',
        args_base64: 'e30=',
        finality: 'final',
      },
    }),
  });
  const body = await response.json();
  const readback = body.result?.result
    ? JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)))
    : null;
  result.textContent = JSON.stringify(
    { outcome, greeting, readback, matches: readback === greeting },
    null,
    2,
  );
}
