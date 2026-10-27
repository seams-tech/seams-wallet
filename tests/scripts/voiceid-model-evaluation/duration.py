"""Measure short-probe rejection at the fixed deployed B1 threshold."""
import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort


def normalized(values):
    values = np.asarray(values).reshape(-1)
    return values / np.linalg.norm(values)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    corpus = json.loads((args.root / 'corpus.json').read_text())
    rows = [row for row in corpus['samples']
            if row['split'] == 'evaluation' and row['seconds'] == 4]
    templates = {}
    for speaker in sorted({row['speaker'] for row in rows}):
        enrollment = [row['reference']['b1'] for row in rows
                      if row['speaker'] == speaker and row['role'] == 'enrollment']
        templates[speaker] = normalized(np.mean(enrollment, axis=0))
    runtime = ort.InferenceSession(str(args.root / 'b1.onnx'), providers=['CPUExecutionProvider'])
    results = []
    for seconds in (.75, 1, 1.5, 2, 3, 4):
        owners = []
        others = []
        for row in rows:
            if row['role'] != 'probe':
                continue
            audio = np.fromfile(args.root / 'pcm' / f"{row['id']}.f32", dtype='<f4')
            count = int(seconds * 16000)
            start = max(0, (len(audio) - count) // 2)
            crop = audio[start:start + count]
            embedding = normalized(runtime.run(None, {'samples': crop[None]})[0])
            for speaker, template in templates.items():
                scores = owners if speaker == row['speaker'] else others
                scores.append(float(embedding @ template))
        results.append({
            'probeSeconds': seconds,
            'enrollmentSeconds': 4,
            'threshold': .5,
            'ownerTrials': len(owners),
            'ownerRejects': sum(score < .5 for score in owners),
            'otherTrials': len(others),
            'otherAccepts': sum(score >= .5 for score in others),
            'medianOwnerScore': float(np.median(owners)),
        })
    args.output.write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
