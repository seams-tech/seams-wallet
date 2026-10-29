"""Export pinned Citrinet-256 with waveform preprocessing and INT8 weights.

INT8 weights use per-channel DequantizeLinear nodes. Activations and arithmetic
remain FP32, as in the current Aurora weight-only export. No calibration clips
are used to choose quantization scales or phrase thresholds.
"""
import argparse
import gzip
import hashlib
import json
import tarfile
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper
import onnxruntime as ort
import soundfile
import torch
from torch.nn import functional as functional
from torch.onnx.symbolic_helper import parse_args
import yaml

from model import Citrinet, fold_normalization, map_weights

REVISION = 'c7cdacff0262bbb2a17771d20ec9f9f3b5cff6ed'
CHECKPOINT_SHA256 = 'a00c8fb75a2bcc37271275293bce950863e4e069d43f6cf193d42fcf605aa21c'
CHECKPOINT_NAME = 'stt_en_citrinet_256_ls.nemo'


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def checkpoint(root):
    archive = root / CHECKPOINT_NAME
    if not archive.exists():
        url = f'https://huggingface.co/nvidia/stt_en_citrinet_256_ls/resolve/{REVISION}/{CHECKPOINT_NAME}'
        urllib.request.urlretrieve(url, archive)
    if digest(archive) != CHECKPOINT_SHA256:
        raise ValueError('Citrinet checkpoint digest differs from the pinned source')
    with tarfile.open(archive) as source:
        for name in ('model_config.yaml', 'model_weights.ckpt', 'vocab.txt'):
            member = source.getmember(f'./{name}')
            if not member.isfile():
                raise ValueError(f'Expected regular checkpoint file: {name}')
            (root / name).write_bytes(source.extractfile(member).read())
    config = yaml.safe_load((root / 'model_config.yaml').read_text())
    weights = torch.load(root / 'model_weights.ckpt', map_location='cpu', weights_only=True)
    model = Citrinet(config).eval()
    model.load_state_dict(map_weights(weights, config), strict=True)
    return model, weights, config


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
    def __init__(self, model, weights):
        super().__init__()
        self.model = model
        window = weights['preprocessor.featurizer.window']
        self.register_buffer('window', functional.pad(window, (56, 56)))
        self.register_buffer('filters', weights['preprocessor.featurizer.fb'][0])

    def forward(self, samples):
        emphasized = torch.cat((samples[:, :1], samples[:, 1:] - .97 * samples[:, :-1]), dim=1)
        power = Spectrum.apply(emphasized, self.window)
        features = (torch.matmul(self.filters, power) + 2.0 ** -24).log()
        features = (features - features.mean(-1, keepdim=True)) / (features.std(-1, keepdim=True) + 1e-5)
        return self.model(features)


def quantize_weights(source, destination):
    graph = onnx.load(source)
    initializers = {tensor.name: tensor for tensor in graph.graph.initializer}
    converted = {}
    nodes = []
    for node in graph.graph.node:
        if node.op_type in ('Conv', 'MatMul') and len(node.input) > 1:
            name = node.input[1]
            tensor = initializers.get(name)
            if tensor is not None and tensor.data_type == onnx.TensorProto.FLOAT and 'filters' not in name:
                if name not in converted:
                    weights = numpy_helper.to_array(tensor)
                    axis = 0 if node.op_type == 'Conv' else weights.ndim - 1
                    reduce_axes = tuple(index for index in range(weights.ndim) if index != axis)
                    scale = np.maximum(np.max(np.abs(weights), axis=reduce_axes) / 127, 1e-12).astype(np.float32)
                    shape = [1] * weights.ndim
                    shape[axis] = weights.shape[axis]
                    quantized = np.clip(np.rint(weights / scale.reshape(shape)), -127, 127).astype(np.int8)
                    quantized_name, scale_name, zero_name = f'{name}.int8', f'{name}.scale', f'{name}.zero'
                    converted[name] = (
                        numpy_helper.from_array(quantized, quantized_name),
                        numpy_helper.from_array(scale, scale_name),
                        numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), zero_name),
                    )
                    nodes.append(helper.make_node('DequantizeLinear',
                                 [quantized_name, scale_name, zero_name], [name], axis=axis))
        nodes.append(node)
    retained = [tensor for tensor in graph.graph.initializer if tensor.name not in converted]
    for tensors in converted.values():
        retained.extend(tensors)
    del graph.graph.initializer[:]
    graph.graph.initializer.extend(retained)
    del graph.graph.node[:]
    graph.graph.node.extend(nodes)
    onnx.checker.check_model(graph, full_check=True)
    onnx.save(graph, destination)
    return len(converted)


