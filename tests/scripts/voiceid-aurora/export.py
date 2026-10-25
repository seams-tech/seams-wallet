"""Export pinned AuroraASR INT8 with full-waveform preprocessing for browser WASM."""
import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from vocabulary import write_vocabulary
import torch
import torch.nn.functional as functional
from safetensors.torch import load_file
from torch.onnx.symbolic_helper import parse_args

REVISION = 'cd307b54b4d666d6ad7dc982a7a58a96d6e7f942'
SOURCE_FILES = ('modeling_auroraasr.py', 'configuration_auroraasr.py', 'feature_extraction_auroraasr.py')
MODEL_HASH = '83ed6f3856458cd96d49a70d8c5175aeec18ba8c184e5367e089cd424eebefd6'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def provision(root):
    names = (*SOURCE_FILES, 'config.json', 'model.safetensors', 'bpe256.model',
             'int8/model.safetensors', 'int8/config.json')
    for name in names:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            url = f'https://huggingface.co/AuroraAI-Research/AuroraASR-1M/resolve/{REVISION}/{name}'
            urllib.request.urlretrieve(url, target)
    package = root / 'source/aurora'
    package.mkdir(parents=True, exist_ok=True)
    (package / '__init__.py').touch()
    for name in SOURCE_FILES:
        shutil.copyfile(root / name, package / name)
    sys.path.insert(0, str(root / 'source'))
    return {name: sha256(root / name) for name in names}


class Spectrum(torch.autograd.Function):
    @staticmethod
    def forward(ctx, samples, window):
        spectrum = torch.stft(samples, 512, 160, 512, window, center=True,
                              pad_mode='reflect', return_complex=True)
        return torch.view_as_real(spectrum).pow(2).sum(-1)

    @staticmethod
    @parse_args('v', 'v')
    def symbolic(graph, samples, window):
        padding = graph.op('Constant', value_t=torch.tensor([0, 256, 0, 256], dtype=torch.int64))
        axis = graph.op('Constant', value_t=torch.tensor([-1], dtype=torch.int64))
        padded = graph.op('Unsqueeze', graph.op('Pad', samples, padding, mode_s='reflect'), axis)
        step = graph.op('Constant', value_t=torch.tensor(160, dtype=torch.int64))
        frame = graph.op('Constant', value_t=torch.tensor(512, dtype=torch.int64))
        spectrum = graph.op('STFT', padded, step, window, frame, onesided_i=1)
        power = graph.op('ReduceSum', graph.op('Mul', spectrum, spectrum), axis, keepdims_i=0)
        return graph.op('Transpose', power, perm_i=[0, 2, 1])


class Waveform(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        from aurora.feature_extraction_auroraasr import _mel_filterbank
        self.model = model
        self.register_buffer('window', functional.pad(torch.hann_window(400), (56, 56)))
        filters = _mel_filterbank(16000, 512, 80, 20., 8000.)
        self.register_buffer('filters', torch.from_numpy(filters))

    def forward(self, samples):
        power = Spectrum.apply(samples, self.window)
        mel = (torch.matmul(self.filters, power) + 1e-10).log().transpose(1, 2)
        mel = (mel - mel.mean(1, keepdim=True)) / (mel.std(1, keepdim=True) + 1e-5)
        return self.model(mel, return_dict=False)[0]


def load(root, precision):
    from aurora.configuration_auroraasr import AuroraASRConfig
    from aurora.modeling_auroraasr import AuroraASRForCTC
    directory = root if precision == 'fp32' else root / 'int8'
    config = AuroraASRConfig(**json.loads((directory / 'config.json').read_text()))
    model = AuroraASRForCTC(config).eval()
    model.load_state_dict(load_file(directory / 'model.safetensors'), strict=True)
    return model


def export(root, precision):
    model = Waveform(load(root, precision)).eval()
    output = root / f'aurora-{precision}.onnx'
    with torch.inference_mode():
        torch.onnx.export(model, torch.randn(1, 64000) * .02, str(output),
                          input_names=['samples'], output_names=['logits'],
                          dynamic_axes={'samples': {1: 'sample_count'}, 'logits': {1: 'frames'}},
                          opset_version=17, dynamo=False, do_constant_folding=False)
    onnx.checker.check_model(str(output), full_check=True)
    runtime = ort.InferenceSession(str(output), providers=['CPUExecutionProvider'])
    checks = []
    generator = torch.Generator().manual_seed(417)
    for count in (16000, 32000, 64000, 128001):
        samples = torch.randn(1, count, generator=generator) * .02
        with torch.inference_mode():
            expected = model(samples).numpy()
        actual = runtime.run(None, {'samples': samples.numpy()})[0]
        error = float(np.max(np.abs(expected - actual)))
        agreement = float(np.mean(expected.argmax(-1) == actual.argmax(-1)))
        if error > .005 or agreement != 1:
            raise ValueError(f'{precision} reference parity failed for {count} samples')
        checks.append({'samples': count, 'maxAbsoluteLogitError': error, 'argmaxAgreement': agreement})
    return {'precision': precision, 'bytes': output.stat().st_size, 'sha256': sha256(output), 'checks': checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--vocabulary', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(1)
    args.root.mkdir(parents=True, exist_ok=True)
    sources = provision(args.root)
    models = [export(args.root, precision) for precision in ('fp32', 'int8')]
    if models[1]['sha256'] != MODEL_HASH:
        raise ValueError('Export differs from the pinned browser artifact; inspect before updating the digest')
    write_vocabulary(args.root, args.vocabulary)
    report = {'revision': REVISION, 'sourceHashes': sources, 'models': models,
              'vocabularySha256': sha256(args.vocabulary),
              'versions': {'torch': torch.__version__, 'onnx': onnx.__version__,
                           'onnxruntime': ort.__version__, 'numpy': np.__version__}}
    (args.root / 'export.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
