"""Generate deterministic synthetic noise and speech mixtures; never uses user audio."""
import argparse
import random
import struct
import wave
from pathlib import Path


def write_clip(path, samples):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(struct.pack('<' + 'h' * len(samples), *samples))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = Path('tests/fixtures/audio/aurora/natural')
    for index in range(-1, 16):
        rng = random.Random(425 + index)
        noise = [rng.gauss(0, 0.012) for _ in range(128000)]
        speech = []
        if index >= 0:
            with wave.open(str(source / f'{index}.wav'), 'rb') as audio:
                assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
                speech = struct.unpack('<' + 'h' * audio.getnframes(), audio.readframes(audio.getnframes()))
        samples = []
        for offset, background in enumerate(noise):
            value = background + (speech[offset] / 32768 if offset < len(speech) else 0)
            samples.append(round(max(-1, min(0.9999, value)) * 32768))
        write_clip(args.output / ('noise.wav' if index < 0 else f'{index}.wav'), samples)


if __name__ == '__main__':
    main()