def describe(file):
    data = file.read_bytes()
    return {'file': file.name, 'bytes': len(data), 'gzipBytes': len(gzip.compress(data, mtime=0)),
            'sha256': hashlib.sha256(data).hexdigest()}


def decode(logits, vocabulary):
    tokens = []
    previous = -1
    for token in logits.argmax(-1).reshape(-1).tolist():
        if token != previous and token < len(vocabulary) and not vocabulary[token].startswith('['):
            tokens.append(vocabulary[token])
        previous = token
    text = ''
    glue = False
    for token in tokens:
        if token.startswith('##'):
            text += token[2:]
        elif token == "'":
            text += token
            glue = True
            continue
        else:
            text += ('' if glue or not text else ' ') + token
        glue = False
    return text.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--vocabulary', type=Path, required=True)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    torch.manual_seed(729)
    original, weights, config = checkpoint(args.root)
    reference = Waveform(original, weights).eval()
    model = Waveform(fold_normalization(original), weights).eval()
    floating = args.root / 'citrinet-fp32.onnx'
    integer = args.root / 'citrinet-int8.onnx'
    with torch.inference_mode():
        torch.onnx.export(model, torch.randn(1, 32000) * .02, str(floating),
                          input_names=['samples'], output_names=['logits'],
                          dynamic_axes={'samples': {1: 'sample_count'}, 'logits': {1: 'frames'}},
                          opset_version=17, dynamo=False, do_constant_folding=True)
    onnx.checker.check_model(str(floating), full_check=True)
    quantized_count = quantize_weights(floating, integer)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    fp32 = ort.InferenceSession(str(floating), options, providers=['CPUExecutionProvider'])
    int8 = ort.InferenceSession(str(integer), options, providers=['CPUExecutionProvider'])
    vocabulary = config['decoder']['vocabulary']
    args.vocabulary.write_text(
        '// Generated from the pinned Citrinet checkpoint by tests/scripts/voiceid-citrinet/export.py.\n'
        + 'export const PHRASE_TOKEN_PIECES: readonly string[] = '
        + json.dumps(vocabulary, indent=2) + ';\n')
    checks = []
    for file in sorted(args.fixtures.glob('natural/*.wav')):
        audio, rate = soundfile.read(file, dtype='float32')
        if rate != 16000 or audio.ndim != 1:
            raise ValueError('Expected mono 16 kHz fixture')
        samples = audio[None]
        with torch.inference_mode():
            expected = reference(torch.from_numpy(samples)).numpy()
        floating_logits = fp32.run(None, {'samples': samples})[0]
        integer_logits = int8.run(None, {'samples': samples})[0]
        error = float(np.max(np.abs(expected - floating_logits)))
        agreement = float(np.mean(expected.argmax(-1) == floating_logits.argmax(-1)))
        if error > .005 or agreement != 1:
            raise ValueError(f'Float export parity failed for {file.name}: {error}, {agreement}')
        checks.append({'file': file.name, 'samples': len(audio), 'maxAbsoluteLogitError': error,
                       'floatArgmaxAgreement': agreement,
                       'int8ArgmaxAgreement': float(np.mean(floating_logits.argmax(-1) == integer_logits.argmax(-1))),
                       'int8RelativeLogitError': float(np.max(np.abs(floating_logits - integer_logits)) / np.max(np.abs(floating_logits))),
                       'fp32Text': decode(floating_logits, vocabulary),
                       'int8Text': decode(integer_logits, vocabulary)})
    (args.root / 'vocabulary.json').write_text(json.dumps(vocabulary) + '\n')
    report = {'checkpoint': {'revision': REVISION, 'sha256': CHECKPOINT_SHA256},
              'quantization': 'per-channel INT8 weights, FP32 activations and arithmetic',
              'quantizedTensors': quantized_count,
              'models': [describe(floating), describe(integer)],
              'operators': dict(Counter(node.op_type for node in onnx.load(integer).graph.node)),
              'checks': checks,
              'versions': {'torch': torch.__version__, 'onnx': onnx.__version__,
                           'onnxruntime': ort.__version__, 'numpy': np.__version__}}
    (args.root / 'export.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'checks'}, indent=2))


if __name__ == '__main__':
    main()
