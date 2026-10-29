"""Generate the phrase bank and decoder pieces without re-exporting the model."""
import argparse
import json
from pathlib import Path

CONFIRMATION_PHRASES = {
    'sale': ['approve this sale at once', 'let the sale go through'],
    'purchase': ['this purchase has my approval', 'please confirm my purchase'],
    'swap': ['confirm my swap today', 'the swap is ready to proceed'],
    'transfer': ['confirm this transfer today', 'please send this transfer now'],
}


def challenge_phrases():
    phrases = json.loads(Path(__file__).with_name('phrases.json').read_text())
    actions = ('approve the swap', 'check my order', 'confirm the trade', 'review this transfer')
    moments = ('right now', 'with care', 'for me')
    return phrases + [f'{action} {moment}' for action in actions for moment in moments]


def phrase_bank():
    phrases = challenge_phrases()
    for candidates in CONFIRMATION_PHRASES.values():
        phrases.extend(candidates)
    return phrases


def write_vocabulary(root, destination):
    import sentencepiece as spm

    tokenizer = spm.SentencePieceProcessor(model_file=str(root / 'bpe256.model'))
    destination.write_text(
        '// Generated from the pinned Aurora tokenizer by tests/scripts/voiceid-aurora/vocabulary.py.\n'
        + 'export const CHALLENGE_PHRASES = ' + json.dumps(challenge_phrases(), indent=2) + ' as const;\n'
        + 'export const CONFIRMATION_PHRASES = ' + json.dumps(CONFIRMATION_PHRASES, indent=2) + ' as const;\n'
        + 'export const SPOKEN_PHRASES = [\n  ...CHALLENGE_PHRASES,\n'
        + ''.join(f'  ...CONFIRMATION_PHRASES.{action},\n' for action in CONFIRMATION_PHRASES)
        + '] as const;\n'
        + 'export const PHRASE_TOKEN_PIECES: readonly string[] = '
        + json.dumps([''] + [tokenizer.id_to_piece(index) for index in range(tokenizer.get_piece_size())], indent=2)
        + ';\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--vocabulary', type=Path, required=True)
    args = parser.parse_args()
    write_vocabulary(args.root, args.vocabulary)


if __name__ == '__main__':
    main()
