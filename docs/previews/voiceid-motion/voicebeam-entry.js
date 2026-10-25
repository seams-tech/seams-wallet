import React from 'react';
import { createRoot } from 'react-dom/client';
// This is the exact component re-exported by @seams/wallet/react.
import { VoiceBeam } from 'voice-glow';

const element = React.createElement;
// Cool fringes and no corner tails keep the glow centred and free of red edges.
const bandColors = {above: '#8fd3e6', mid: '#a7e3d3', below: '#8a9cff'};
function BeamCard({getLevel, state}) {
  const live = state.mode === 'live';
  return element(VoiceBeam, {
    className: 'sdk-voice-beam', theme: state.theme, level: getLevel,
    processing: state.mode === 'processing', active: true,
    staticColors: true, colorVariant: 'ocean', borderRadius: 22,
    paused: state.reduced, idle: 0.1, rangeWidth: 0.56, spread: 0.7,
    bandTail: 0, bandAberration: 0.35, bandColors,
  }, element('div', {className: 'card beam-card', 'data-mode': state.mode},
    element('div', {className: 'beam-top'},
      element('span', {className: 'beam-pill'}, 'Read aloud'),
      element('span', {className: 'beam-pill'},
        element('span', {className: 'beam-dot', 'aria-hidden': true}),
        element('span', {className: 'state', role: 'status'}, state.caption))),
    element('div', {className: 'phrase beam-phrase'}, element('span', null,
      word('This'), ' ', word('is'), ' ', word('my'), element('br'),
      word('own'), ' ', word('voice.'))),
    element('div', {className: 'visual', 'aria-hidden': !state.showBars && !state.showRibbon && !state.showHairline},
      element('canvas', {id: 'glow-bars', className: state.showRibbon ? 'beam-ribbon' : state.showBars ? '' : 'bars-hidden', role: 'img', 'aria-label': state.showRibbon ? 'Flowing ribbon with VoiceBeam glow' : 'Centered bars with VoiceBeam glow'}),
      element('svg', {id: 'glow-hairline', className: state.showHairline ? 'hairline-voice' : 'hairline-voice bars-hidden', role: 'img', 'aria-label': 'Hairline spring-driven vocal lines'})),
    element('div', {className: 'beam-actions'},
      element('button', {type: 'button', className: 'beam-icon', 'aria-label': 'Start again', onClick: state.onRestart}, restartIcon()),
      element('button', {type: 'button', className: 'beam-icon beam-mic', 'aria-label': live ? 'Stop microphone' : 'Use microphone', 'aria-pressed': live, onClick: state.onMicrophone}, live ? stopIcon() : microphoneIcon()),
      element('span', {className: 'beam-time', 'aria-hidden': true})),
  ));
}
function word(text) {
  return element('span', {className: 'beam-word'}, text);
}
function icon(...paths) {
  return element('svg', {viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, ...paths);
}
function restartIcon() {
  return icon(element('path', {d: 'M4 12a8 8 0 1 0 2.4-5.7'}), element('path', {d: 'M4 4v4.5h4.5'}));
}
function microphoneIcon() {
  return icon(element('rect', {x: 9, y: 3, width: 6, height: 11, rx: 3}), element('path', {d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21'}));
}
function stopIcon() {
  return icon(element('rect', {x: 7, y: 7, width: 10, height: 10, rx: 2, fill: 'currentColor', stroke: 'none'}));
}
export function mountVoiceBeam(host, getLevel) {
  const root = createRoot(host);
  return { update: renderBeam.bind(null, root, getLevel), dispose: root.unmount.bind(root) };
}
function renderBeam(root, getLevel, state) {
  root.render(element(BeamCard, {getLevel, state}));
}
