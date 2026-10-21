/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import {
  WALLET_RECOVERY_CODE_ALPHABET,
  WALLET_RECOVERY_CODE_CHAR_LENGTH,
  WALLET_RECOVERY_CODE_GROUP_LENGTH,
} from '@shared/wallet-recovery/recoveryCodes';

const RECOVERY_CODE_CHARACTERS: ReadonlySet<string> = new Set(WALLET_RECOVERY_CODE_ALPHABET);

/* Crockford Base32 reads O as 0 and I or L as 1, so a misread letter still
   enters the character the code holds. Separators and any other character
   are dropped: no code contains them. */
export function recoveryInputCharacters(code: string): string {
  let characters = '';
  for (const character of code.toUpperCase()) {
    const read = character === 'O' ? '0' : character === 'I' || character === 'L' ? '1' : character;
    if (RECOVERY_CODE_CHARACTERS.has(read)) characters += read;
  }
  return characters;
}

/** The part of the recovery code the input's selection covers, in code characters. */
export type RecoveryCodeSelection = { readonly start: number; readonly end: number };

/** The characters the last edit added, which settle into their slots. */
export type RecoveryCodeArrival = { readonly start: number; readonly end: number };

const RECOVERY_CODE_SEPARATOR = /[\s\-\u2010-\u2015\u2212]/;

/** Characters the input dropped because no recovery code contains them, such as U. */
export function rejectedRecoveryCharacters(input: string): string[] {
  const rejected = new Set<string>();
  for (const character of input.toUpperCase()) {
    if (RECOVERY_CODE_SEPARATOR.test(character)) continue;
    if (recoveryInputCharacters(character)) continue;
    rejected.add(character);
  }
  return Array.from(rejected).slice(0, 3);
}

export function renderRecoveryCodeGroups(
  code: string,
  selection: RecoveryCodeSelection | null,
  arrival: RecoveryCodeArrival | null,
): ComponentChildren[] {
  const caret = selection && selection.start === selection.end ? selection.start : null;
  // A full code has no empty slot, so its caret sits after the last character.
  const lastIndex = WALLET_RECOVERY_CODE_CHAR_LENGTH - 1;
  const focusIndex = selection === null ? null : Math.min(selection.start, lastIndex);
  const groups: ComponentChildren[] = [];
  for (
    let start = 0;
    start < WALLET_RECOVERY_CODE_CHAR_LENGTH;
    start += WALLET_RECOVERY_CODE_GROUP_LENGTH
  ) {
    const end = start + WALLET_RECOVERY_CODE_GROUP_LENGTH;
    const slots: ComponentChildren[] = [];
    for (let index = start; index < end; index += 1) {
      const character = code[index] ?? '';
      const classes = ['seams-otp-slot'];
      if (character) classes.push('is-filled');
      if (index === caret) classes.push('is-caret');
      if (caret === WALLET_RECOVERY_CODE_CHAR_LENGTH && index === lastIndex) {
        classes.push('is-caret-after');
      }
      if (selection && index >= selection.start && index < selection.end) {
        classes.push('is-selected');
      }
      if (arrival && index >= arrival.start && index < arrival.end) classes.push('is-new');
      slots.push(
        <span class={classes.join(' ')} key={index} data-recovery-slot={index}>
          {character}
        </span>,
      );
    }
    const groupClasses = ['seams-recovery-code-group'];
    if (focusIndex !== null && focusIndex >= start && focusIndex < end) {
      groupClasses.push('is-active');
    }
    if (code.length >= end) groupClasses.push('is-complete');
    groups.push(
      <div class={groupClasses.join(' ')} key={start}>
        {slots}
      </div>,
    );
  }
  return groups;
}
