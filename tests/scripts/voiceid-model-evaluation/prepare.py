"""Export pinned ReDimNet candidates and prepare a public speaker evaluation.

Runs offline after the documented source, checkpoints, corpus, and ECAPA export
are downloaded. Does not read Wallet storage or user recordings.
"""
import argparse
import copy
import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import soundfile as sf
import torch
import torch.nn.functional as functional
from torch.onnx.symbolic_helper import parse_args

SOURCE_REVISION = 'ce039a624cb99fe127702ceb94c6080090e5032f'
WEIGHTS_REVISION = '5180983b6895dafa0cd88aa88e8a07296df27834'
SAMPLE_RATE = 16000
CHECKPOINT_HASHES = {
    'b0': '68b8507be1f859d49e4cfd0c2d2bd7aa94e6a288a7df21e65276c9a5d5886cb0',
    'b1': '6e634bbbeb0f6afd9bbbb0606da834f93e23e4869b3954177a5717acc20ea36c',
}
ECAPA_HASH = '0d56d37287767d3c43a4f2ffc7ed12452bdd73d67c40428acd78279ecff8d5c3'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(vector):
    vector = np.asarray(vector, dtype=np.float64).reshape(-1)
    if vector.size != 192 or not np.isfinite(vector).all():
        raise ValueError('Expected a finite 192-dimensional speaker embedding')
    norm = np.linalg.norm(vector)
    if norm <= 1e-12:
        raise ValueError('Empty speaker embedding')
    return vector / norm


class ExportPowerSpectrum(torch.autograd.Function):
    @staticmethod
    def forward(ctx, samples, window, hop):
        spectrum = torch.stft(samples, n_fft=512, hop_length=hop, win_length=512,
                              window=window, center=True, pad_mode='reflect',
                              normalized=False, onesided=True, return_complex=True)
        return spectrum.abs().pow(2)

    @staticmethod
    @parse_args('v', 'v', 'i')
    def symbolic(graph, samples, window, hop):
        padding = graph.op('Constant', value_t=torch.tensor([0, 256, 0, 256], dtype=torch.int64))
        padded = graph.op('Pad', samples, padding, mode_s='reflect')
        last_axis = graph.op('Constant', value_t=torch.tensor([-1], dtype=torch.int64))
        real_input = graph.op('Unsqueeze', padded, last_axis)
        step = graph.op('Constant', value_t=torch.tensor(hop, dtype=torch.int64))
        frame = graph.op('Constant', value_t=torch.tensor(512, dtype=torch.int64))
        spectrum = graph.op('STFT', real_input, step, window, frame, onesided_i=1)
        power = graph.op('ReduceSum', graph.op('Mul', spectrum, spectrum), last_axis, keepdims_i=0)
        return graph.op('Transpose', power, perm_i=[0, 2, 1])


class OnnxSpectrogram(torch.nn.Module):
    def __init__(self, reference):
        super().__init__()
        assert reference.n_fft == 512 and reference.win_length == 400
        assert reference.power == 2 and reference.center and reference.pad_mode == 'reflect'
        assert not reference.normalized and reference.pad == 0 and reference.onesided
        self.hop = reference.hop_length
        self.register_buffer('window', functional.pad(reference.window, (56, 56)))

    def forward(self, samples):
        return ExportPowerSpectrum.apply(samples, self.window, self.hop)


def load_reference(root, name):
    from redimnet.model import ReDimNetWrap
    if digest(root / f'{name}.pt') != CHECKPOINT_HASHES[name]:
        raise ValueError(f'{name} checkpoint differs from the pinned artifact')
    checkpoint = torch.load(root / f'{name}.pt', map_location='cpu', weights_only=True)
    model = ReDimNetWrap(**checkpoint['model_config']).eval()
    model.load_state_dict(checkpoint['state_dict'], strict=True)
    return model


def export_candidate(root, name, reference):
    candidate = copy.deepcopy(reference)
    mel = candidate.spec.torchfbank[2]
    mel.spectrogram = OnnxSpectrogram(mel.spectrogram)
    output = root / f'{name}.onnx'
    generator = torch.Generator().manual_seed(417)
    with torch.inference_mode():
        torch.onnx.export(candidate, torch.randn(1, 64000, generator=generator), str(output),
                          input_names=['samples'], output_names=['embedding'],
                          dynamic_axes={'samples': {1: 'sample_count'}},
                          opset_version=17, dynamo=False)
    onnx.checker.check_model(str(output), full_check=True)
    runtime = ort.InferenceSession(str(output), providers=['CPUExecutionProvider'])
    checks = []
    for count in (16000, 32000, 64000, 128000, 128001):
        samples = torch.randn(1, count, generator=generator) * 0.05
        with torch.inference_mode():
            expected = reference(samples).numpy()
        actual = runtime.run(None, {'samples': samples.numpy()})[0]
        similarity = float(normalize(expected) @ normalize(actual))
        checks.append({'sampleCount': count, 'cosine': similarity,
                       'maxAbsoluteError': float(np.max(np.abs(expected - actual)))})
        if similarity < 0.99999:
            raise AssertionError(f'{name} conversion differs from PyTorch: {checks[-1]}')
    return {'name': name, 'bytes': output.stat().st_size,
            'gzipBytes': len(gzip.compress(output.read_bytes(), compresslevel=6, mtime=0)),
            'sha256': digest(output), 'checkpointSha256': digest(root / f'{name}.pt'),
            'referenceChecks': checks}


