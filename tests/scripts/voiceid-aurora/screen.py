"""Screen unconstrained transcripts; browser contracts own phrase acceptance."""
import argparse
import json
import subprocess
from pathlib import Path

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rate', type=int, default=160)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    tokenizer = spm.SentencePieceProcessor(model_file=str(args.model_root / 'bpe256.model'))
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
        decoded = tokenizer.decode([token - 1 for token in greedy])
        results.append({
            'kind': case.get('kind', 'spoken'),
            'expected': case['expected'],
            'spoken': spoken,
            'voice': voice,
            'decodedText': decoded,
            'durationSeconds': len(audio) / rate,
            'exactTranscript': decoded == case['expected'],
        })
    (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
