// Inject only browser rejections. Successful calls use the existing authenticator.
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
    const error = this.takeFault('get', this.nextGet);
    this.nextGet = 'none';
    if (error) return Promise.reject(error);
    return this.nativeGet(options);
  }
}

if (navigator.credentials) {
  const faults = new PasskeyBrowserFaults();
  sessionStorage.removeItem('seams-e2e-passkey-get-fault');
  window.__passkeyBrowserFaults = faults;
  navigator.credentials.create = faults.create.bind(faults);
  navigator.credentials.get = faults.get.bind(faults);
}
