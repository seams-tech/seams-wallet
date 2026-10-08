import assert from 'node:assert/strict';

const addressHeader = 'x-seams-yao-delivery-address';
const deliveryPath = '/router-ab/signing-worker/ed25519-yao/activation/packages';

export function deliveryHeaders(delivery, credential) {
  return {
    'content-type': 'application/json',
    'x-router-ab-internal-service-auth': credential,
    [addressHeader]: JSON.stringify({
      wallet_home: delivery.wallet_home,
      ownership_generation: delivery.ownership_generation,
      scope: delivery.scope,
    }),
  };
}

export async function readDeliveryBody(request) {
  try {
    const body = await request.text();
    return body.length === 0 ? undefined : body;
  } catch {
    // An unsuccessful Yao ceremony cancels the unfinished upload.
    return undefined;
  }
}

export async function verifyDeliveryAddress(topology, activation, credential) {
  const worker = await topology.getWorker('fixture-signing-worker');
  const delivery = JSON.parse(activation.delivery);
  const headers = deliveryHeaders(delivery, credential);
  const correct = await worker.fetch(`https://signing-worker.test${deliveryPath}`, {
    method: 'POST',
    headers,
    body: activation.delivery,
  });
  assert.equal(correct.status, 200, await correct.clone().text());
  const committed = await correct.text();
  const rejected = [];
  for (const field of ['wallet_home', 'ownership_generation', 'scope']) {
    const address = JSON.parse(headers[addressHeader]);
    if (field === 'wallet_home') {
      address.wallet_home = delivery.wallet_home === 'OC' ? 'US' : 'OC';
    }
    if (field === 'ownership_generation') {
      address.ownership_generation += 1;
    }
    if (field === 'scope') {
      address.scope.wallet_id += '-another-wallet';
    }
    const response = await worker.fetch(`https://signing-worker.test${deliveryPath}`, {
      method: 'POST',
      headers: { ...headers, [addressHeader]: JSON.stringify(address) },
      body: activation.delivery,
    });
    const text = await response.text();
    assert.notEqual(response.status, 200, text);
    assert.match(text, /packages do not match the delivery address/);
    rejected.push(field);
  }
  const unauthorized = await worker.fetch(`https://signing-worker.test${deliveryPath}`, {
    method: 'POST',
    headers: { ...headers, 'x-router-ab-internal-service-auth': 'wrong-credential' },
    body: activation.delivery,
  });
  assert.notEqual(unauthorized.status, 200);
  await unauthorized.arrayBuffer();
  const replay = await worker.fetch(`https://signing-worker.test${deliveryPath}`, {
    method: 'POST',
    headers,
    body: activation.delivery,
  });
  assert.equal(replay.status, 200);
  assert.equal(await replay.text(), committed);
  return {
    rejectedAddressFields: rejected,
    unauthorizedRejected: true,
    exactReceiptRetained: true,
  };
}
