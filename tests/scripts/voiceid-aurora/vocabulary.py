"""Generate the phrase bank and decoder pieces without re-exporting the model."""
import argparse
import json
from pathlib import Path

def phrase_bank():
    phrases = json.loads(Path(__file__).with_name('phrases.json').read_text())
    actions = ('approve the swap', 'check my order', 'confirm the trade', 'review this transfer')
    moments = ('before market close', 'when prices settle', 'after market opens')
    return phrases + [f'{action} {moment}' for action in actions for moment in moments]


def write_vocabulary(root, destination):
    import sentencepiece as spm

    phrases = phrase_bank()
    tokenizer = spm.SentencePieceProcessor(model_file=str(root / 'bpe256.model'))
    destination.write_text(
        '// Generated from the pinned Aurora tokenizer by tests/scripts/voiceid-aurora/vocabulary.py.\n'
        + 'export const SPOKEN_PHRASES = ' + json.dumps(phrases, indent=2) + ' as const;\n'
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
