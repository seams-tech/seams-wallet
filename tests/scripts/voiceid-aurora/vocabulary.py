"""Generate phrase tokens without re-exporting the unchanged speech model."""
import argparse
import json
from pathlib import Path

import sentencepiece as spm


def write_vocabulary(root, destination):
    phrases = json.loads(Path(__file__).with_name('phrases.json').read_text())
    tokenizer = spm.SentencePieceProcessor(model_file=str(root / 'bpe256.model'))
    tokens = [[token + 1 for token in tokenizer.encode(phrase)] for phrase in phrases]
    destination.write_text(
        '// Generated from the pinned Aurora tokenizer by tests/scripts/voiceid-aurora/vocabulary.py.\n'
        + 'export const SPOKEN_PHRASES = ' + json.dumps(phrases, indent=2) + ' as const;\n'
        + 'export const PHRASE_TOKENS: readonly (readonly number[])[] = '
        + json.dumps(tokens, indent=2) + ';\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--vocabulary', type=Path, required=True)
    args = parser.parse_args()
    write_vocabulary(args.root, args.vocabulary)


if __name__ == '__main__':
    main()