def speech_crop(samples, seconds):
    count = seconds * SAMPLE_RATE
    start = max(0, (len(samples) - count) // 2)
    samples = samples[start:start + count].astype(np.float32)
    # Match the Wallet's energy-based speech trimming, without changing the model frontend.
    frames = samples[:len(samples) // 160 * 160].reshape(-1, 160)
    voiced = np.flatnonzero(np.sqrt(np.mean(frames * frames, axis=1)) >= 0.006)
    if len(voiced) < (200 if seconds == 4 else 100):
        return None
    start = max(0, int(voiced[0]) * 160 - 3200)
    end = min(len(samples), (int(voiced[-1]) + 1) * 160 + 3200)
    return samples[start:end].copy()


def select_corpus(root):
    corpus = root / 'LibriSpeech/test-clean'
    speakers = []
    for speaker in sorted(corpus.iterdir(), key=numeric_name):
        if not speaker.is_dir():
            continue
        chapters = []
        for chapter in sorted(speaker.iterdir(), key=numeric_name):
            clips = []
            for path in sorted(chapter.glob('*.flac')):
                info = sf.info(path)
                if info.samplerate == SAMPLE_RATE and info.frames >= 4 * SAMPLE_RATE:
                    samples, _ = sf.read(path, dtype='float32')
                    if speech_crop(samples, 4) is not None and speech_crop(samples, 2) is not None:
                        clips.append(path)
            if len(clips) >= 4:
                chapters.append(clips)
        if len(chapters) >= 2:
            speakers.append((speaker.name, chapters[0][:3], chapters[1][:4]))
    if len(speakers) < 20:
        raise ValueError('Need at least 20 speakers with two qualifying chapters')
    return speakers


def numeric_name(path):
    return int(path.name) if path.name.isdigit() else -1


def prepare_samples(root, references, ecapa):
    speakers = select_corpus(root)
    # Split by speaker before scoring. Alternating sorted IDs balances split size.
    output = root / 'pcm'
    output.mkdir(exist_ok=True)
    runtime = ort.InferenceSession(str(ecapa), providers=['CPUExecutionProvider'])
    items = []
    for index, (speaker, enrollment, probes) in enumerate(speakers):
        split = 'calibration' if index % 2 == 0 else 'evaluation'
        for role, paths in [('enrollment', enrollment), ('probe', probes)]:
            for path in paths:
                waveform, _ = sf.read(path, dtype='float32')
                for seconds in (4, 2):
                    samples = speech_crop(waveform, seconds)
                    item_id = f'{path.stem}-{seconds}s'
                    pcm_path = output / f'{item_id}.f32'
                    samples.astype('<f4').tofile(pcm_path)
                    tensor = torch.from_numpy(samples[None])
                    embeddings = {}
                    with torch.inference_mode():
                        for name, model in references.items():
                            embeddings[name] = normalize(model(tensor).numpy()).tolist()
                    embeddings['ecapa'] = normalize(runtime.run(None, {'samples': samples[None]})[0]).tolist()
                    items.append({'id': item_id, 'speaker': speaker, 'chapter': path.parent.name,
                                  'split': split, 'role': role, 'seconds': seconds,
                                  'sampleCount': len(samples), 'sha256': digest(pcm_path),
                                  'source': str(path.relative_to(root)), 'reference': embeddings})
        print(f'Prepared speaker {index + 1}/{len(speakers)}', flush=True)
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--ecapa', type=Path, required=True)
    parser.add_argument('--export-only', action='store_true')
    args = parser.parse_args()
    if digest(args.ecapa) != ECAPA_HASH:
        raise ValueError('ECAPA export differs from the current Wallet model')
    torch.set_num_threads(1)
    sys.path.insert(0, str(args.root / 'source' / f'redimnet-{SOURCE_REVISION}'))
    references = {name: load_reference(args.root, name) for name in ('b0', 'b1')}
    models = []
    for name, model in references.items():
        metadata = export_candidate(args.root, name, model)
        models.append(metadata)
        print(json.dumps(metadata), flush=True)
    models.append({'name': 'ecapa', 'bytes': args.ecapa.stat().st_size,
                   'gzipBytes': len(gzip.compress(args.ecapa.read_bytes(), compresslevel=6, mtime=0)),
                   'sha256': digest(args.ecapa)})
    report = {'sourceRevision': SOURCE_REVISION, 'weightsRevision': WEIGHTS_REVISION,
              'versions': {'torch': torch.__version__, 'onnx': onnx.__version__,
                           'onnxruntime': ort.__version__, 'numpy': np.__version__},
              'models': models}
    (args.root / 'exports.json').write_text(json.dumps(report, indent=2) + '\n')
    if not args.export_only:
        report['samples'] = prepare_samples(args.root, references, args.ecapa)
        (args.root / 'corpus.json').write_text(json.dumps(report) + '\n')


if __name__ == '__main__':
    main()
