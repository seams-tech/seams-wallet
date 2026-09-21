#!/usr/bin/env node
/**
 * Generate seams-components.css from the single source of truth:
 * - packages/wallet/src/theme/palette.json (all base scales + gradients)
 * - Mappings used by DARK_THEME/LIGHT_THEME in base-styles.ts for surfaces/text/borders
 *
 * This eliminates hardcoded palette numbers in CSS and prevents drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function resolveSdkRoot() {
  const cwd = process.cwd();
  const fromSdk = path.join(cwd, 'src', 'theme', 'palette.json');
  if (fs.existsSync(fromSdk)) return cwd;

  const fromRepo = path.join(cwd, 'packages', 'wallet', 'src', 'theme', 'palette.json');
  if (fs.existsSync(fromRepo)) return path.join(cwd, 'packages', 'wallet');

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

const sdkRoot = resolveSdkRoot();
const palettePath = path.join(sdkRoot, 'src', 'theme', 'palette.json');
const cssOutPath = path.join(
  sdkRoot,
  'src',
  'core',
  'signingEngine',
  'uiConfirm',
  'ui',
  'preact',
  'seams-components.css',
);

function fail(msg) {
  console.error(`\n[generate-seams-components-css] ${msg}`);
  process.exit(1);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    fail(`Unable to read JSON at ${p}: ${e?.message || e}`);
  }
}

const palette = readJson(palettePath);

const { grey = {}, slate = {}, gradients = {}, tokens = {}, themes = {} } = palette;
let chroma = palette.chroma || {};
if (!chroma || Object.keys(chroma).length === 0) {
  chroma = {};
  const exclude = new Set(['grey', 'slate', 'gradients', 'tokens', 'themes']);
  Object.keys(palette)
    .filter((k) => !exclude.has(k))
    .forEach((fam) => {
      if (palette[fam] && typeof palette[fam] === 'object') chroma[fam] = palette[fam];
    });
}

function get(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveRef(v) {
  if (typeof v !== 'string') return v;
  // Allow references like "grey.75" or "chroma.blue.500" or "tokens.buttonBackground" or "gradients.blue"
  const maybe = get({ grey, slate, chroma, gradients, tokens }, v);
  return maybe !== undefined ? maybe : v;
}

const emitScale = (name, scale) => {
  const keys = Object.keys(scale);
  keys.sort((a, b) => Number(a) - Number(b));
  return keys.map((k) => `  --seams-${name}${k}: ${scale[k]};`).join('\n');
};

const emitChroma = () => {
  const fams = Object.keys(chroma);
  fams.sort();
  const out = [];
  for (const fam of fams) {
    const keys = Object.keys(chroma[fam]);
    keys.sort((a, b) => Number(a) - Number(b));
    out.push(`\n  /* ${fam[0].toUpperCase()}${fam.slice(1)} */`);
    for (const k of keys) out.push(`  --seams-${fam}${k}: ${chroma[fam][k]};`);
  }
  return out.join('\n');
};

const emitGradients = () => {
  const names = Object.keys(gradients);
  names.sort();
  return names.map((n) => `  --seams-gradient-${n}: ${gradients[n]};`).join('\n');
};

const paletteVariablesBlock = `:root {
  /* Palette scales */
${emitScale('grey', grey)}
${emitScale('slate', slate)}
${emitChroma()}
${emitGradients()}
}`;

// Use centralized theme maps from packages/wallet/src/theme/base-styles.js
const baseStylesPath = path.join(sdkRoot, 'src', 'theme', 'base-styles.js');
const base = await import(pathToFileURL(baseStylesPath).href);
const { createThemeTokens } = base;
const { DARK_THEME: DARK_VARS, LIGHT_THEME: LIGHT_VARS } = createThemeTokens(palette);

const header = `/*
  AUTO-GENERATED FILE – DO NOT EDIT.
  Source: packages/wallet/src/theme/palette.json + mappings from packages/wallet/src/theme/base-styles.js (createThemeTokens)
  Run: node packages/wallet/scripts/codegen/generate-seams-components-css.mjs
*/`;

const surfaceSelectors = ['.seams-wallet-ui'];
const surfaceSelector = surfaceSelectors.join(',\n');

const darkBlock = `/* Base CSS variables for SEAMS UI surfaces */
${surfaceSelector} {
  /* Component defaults (no token alias assignments here) */
  --seams-modal__btn__focus-outline-color: ${chroma?.blue?.['400'] || '#3b82f6'};
  --seams-tree__file-content__scrollbar-track__background: rgba(255,255,255,0.06);
  --seams-tree__file-content__scrollbar-thumb__background: rgba(255,255,255,0.22);

  /* Neutral defaults for passkey halo loading (baseline outside confirmation context) */
  --seams-modal__passkey-halo-loading__ring-background: transparent 0%, var(--seams-colors-highlightHalo) 10%, var(--seams-colors-highlightHalo) 25%, transparent 35%;
  --seams-modal__passkey-halo-loading__inner-background: transparent;
  --seams-modal__passkey-halo-loading__inner-padding: 3px;
  --seams-modal__passkey-halo-loading-icon-container__background-color: var(--seams-colors-passkeyHaloBackground, var(--seams-colors-surface));
  --seams-modal__passkey-halo-loading-touch-icon__color: var(--seams-colors-textPrimary);
  --seams-modal__passkey-halo-loading-touch-icon__margin: 0.75rem;
  --seams-modal__passkey-halo-loading-touch-icon__stroke-width: 3.5;

  /* Default token aliases (dark) so components have tokens without relying on :root */
${emitAliasBlock(DARK_VARS)}
}`;

// Helper to emit a complete alias block from a vars map
function emitAliasBlock(vars) {
  return [
    `  --seams-colors-textPrimary: ${vars.textPrimary};`,
    `  --seams-colors-textSecondary: ${vars.textSecondary};`,
    `  --seams-colors-textMuted: ${vars.textMuted};`,
    `  --seams-colors-textButton: ${vars.textButton};`,
    `  --seams-colors-colorBackground: ${vars.colorBackground};`,
    `  --seams-colors-surface: ${vars.surface};`,
    `  --seams-colors-surface2: ${vars.surface2};`,
    `  --seams-colors-txDetailsBackground: ${vars.txDetailsBackground};`,
    `  --seams-colors-surface3: ${vars.surface3};`,
    `  --seams-colors-surface4: ${vars.surface4};`,
    `  --seams-colors-primary: ${vars.primary};`,
    `  --seams-colors-primaryHover: ${vars.primaryHover};`,
    `  --seams-colors-secondary: ${vars.secondary};`,
    `  --seams-colors-secondaryHover: ${vars.secondaryHover};`,
    `  --seams-colors-accent: ${vars.accent};`,
    `  --seams-colors-buttonBackground: ${vars.buttonBackground};`,
    `  --seams-colors-buttonHoverBackground: ${vars.buttonHoverBackground};`,
    `  --seams-colors-hover: ${vars.hover};`,
    `  --seams-colors-active: ${vars.active};`,
    `  --seams-colors-focus: ${vars.focus};`,
    `  --seams-colors-success: ${vars.success};`,
    `  --seams-colors-warning: ${vars.warning};`,
    `  --seams-colors-error: ${vars.error};`,
    `  --seams-colors-info: ${vars.info};`,
    `  --seams-colors-highlightPrimary: ${vars.highlightPrimary};`,
    `  --seams-colors-highlightHalo: ${vars.highlightHalo};`,
    `  --seams-colors-borderPrimary: ${vars.borderPrimary};`,
    `  --seams-colors-borderSecondary: ${vars.borderSecondary};`,
    `  --seams-colors-borderHover: ${vars.borderHover};`,
    `  --seams-colors-gradientPrimary: ${vars.gradientPrimary};`,
    `  --seams-colors-gradientSecondary: ${vars.gradientSecondary};`,
    `  --seams-colors-gradientTertiary: ${vars.gradientTertiary};`,
    `  --seams-colors-highlightReceiver: ${vars.highlightReceiver};`,
    `  --seams-colors-highlightMethodName: ${vars.highlightMethodName};`,
    `  --seams-colors-highlightAmount: ${vars.highlightAmount};`,
  ].join('\n');
}

// Also emit theme-specific alias blocks scoped to UI surfaces.
const themedLightSurfaceSelectors = surfaceSelectors
  .map((s) => {
    const themeAttribute = s === '.seams-wallet-ui' ? 'data-theme' : 'theme';
    return `${s}[${themeAttribute}="light"],\n:root[data-seams-theme="light"] ${s}:not([${themeAttribute}="dark"])`;
  })
  .join(',\n');
const surfaceThemeTokens = `${themedLightSurfaceSelectors} {\n${emitAliasBlock(LIGHT_VARS)}\n}`;

const cssOut = `${header}\n\n${paletteVariablesBlock}\n\n${darkBlock}\n\n${surfaceThemeTokens}\n`;

fs.mkdirSync(path.dirname(cssOutPath), { recursive: true });
fs.writeFileSync(cssOutPath, cssOut);
console.log('[generate-seams-components-css] Wrote', path.relative(process.cwd(), cssOutPath));
