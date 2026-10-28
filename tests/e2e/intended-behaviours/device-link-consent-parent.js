// Runs only in the synthetic embedding page. The Wallet iframe remains unmodified.
const originalDeviceLinkPostMessage = MessagePort.prototype.postMessage;
const deviceLinkParentProbe = { port: null, requests: [], replies: [] };

function collectDeviceLinkReply(event) {
  const message = event.data;
  if (message && typeof message.requestId === 'string') {
    deviceLinkParentProbe.replies.push({
      type: message.type,
      requestId: message.requestId,
      error: message.type === 'ERROR' ? message.payload : null,
    });
  }
}

function captureDeviceLinkPostMessage(...args) {
  const message = args[0];
  if (message?.type === 'PM_SCAN_AND_LINK_DEVICE') {
    if (!deviceLinkParentProbe.port) {
      deviceLinkParentProbe.port = this;
      this.addEventListener('message', collectDeviceLinkReply);
    }
    deviceLinkParentProbe.requests.push(structuredClone(message));
  }
  return Reflect.apply(originalDeviceLinkPostMessage, this, args);
}

function sendHostileDeviceLinkMessage(message) {
  if (!deviceLinkParentProbe.port) throw new Error('The device-link port is absent');
  deviceLinkParentProbe.port.postMessage(message);
}

if (window.parent === window) {
  MessagePort.prototype.postMessage = captureDeviceLinkPostMessage;
  window.__deviceLinkParentProbe = deviceLinkParentProbe;
  window.__sendHostileDeviceLinkMessage = sendHostileDeviceLinkMessage;
}
