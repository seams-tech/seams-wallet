"""Generate synthetic phrase audio for the browser E2E tests on macOS."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_name('phrases.json')
    phrases = json.loads(source.read_text())
    rows = []
    for index, phrase in enumerate(phrases):
        aiff = args.output / f'{index}.aiff'
        wav = args.output / f'{index}.wav'
        source_wav = args.output / f'{index}-source.wav'
        # These rates preserve two seconds of speech and model recognition in the
        # synthetic browser fixture. They are not production capture settings.
        tempo = {5: .85, 7: .7, 8: .7, 9: .7, 10: .65, 12: .7}.get(index, .55)
        subprocess.run(['say', '-v', 'Samantha', '-r', '95', '-o', str(aiff), phrase], check=True)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1',
                        str(aiff), str(source_wav)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source_wav),
                        '-af', f'atempo={tempo}', '-ar', '16000', '-ac', '1', str(wav)], check=True)
        aiff.unlink()
        source_wav.unlink()
        rows.append({'phrase': phrase, 'file': wav.name, 'voice': 'Samantha',
                     'rate': 95, 'tempo': tempo, 'sha256': hashlib.sha256(wav.read_bytes()).hexdigest()})
    (args.output / 'phrases.json').write_text(source.read_text())
    (args.output / 'generation.json').write_text(json.dumps(rows, indent=2) + '\n')


if __name__ == '__main__':
    main()
