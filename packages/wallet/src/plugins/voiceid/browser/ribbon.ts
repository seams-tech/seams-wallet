import type { VoiceActivityEvent } from './microphone';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const WIDTH = 308;
const MID = 32;
type RibbonPhase = 'idle' | 'listening' | 'processing';

/** Visual feedback from recorder activity. Never opens or retains an audio stream. */
export class VoiceRibbon {
  readonly element: SVGSVGElement;
  private readonly paths: SVGPathElement[] = [];
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private phase: RibbonPhase = 'idle';
  private frame = 0;
  private previousTime = 0;
  private position = 0;
  private target = 0;
  private level = 0;
  private stopped = false;

  constructor(document: Document) {
    this.element = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.element.classList.add('seams-voiceid-ribbon');
    this.element.setAttribute('viewBox', `0 0 ${WIDTH} 64`);
    this.element.setAttribute('aria-hidden', 'true');
    for (let layer = 3; layer >= 0; layer -= 1) {
      const path = document.createElementNS(SVG_NAMESPACE, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', layer === 0 ? '1' : '0.65');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      this.element.append(path);
      this.paths.push(path);
    }
    this.paint();
  }

  readonly readLevel = (): number => this.level;

  setPhase(phase: RibbonPhase): void {
    this.phase = phase;
    this.target = phase === 'processing' ? 0.1 : 0;
    this.element.dataset.phase = phase;
    this.wake();
  }

  add(event: VoiceActivityEvent): void {
    if (this.phase !== 'listening' || this.stopped) return;
    const signal = Math.max(0, event.rms - 0.003);
    this.target = Math.pow(signal / (signal + 0.055), 0.65) * (event.speech ? 1 : 0.15);
    this.element.dataset.speech = String(event.speech);
    this.wake();
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.level = 0;
    this.target = 0;
  }

  private wake(): void {
    if (!this.stopped && this.frame === 0) {
      this.previousTime = performance.now();
      this.frame = requestAnimationFrame(this.draw);
    }
  }

  private readonly draw = (time: number): void => {
    this.frame = 0;
    if (this.stopped) return;
    const dt = Math.min(50, Math.max(0, time - this.previousTime));
    this.previousTime = time;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / (this.target > this.level ? 55 : 200)));
    if (!this.motion.matches) this.position += dt * (0.002 + this.level * 0.003);
    this.paint();
    if (this.phase !== 'idle' || this.level > 0.001) this.frame = requestAnimationFrame(this.draw);
  };

  private paint(): void {
    for (let index = 0; index < this.paths.length; index += 1) {
      const layer = 3 - index;
      let path = '';
      for (let x = 0; x <= WIDTH; x += 2) {
        const u = x / WIDTH;
        const taper = Math.pow(Math.sin(Math.PI * u), 1.7);
        const wave = Math.sin(u * Math.PI * 4 - this.position + layer * 0.5) * 0.7
          + Math.sin(u * Math.PI * 7 + this.position * 0.7 + layer) * 0.3;
        const displacement = this.motion.matches
          ? this.level * 5 * taper
          : this.level * (26 - layer * 4) * taper * wave;
        path += `${x === 0 ? 'M' : 'L'}${x},${(MID + displacement).toFixed(2)} `;
      }
      this.paths[index].setAttribute('d', path);
      this.paths[index].setAttribute('opacity', String(layer === 0 ? 0.55 + this.level * 0.4 : 0.1 + this.level * 0.1));
    }
  }
}
