// Custom audio figure using Hairline's unchanged spring and shared-loop engine.
export function mountHairlineVoice(svg) {
  return new HairlineVoice(svg);
}
class HairlineVoice {
  lines = [];
  reduced = false;
  constructor(svg) {
  const {mk, spring, register} = window.HL;
  svg.setAttribute('viewBox', '0 0 320 96');
  for (let index = 0; index < 33; index += 1) {
    const stroke = mk('path', {
      fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2,
      'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke',
    }, svg);
    this.lines.push({stroke, spring: spring(0), index});
  }
  this.loop = register(svg, this.tick.bind(this));
  this.draw();
  }
  draw() {
    for (const line of this.lines) {
      const value = this.reduced ? line.spring.t * 0.25 : Math.max(0, line.spring.x);
      const x = 32 + line.index * 8;
      const height = 3 + value * 67;
      const bend = this.reduced ? 0 : value * 2.5 * Math.sin(line.index * 0.35);
      line.stroke.setAttribute('d', `M${x},${48-height/2} C${x+bend},${48-height/6} ${x-bend},${48+height/6} ${x},${48+height/2}`);
      line.stroke.setAttribute('opacity', String(0.45 + Math.min(0.55, value * 0.8)));
    }
  }
  tick(dt) {
    let moving = false;
    for (const line of this.lines) moving = window.HL.stepS(line.spring, dt) || moving;
    this.draw();
    return moving && !this.reduced;
  }
  update(energy, frequencies, live, reduce) {
    this.reduced = reduce;
    for (const line of this.lines) {
      const position = (line.index - 16) / 17;
      const taper = 0.2 + 0.8 * Math.pow(Math.max(0, 1-position*position), 0.7);
      const bin = Math.round(4 + Math.pow(line.index / 32, 1.7) * 150);
      const band = live ? frequencies[bin] / 255 : 0.55 + 0.45 * Math.sin(line.index * 1.3 + energy * 5) ** 2;
      line.spring.t = energy * taper * (0.25 + band * 0.75);
    }
    if (this.reduced) this.draw(); else this.loop.wake();
  }
  destroy() { this.loop.unregister(); }
}
