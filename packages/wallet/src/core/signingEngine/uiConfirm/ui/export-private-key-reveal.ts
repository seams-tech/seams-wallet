import type { ExportPrivateKeyScheme } from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';

const HEX_REEL_ALPHABET = '0123456789abcdef';
const BASE58_REEL_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const REEL_GLYPH_MIN_HOLD_MS = 90;
const REEL_GLYPH_MAX_HOLD_MS = 150;
const REEL_SETTLE_HOLD_EXTENSION_MS = 90;
const REEL_SETTLE_STAGGER_MS = 700;
const REEL_SETTLE_SPIN_MS = 300;

type ReelSlot = {
  glyph: string;
  nextChangeAtMs: number;
};

export type PrivateKeyRevealState =
  | {
      kind: 'spinning';
      entryKey: string;
      prefix: string;
      alphabet: string;
      slots: ReelSlot[];
    }
  | {
      kind: 'settling';
      entryKey: string;
      prefix: string;
      alphabet: string;
      slots: ReelSlot[];
      targetSlots: string[];
      lockedSlots: number;
      startedAtMs: number;
    }
  | { kind: 'settled'; entryKey: string };

type ReelDefinition = {
  prefix: string;
  alphabet: string;
  slotCount: number;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected private key reveal state: ${String(value)}`);
}

function reelDefinition(scheme: ExportPrivateKeyScheme): ReelDefinition {
  switch (scheme) {
    case 'secp256k1':
      return { prefix: '0x', alphabet: HEX_REEL_ALPHABET, slotCount: 64 };
    case 'ed25519':
      return { prefix: 'ed25519:', alphabet: BASE58_REEL_ALPHABET, slotCount: 88 };
    default:
      return assertNever(scheme);
  }
}

function randomReelGlyph(alphabet: string): string {
  return alphabet[Math.floor(Math.random() * alphabet.length)] ?? alphabet[0] ?? 'x';
}

function randomGlyphHoldMs(minimumMs: number, maximumMs: number): number {
  return minimumMs + Math.random() * (maximumMs - minimumMs);
}

function createReelSlots(
  definition: ReelDefinition,
  reducedMotion: boolean,
  now: number,
): ReelSlot[] {
  const slots: ReelSlot[] = [];
  for (let index = 0; index < definition.slotCount; index += 1) {
    slots.push({
      glyph: reducedMotion ? 'x' : randomReelGlyph(definition.alphabet),
      nextChangeAtMs: reducedMotion ? Number.POSITIVE_INFINITY : now + ((index * 37) % 90),
    });
  }
  return slots;
}

export function createSpinningState(
  entryKey: string,
  scheme: ExportPrivateKeyScheme,
  reducedMotion: boolean,
  now: number,
): Extract<PrivateKeyRevealState, { kind: 'spinning' }> {
  const definition = reelDefinition(scheme);
  return {
    kind: 'spinning',
    entryKey,
    prefix: definition.prefix,
    alphabet: definition.alphabet,
    slots: createReelSlots(definition, reducedMotion, now),
  };
}

export function maskedPrivateKey(privateKey: string): string {
  if (!privateKey) return '';
  const prefix = 'ed25519:';
  const prefixLength = privateKey.startsWith(prefix) ? prefix.length : 0;
  const visibleStartLength = prefixLength + 6;
  const hiddenEnd = Math.max(visibleStartLength, privateKey.length - 6);
  return `${privateKey.slice(0, visibleStartLength)}${'x'.repeat(
    hiddenEnd - visibleStartLength,
  )}${privateKey.slice(hiddenEnd)}`;
}

export function settlingState(
  state: Extract<PrivateKeyRevealState, { kind: 'spinning' }>,
  maskedTarget: string,
  startedAtMs: number,
): Extract<PrivateKeyRevealState, { kind: 'settling' }> {
  const prefix = maskedTarget.startsWith(state.prefix) ? state.prefix : '';
  const targetSlots = Array.from(maskedTarget.slice(prefix.length));
  const slots =
    targetSlots.length === state.slots.length
      ? state.slots
      : targetSlots.map((_, index) => ({
          glyph: randomReelGlyph(state.alphabet),
          nextChangeAtMs: startedAtMs + ((index * 37) % 90),
        }));
  return {
    kind: 'settling',
    entryKey: state.entryKey,
    prefix,
    alphabet: state.alphabet,
    slots,
    targetSlots,
    lockedSlots: 0,
    startedAtMs,
  };
}

function lockedSlotCount(state: Extract<PrivateKeyRevealState, { kind: 'settling' }>, now: number) {
  const lastIndex = Math.max(1, state.targetSlots.length - 1);
  let count = 0;
  for (let index = 0; index < state.targetSlots.length; index += 1) {
    const stagger = (index / lastIndex) * REEL_SETTLE_STAGGER_MS;
    if (now >= state.startedAtMs + stagger + REEL_SETTLE_SPIN_MS) count += 1;
  }
  return count;
}

function settlingProgress(
  state: Extract<PrivateKeyRevealState, { kind: 'settling' }>,
  index: number,
  now: number,
): number {
  const lastIndex = Math.max(1, state.targetSlots.length - 1);
  const stagger = (index / lastIndex) * REEL_SETTLE_STAGGER_MS;
  const slotStartedAtMs = state.startedAtMs + stagger;
  return Math.max(0, Math.min(1, (now - slotStartedAtMs) / REEL_SETTLE_SPIN_MS));
}

function cycleSpinningSlots(slots: ReelSlot[], alphabet: string, now: number): ReelSlot[] {
  let nextSlots: ReelSlot[] | null = null;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot || now < slot.nextChangeAtMs) continue;
    if (nextSlots === null) nextSlots = [...slots];
    nextSlots[index] = {
      glyph: randomReelGlyph(alphabet),
      nextChangeAtMs: now + randomGlyphHoldMs(REEL_GLYPH_MIN_HOLD_MS, REEL_GLYPH_MAX_HOLD_MS),
    };
  }
  return nextSlots ?? slots;
}

function cycleSettlingSlots(
  state: Extract<PrivateKeyRevealState, { kind: 'settling' }>,
  lockedSlots: number,
  now: number,
): ReelSlot[] {
  let nextSlots: ReelSlot[] | null = null;
  for (let index = 0; index < state.slots.length; index += 1) {
    const slot = state.slots[index];
    if (!slot) continue;
    if (index < lockedSlots) {
      const targetGlyph = state.targetSlots[index] ?? slot.glyph;
      if (slot.glyph === targetGlyph && slot.nextChangeAtMs === Number.POSITIVE_INFINITY) continue;
      if (nextSlots === null) nextSlots = [...state.slots];
      nextSlots[index] = { glyph: targetGlyph, nextChangeAtMs: Number.POSITIVE_INFINITY };
      continue;
    }
    if (now < slot.nextChangeAtMs) continue;
    const holdExtensionMs = settlingProgress(state, index, now) * REEL_SETTLE_HOLD_EXTENSION_MS;
    if (nextSlots === null) nextSlots = [...state.slots];
    nextSlots[index] = {
      glyph: randomReelGlyph(state.alphabet),
      nextChangeAtMs:
        now +
        randomGlyphHoldMs(
          REEL_GLYPH_MIN_HOLD_MS + holdExtensionMs,
          REEL_GLYPH_MAX_HOLD_MS + holdExtensionMs,
        ),
    };
  }
  return nextSlots ?? state.slots;
}

export function advanceRevealState(
  state: Exclude<PrivateKeyRevealState, { kind: 'settled' }>,
  now: number,
): PrivateKeyRevealState {
  if (state.kind === 'spinning') {
    const slots = cycleSpinningSlots(state.slots, state.alphabet, now);
    if (slots === state.slots) return state;
    return {
      ...state,
      slots,
    };
  }

  if (state.kind === 'settling') {
    const nextLockedSlots = lockedSlotCount(state, now);
    if (nextLockedSlots >= state.targetSlots.length) {
      return { kind: 'settled', entryKey: state.entryKey };
    }
    const slots = cycleSettlingSlots(state, nextLockedSlots, now);
    if (slots === state.slots && nextLockedSlots === state.lockedSlots) return state;
    return {
      ...state,
      slots,
      lockedSlots: nextLockedSlots,
    };
  }

  return assertNever(state);
}

export function privateKeyEntryKey(index: number, scheme: ExportPrivateKeyScheme): string {
  return `${index}:${scheme}`;
}
