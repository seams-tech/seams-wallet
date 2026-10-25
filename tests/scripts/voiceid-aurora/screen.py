"""Repeat synthetic development cases with the exported native ONNX model."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import onnxruntime as ort
import sentencepiece as spm
import soundfile as sf


def collapsed_ids(logits):
    previous = -1
    tokens = []
    for value in logits.argmax(-1).reshape(-1):
        token = int(value)
        if token and token != previous:
            tokens.append(token)
        previous = token
    return tokens


def scores(logits, targets):
    values = logits[0].astype(np.float64)
    probabilities = values - np.logaddexp.reduce(values, axis=1)[:, None]
    results = []
    for target in targets:
        states = np.zeros(len(target) * 2 + 1, dtype=np.int64)
        states[1::2] = target
        previous = np.full(len(states), -np.inf)
        previous[0] = 0
        for frame in probabilities:
            current = previous.copy()
            current[1:] = np.logaddexp(current[1:], previous[:-1])
            if len(states) > 2:
                allowed = (states[2:] != 0) & (states[2:] != states[:-2])
                current[2:] = np.where(allowed, np.logaddexp(current[2:], previous[:-2]), current[2:])
            previous = current + frame[states]
        results.append(float(np.logaddexp.reduce(previous[-2:])))
    return np.array(results)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rate', type=int, default=160)
    parser.add_argument('--phrases', type=Path, default=Path(__file__).with_name('phrases.json'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    phrases = json.loads(args.phrases.read_text())
    tokenizer = spm.SentencePieceProcessor(model_file=str(args.model_root / 'bpe256.model'))
    targets = [[token + 1 for token in tokenizer.encode(phrase)] for phrase in phrases]
    runtime = ort.InferenceSession(str(args.model_root / 'aurora-int8.onnx'),
                                   providers=['CPUExecutionProvider'])
    results = []
    for index, case in enumerate(json.loads(args.cases.read_text())):
        spoken = case.get('spoken', case['expected'])
        voice = case.get('voice', 'Samantha')
        aiff = args.output / f'{index}.aiff'
        wav = args.output / f'{index}.wav'
        subprocess.run(['say', '-v', voice, '-r', str(case.get('rate', args.rate)), '-o', str(aiff), spoken], check=True)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1',
                        str(aiff), str(wav)], check=True)
        audio, rate = sf.read(wav, dtype='float32')
        if rate != 16000:
            raise ValueError('Expected 16 kHz audio')
        logits = runtime.run(None, {'samples': audio[None]})[0]
        greedy = collapsed_ids(logits)
        likelihoods = scores(logits, targets + [greedy])
        best = int(np.argmax(likelihoods[:-1]))
        gap = float(likelihoods[-1] - likelihoods[best])
        results.append({'kind': case.get('kind', 'spoken'), 'expected': case['expected'], 'spoken': spoken, 'voice': voice,
                        'recognized': phrases[best], 'gapToGreedy': gap, 'durationSeconds': len(audio) / rate,
                        'acceptedExpected': bool(greedy) and gap <= 8 and phrases[best] == case['expected']})
    (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
