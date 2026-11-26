// Inject browser rejections, and an assertion without user verification. Successful calls use
// the existing authenticator.
class PasskeyBrowserFaults {
  nextCreate = 'security';
  nextGet = sessionStorage.getItem('seams-e2e-passkey-get-fault') || 'none';
  observations = [];
  nativeCreate = navigator.credentials.create.bind(navigator.credentials);
  nativeGet = navigator.credentials.get.bind(navigator.credentials);

  takeFault(operation, kind) {
    this.observations.push({ operation, kind });
    switch (kind) {
      case 'security':
        return new DOMException(
          'WebAuthn is not supported on sites with TLS certificate errors.',
          'NotAllowedError',
        );
      case 'cancelled':
        return new DOMException(
          'The operation either timed out or was not allowed.',
          'NotAllowedError',
        );
      case 'unverified':
      case 'none':
        return null;
      default:
        throw new Error('Unknown browser fault: ' + kind);
    }
  }

  create(options) {
    const error = this.takeFault('create', this.nextCreate);
    this.nextCreate = 'none';
    if (error) return Promise.reject(error);
    return this.nativeCreate(options);
  }

  get(options) {
    const kind = this.nextGet;
    const error = this.takeFault('get', kind);
    this.nextGet = 'none';
    if (error) return Promise.reject(error);
    if (kind === 'unverified') return this.unverifiedGet(options);
    return this.nativeGet(options);
  }

  // A raw CTAP client can make a security key sign without its PIN. This assertion has the user
  // verified flag cleared and a valid signature from the test's copy of the passkey's key.
  async unverifiedGet(options) {
    const credential = await this.nativeGet(options);
    const keys = JSON.parse(sessionStorage.getItem('seams-e2e-passkey-signing-keys') || '{}');
    const pkcs8 = keys[base64Url(credential.rawId)];
    if (!pkcs8) throw new Error('No test signing key for the asserted passkey');
    const authenticatorData = new Uint8Array(credential.response.authenticatorData.slice(0));
    authenticatorData[32] &= ~0x04;
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', credential.response.clientDataJSON),
    );
    const signed = new Uint8Array(authenticatorData.length + clientDataHash.length);
    signed.set(authenticatorData);
    signed.set(clientDataHash, authenticatorData.length);
    const key = await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(atob(pkcs8), (char) => char.charCodeAt(0)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const p1363 = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed);
    Object.defineProperty(credential.response, 'authenticatorData', {
      value: authenticatorData.buffer,
    });
    Object.defineProperty(credential.response, 'signature', {
      value: derEcdsaSignature(new Uint8Array(p1363)).buffer,
    });
    return credential;
  }
}

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// WebAuthn carries an ECDSA signature as DER; WebCrypto gives r || s.
function derEcdsaSignature(p1363) {
  const integer = (bytes) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.slice(start);
    const value = trimmed[0] & 0x80 ? [0, ...trimmed] : [...trimmed];
    return [0x02, value.length, ...value];
  };
  const body = [...integer(p1363.slice(0, 32)), ...integer(p1363.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

if (navigator.credentials) {
  const faults = new PasskeyBrowserFaults();
  sessionStorage.removeItem('seams-e2e-passkey-get-fault');
  window.__passkeyBrowserFaults = faults;
  navigator.credentials.create = faults.create.bind(faults);
  navigator.credentials.get = faults.get.bind(faults);
}
