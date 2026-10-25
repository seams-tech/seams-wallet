"""Repeat synthetic development cases with the exported native ONNX model."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import onnxruntime as ort
import sentencepiece as spm
import soundfile as sf
import torch


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
    probabilities = torch.from_numpy(logits).log_softmax(-1).transpose(0, 1)
    inputs = probabilities.expand(-1, len(targets), -1)
    lengths = torch.tensor([len(target) for target in targets])
    flattened = torch.tensor([token for target in targets for token in target])
    loss = torch.nn.functional.ctc_loss(
        inputs, flattened, torch.full((len(targets),), probabilities.shape[0], dtype=torch.long),
        lengths, reduction='none', zero_infinity=False)
    return -loss.numpy()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    phrases = json.loads(Path(__file__).with_name('phrases.json').read_text())
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
        subprocess.run(['say', '-v', voice, '-r', '95', '-o', str(aiff), spoken], check=True)
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
        results.append({'expected': case['expected'], 'spoken': spoken, 'voice': voice,
                        'recognized': phrases[best], 'gapToGreedy': gap,
                        'acceptedExpected': bool(greedy) and gap <= 8 and phrases[best] == case['expected']})
    (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
