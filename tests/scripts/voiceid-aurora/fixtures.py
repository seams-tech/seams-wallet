"""Generate synthetic phrase audio for the browser E2E tests on macOS."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from vocabulary import phrase_bank


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--natural', action='store_true', help='Use 160 words per minute instead of 140')
    mode.add_argument('--tolerance', action='store_true', help='Generate bounded-tolerance cases')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.tolerance:
        generate_tolerance(args.output)
        return
    phrases = phrase_bank()
    rows = []
    for index, phrase in enumerate(phrases):
        aiff = args.output / f'{index}.aiff'
        wav = args.output / f'{index}.wav'
        source_wav = args.output / f'{index}-source.wav'
        # Both sets use connected speech, with a modest speaking-rate difference.
        rate = 160 if args.natural else 140
        tempo = 1
        subprocess.run(['say', '-v', 'Samantha', '-r', str(rate), '-o', str(aiff), phrase], check=True)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1',
                        str(aiff), str(source_wav)], check=True)
        wav.write_bytes(source_wav.read_bytes())
        aiff.unlink()
        source_wav.unlink()
        rows.append({'phrase': phrase, 'file': wav.name, 'voice': 'Samantha',
                     'rate': rate, 'tempo': tempo, 'sha256': hashlib.sha256(wav.read_bytes()).hexdigest()})
    (args.output / 'phrases.json').write_text(json.dumps(phrases, indent=2) + '\n')
    (args.output / 'generation.json').write_text(json.dumps(rows, indent=2) + '\n')


def generate_tolerance(output):
    cases = [
        ('omitted-articles', 'market is open'),
        ('rough-quote', 'i check the latest quotes'),
        ('outside-bound-quote', 'i checked a different number'),
        ('ambiguous', 'the market order looks ready'),
        ('unrelated', 'cancel my wallet and tell me the time'),
        ('reordered', 'quote latest check i'),
        ('negated', 'please never review my order'),
        ('fragment', 'latest quote'),
        ('missing-negation', 'crying in the casino'),
        ('changed-negation', 'never cry in the casino'),
        ('extra-negation', 'no approve this transfer at once'),
        ('ambiguous-ending', 'check my order care'),
        ('sale-homophone', 'please confirm this sail'),
    ]
    recordings = [(name, spoken, 'Samantha') for name, spoken in cases]
    for voice in ('Daniel', 'Karen'):
        for name, spoken in (
            ('swap', 'sign this swap today'),
            ('sale', 'please confirm this sale'),
            ('fearful', 'be fearful when others are retarded'),
            ('review', 'please review my order'),
            ('proceed', 'the sale is ready'),
        ):
            recordings.append((f'{name}-{voice.lower()}', spoken, voice))
    rows = []
    for name, spoken, voice in recordings:
        aiff = output / f'{name}.aiff'
        wav = output / f'{name}.wav'
        subprocess.run(['say', '-v', voice, '-r', '160', '-o', str(aiff), spoken], check=True)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(wav)], check=True)
        aiff.unlink()
        rows.append({'file': wav.name, 'spoken': spoken, 'voice': voice, 'rate': 160,
                     'sha256': hashlib.sha256(wav.read_bytes()).hexdigest()})
    (output / 'generation.json').write_text(json.dumps(rows, indent=2) + '\n')


if __name__ == '__main__':
    main()
