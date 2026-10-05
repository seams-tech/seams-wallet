import { createRoot } from 'react-dom/client';

const modulePath = '/_test-sdk/esm/react/hooks/useQRCamera.js';
const { useQRCamera, QRScanMode } = (await import(
  modulePath
)) as typeof import('../../../packages/wallet/src/react/hooks/useQRCamera');
const requests: MediaStreamConstraints[] = [];
const tracks: MediaStreamTrack[] = [];

async function enumerateDevices() {
  return [
    { kind: 'videoinput', deviceId: 'front', label: 'Front camera' },
    { kind: 'videoinput', deviceId: 'back', label: 'Back camera' },
  ];
}

async function getUserMedia(constraints: MediaStreamConstraints) {
  requests.push(constraints);
  if (requests.length === 1) {
    throw new DOMException('Permission denied', 'NotAllowedError');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'white';
  context.fillRect(0, 0, 64, 64);
  const stream = canvas.captureStream(10);
  tracks.push(...stream.getTracks());
  return stream;
}

Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { enumerateDevices, getUserMedia },
});

function Camera() {
  const camera = useQRCamera({ cameraId: 'front' });
  return (
    <>
      <video ref={camera.videoRef} muted autoPlay playsInline />
      <output data-testid="state">
        {JSON.stringify({
          scanning: camera.isScanning,
          error: camera.error,
          selected: camera.selectedCamera,
          front: camera.isFrontCamera,
        })}
      </output>
      <button onClick={camera.startScanning}>Start</button>
      <button onClick={camera.stopScanning}>Stop</button>
      <button onClick={camera.selectCamera.bind(null, 'back')}>Back camera</button>
      <button onClick={camera.setScanMode.bind(null, QRScanMode.FILE)}>File mode</button>
      <button onClick={camera.setScanMode.bind(null, QRScanMode.CAMERA)}>Camera mode</button>
    </>
  );
}

function snapshot() {
  return { requests, tracks: tracks.map(trackState) };
}

function trackState(track: MediaStreamTrack) {
  return track.readyState;
}

const container = document.createElement('main');
document.body.append(container);
const root = createRoot(container);
Object.assign(window, { cameraEvidence: snapshot, unmountCamera: root.unmount.bind(root) });
root.render(<Camera />);
