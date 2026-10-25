"""Compare VAD and RMS on synthetic noise. Optionally evaluate spectral denoising."""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import sentencepiece as spm


def measure(runtime, samples):
    state = np.zeros((2, 1, 128), np.float32)
    context = np.zeros(64, np.float32)
    speech_frames = 0
    rms_frames = 0
    started = time.perf_counter()
    for offset in range(0, len(samples), 512):
        chunk = np.zeros(512, np.float32)
        segment = samples[offset:offset + 512]
        chunk[:len(segment)] = segment
        inputs = np.concatenate((context, chunk))[None]
        output, state = runtime.run(None, {
            'input': inputs, 'state': state, 'sr': np.array(16000, np.int64),
        })
        context = chunk[-64:]
        speech_frames += int(output[0, 0] >= .5)
        rms_frames += int(np.sqrt(np.mean(chunk ** 2)) >= .006)
    return {
        'durationMs': len(samples) / 16,
        'vadSpeechMs': speech_frames * 32,
        'rmsActiveMs': rms_frames * 32,
        'inferenceMs': (time.perf_counter() - started) * 1000,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tokenizer', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    runtime = ort.InferenceSession(str(args.model), providers=['CPUExecutionProvider'])
    audio, rate = sf.read('tests/fixtures/audio/aurora/natural/2.wav', dtype='float32')
    assert rate == 16000
    speech = np.pad(audio, (8000, 32000))
    noise = np.random.default_rng(42).normal(0, .012, len(speech)).astype('float32')
    cases = {'quiet': speech, 'steady_noise': noise,
             'speech_with_noise': speech + noise, 'background_speech': speech * .3}
    mixed = args.output / 'mixed.wav'
    reduced = args.output / 'spectral-reduction.wav'
    sf.write(mixed, cases['speech_with_noise'], 16000, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(mixed),
                    '-af', 'afftdn=nr=12:nf=-38', str(reduced)], check=True)
    cases['spectral_reduction'], _ = sf.read(reduced, dtype='float32')
    speaker = ort.InferenceSession('packages/wallet/assets/voiceid/redimnet-b1.onnx')
    phrase = ort.InferenceSession('packages/wallet/assets/voiceid/aurora-int8.onnx')
    tokenizer = spm.SentencePieceProcessor(model_file=str(args.tokenizer))
    reference = speaker.run(None, {'samples': speech[None]})[0].reshape(-1)
    rows = []
    for name, samples in cases.items():
        embedding = speaker.run(None, {'samples': samples[None]})[0].reshape(-1)
        similarity = float(np.dot(reference, embedding) / (np.linalg.norm(reference) * np.linalg.norm(embedding)))
        logits = phrase.run(None, {'samples': samples[None]})[0]
        tokens = []
        previous = -1
        for token in logits.argmax(-1).reshape(-1):
            token = int(token)
            if token and token != previous:
                tokens.append(token - 1)
            previous = token
        rows.append({'case': name, **measure(runtime, samples),
                     'speakerSimilarityToClean': similarity,
                     'unconstrainedTranscript': tokenizer.decode(tokens)})
    result = {
        'modelBytes': args.model.stat().st_size,
        'sha256': hashlib.sha256(args.model.read_bytes()).hexdigest(),
        'scope': 'synthetic steady noise; native ONNX; no human accuracy claim',
        'cases': rows,
    }
    (args.output / 'baseline.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
