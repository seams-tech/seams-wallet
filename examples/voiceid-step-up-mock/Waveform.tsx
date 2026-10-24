import React, { useEffect, useRef } from 'react';

const BAR_COUNT = 45;
const bars = Array.from({ length: BAR_COUNT }, bar);

function bar(_: unknown, index: number): React.ReactNode {
  return <rect key={index} x={index * 5 + 2} y="30" width="2.5" height="4" rx="1.25" />;
}

class WaveformAnimation {
  private frame = 0;
  private previousTime = 0;
  private readonly history = new Float32Array(BAR_COUNT);
  private readonly bars: NodeListOf<SVGRectElement>;

  constructor(
    element: SVGSVGElement,
    private readonly level: () => number,
  ) {
    this.bars = element.querySelectorAll('rect');
    this.frame = requestAnimationFrame(this.draw);
  }

  private readonly draw = (time: number): void => {
    const interval = matchMedia('(prefers-reduced-motion: reduce)').matches ? 160 : 45;
    if (time - this.previousTime >= interval) {
      this.previousTime = time;
      this.history.copyWithin(0, 1);
      this.history[BAR_COUNT - 1] = this.level();
      for (let index = 0; index < BAR_COUNT; index += 1) {
        const height = 4 + this.history[index] * 52;
        this.bars[index].setAttribute('height', String(height));
        this.bars[index].setAttribute('y', String(32 - height / 2));
      }
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  readonly stop = (): void => {
    cancelAnimationFrame(this.frame);
  };
}

function animate(ref: React.RefObject<SVGSVGElement | null>, level: () => number): () => void {
  if (!ref.current) throw new Error('Waveform element is unavailable');
  return new WaveformAnimation(ref.current, level).stop;
}

export function Waveform({ level }: { level: () => number }): React.ReactNode {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(animate.bind(null, ref, level), [level]);
  return (
    <svg ref={ref} className="waveform" viewBox="0 0 227 64" aria-hidden="true">
      {bars}
    </svg>
  );
}
