function cloneRejects(response) {
  try {
    response.clone();
    return false;
  } catch (error) {
    return error instanceof TypeError;
  }
}

async function streamClone(env) {
  const response = await env.ROUTER.fetch('https://probe/stream');
  const copy = response.clone();
  const copyText = await copy.text();
  const originalText = await response.text();

  const locked = await env.ROUTER.fetch('https://probe/stream');
  const lockedReader = locked.body.getReader();
  const rejectsLocked = cloneRejects(locked);
  lockedReader.releaseLock();
  await locked.body.cancel();

  const disturbed = await env.ROUTER.fetch('https://probe/stream');
  const reader = disturbed.body.getReader();
  await reader.read();
  reader.releaseLock();
  const rejectsDisturbed = cloneRejects(disturbed);
  await disturbed.body.cancel();

  return Response.json({
    originalText,
    copyText,
    originalStatus: response.status,
    copyStatus: copy.status,
    originalHeader: response.headers.get('x-stream-owner'),
    copyHeader: copy.headers.get('x-stream-owner'),
    rejectsConsumed: cloneRejects(response),
    rejectsLocked,
    rejectsDisturbed,
  });
}

async function importError(raw, algorithm, usages) {
  try {
    await crypto.subtle.importKey('raw', raw, algorithm, true, usages);
    return null;
  } catch (error) {
    return error.name;
  }
}

async function rawExportError(key) {
  try {
    await crypto.subtle.exportKey('raw', key);
    return null;
  } catch (error) {
    return error.name;
  }
}

function hexByte(value) {
  return Number.parseInt(value, 16);
}

async function rawEcPublicKeys() {
  const generator = Uint8Array.from(
    (
      '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296' +
      '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'
    ).match(/../g),
    hexByte,
  );
  await crypto.subtle.importKey('raw', generator, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const curves = [];
  for (const namedCurve of ['P-256', 'P-384', 'P-521']) {
    const algorithm = { name: 'ECDH', namedCurve };
    const sender = await crypto.subtle.generateKey(algorithm, false, ['deriveKey']);
    const recipient = await crypto.subtle.generateKey(algorithm, true, ['deriveKey']);
    const senderRaw = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
    const recipientRaw = new Uint8Array(await crypto.subtle.exportKey('raw', recipient.publicKey));
    const importedSender = await crypto.subtle.importKey('raw', senderRaw, algorithm, true, []);
    const importedRecipient = await crypto.subtle.importKey(
      'raw',
      recipientRaw,
      algorithm,
      false,
      [],
    );
    const encryptionKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: importedRecipient },
      sender.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const decryptionKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: importedSender },
      recipient.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const encoder = new TextEncoder();
    const encryption = {
      name: 'AES-GCM',
      iv: crypto.getRandomValues(new Uint8Array(12)),
      additionalData: encoder.encode('synthetic-wallet-binding'),
      tagLength: 128,
    };
    const ciphertext = await crypto.subtle.encrypt(
      encryption,
      encryptionKey,
      encoder.encode('synthetic-linked-device-credential'),
    );
    const plaintext = await crypto.subtle.decrypt(encryption, decryptionKey, ciphertext);
    let changedAadError = null;
    try {
      await crypto.subtle.decrypt(
        { ...encryption, additionalData: encoder.encode('changed-wallet-binding') },
        decryptionKey,
        ciphertext,
      );
    } catch (error) {
      changedAadError = error.name;
    }
    const wrongCurve = namedCurve === 'P-256' ? 'P-384' : 'P-256';
    const offCurve = new Uint8Array(senderRaw.length);
    offCurve[0] = 4;
    const verifyKey = await crypto.subtle.importKey(
      'raw',
      senderRaw,
      { name: 'ECDSA', namedCurve },
      true,
      ['verify'],
    );
    curves.push({
      namedCurve,
      size: senderRaw.length,
      prefix: senderRaw[0],
      roundTrip:
        Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', importedSender))).join() ===
        Array.from(senderRaw).join(),
      ecdsaRoundTrip:
        Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', verifyKey))).join() ===
        Array.from(senderRaw).join(),
      plaintext: new TextDecoder().decode(plaintext),
      changedAadError,
      shortPointError: await importError(senderRaw.slice(1), algorithm, []),
      offCurveError: await importError(offCurve, algorithm, []),
      infinityError: await importError(new Uint8Array([0]), algorithm, []),
      wrongCurveError: await importError(senderRaw, { name: 'ECDH', namedCurve: wrongCurve }, []),
      publicUsageError: await importError(senderRaw, algorithm, ['deriveKey']),
      signingUsageError: await importError(senderRaw, { name: 'ECDSA', namedCurve }, ['sign']),
      nonextractableError: await rawExportError(importedRecipient),
      privateExportError: await rawExportError(recipient.privateKey),
    });
  }
  const secureCurves = [];
  for (const name of ['Ed25519', 'X25519']) {
    const usages = name === 'Ed25519' ? ['sign', 'verify'] : ['deriveKey'];
    const pair = await crypto.subtle.generateKey({ name }, false, usages);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const publicUsages = name === 'Ed25519' ? ['verify'] : [];
    const imported = await crypto.subtle.importKey('raw', raw, { name }, true, publicUsages);
    secureCurves.push({
      name,
      size: raw.length,
      roundTrip:
        Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', imported))).join() ===
        Array.from(raw).join(),
    });
  }
  return Response.json({ generatorImported: true, curves, secureCurves });
}

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/raw-ec-public-keys') {
      return rawEcPublicKeys();
    }
    if (path === '/stream-clone') {
      return streamClone(env);
    }
    if (path === '/health') {
      return new Response('ready');
    }
    if (path.startsWith('/service/')) {
      return env.ROUTER.fetch(request);
    }
    const namespace = path.startsWith('/alias/') ? env.ALIAS : env.TENANT_ROOT;
    const id = namespace.idFromName('tenant');
    const restored = namespace.idFromString(id.toString());
    return namespace.get(restored).fetch(request);
  },
};
