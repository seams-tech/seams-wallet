/** @jsxImportSource preact */
import { render } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

type ProbeProps = {
  count: number;
  onIncrement: () => void;
  onDispose: () => void;
};

function registerLifetime(onDispose: () => void): () => void {
  return onDispose;
}

function Probe({ count, onIncrement, onDispose }: ProbeProps) {
  useLayoutEffect(registerLifetime.bind(null, onDispose), []);
  return (
    <button type="button" onClick={onIncrement}>
      {count}
    </button>
  );
}

export function renderProbe(root: HTMLElement, props: ProbeProps): void {
  render(<Probe {...props} />, root);
}

export function disposeProbe(root: HTMLElement): void {
  render(null, root);
}
