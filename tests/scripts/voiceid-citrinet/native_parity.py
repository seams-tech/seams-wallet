"""Compare the export with installed NVIDIA NeMo inference modules.

Skip package initializers that register unrelated training/data modules. No
NeMo inference method, layer, tensor, mask, or length calculation is replaced.
"""
import argparse
import importlib
import json
import sys
import types
from pathlib import Path

import nemo
import numpy as np
import onnxruntime as ort
import soundfile
import torch

from export import checkpoint, digest


def inference_modules():
    root = Path(nemo.__file__).parent
    packages = (
        'collections.asr', 'collections.asr.parts', 'collections.asr.parts.submodules',
        'collections.asr.parts.utils', 'collections.asr.parts.preprocessing',
        'collections.asr.modules', 'collections.common', 'collections.common.parts',
    )
    for name in packages:
        qualified = f'nemo.{name}'
        package = types.ModuleType(qualified)
        package.__path__ = [str(root.joinpath(*name.split('.')))]
        sys.modules[qualified] = package
    encoder = importlib.import_module('nemo.collections.asr.modules.conv_asr')
    features = importlib.import_module('nemo.collections.asr.parts.preprocessing.features')
    return encoder, features


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    args = parser.parse_args()
    if nemo.__version__ != '1.23.0':
        raise ValueError('Use the pinned NeMo 1.23.0 reference')
    torch.set_num_threads(1)
    _, weights, config = checkpoint(args.root)
    modules, preprocessing = inference_modules()
    encoder_config = dict(config['encoder'])
    decoder_config = dict(config['decoder'])
    encoder_config.pop('_target_')
    decoder_config.pop('_target_')
    encoder = modules.ConvASREncoder(**encoder_config).eval()
    decoder = modules.ConvASRDecoder(**decoder_config).eval()
    encoder.load_state_dict({name.removeprefix('encoder.'): value for name, value in weights.items() if name.startswith('encoder.')}, strict=True)
    decoder.load_state_dict({name.removeprefix('decoder.'): value for name, value in weights.items() if name.startswith('decoder.')}, strict=True)
    features = preprocessing.FilterbankFeatures(
        sample_rate=16000, n_window_size=400, n_window_stride=160, window='hann',
        normalize='per_feature', n_fft=512, nfilt=80, dither=0, pad_to=16,
    ).eval()
    features.load_state_dict({'window': weights['preprocessor.featurizer.window'],
                              'fb': weights['preprocessor.featurizer.fb']}, strict=True)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    runtime = ort.InferenceSession(str(args.root / 'citrinet-fp32.onnx'), options, providers=['CPUExecutionProvider'])
    checks = []
    with torch.inference_mode():
        for file in sorted(args.fixtures.glob('natural/*.wav')):
            audio, rate = soundfile.read(file, dtype='float32')
            if rate != 16000 or audio.ndim != 1:
                raise ValueError('Expected mono 16 kHz audio')
            samples = torch.from_numpy(audio[None])
            processed, length = features(samples, torch.tensor([len(audio)]))
            encoded, length = encoder(audio_signal=processed, length=length)
            expected = decoder(encoder_output=encoded)[:, :length[0]]
            logits = torch.from_numpy(runtime.run(None, {'samples': samples.numpy()})[0])
            actual = torch.log_softmax(logits, dim=-1)
            error = float((expected - actual).abs().max())
            agreement = float((expected.argmax(-1) == actual.argmax(-1)).float().mean())
            checks.append({'file': file.name, 'maxAbsoluteLogProbabilityError': error,
                           'argmaxAgreement': agreement})
    report = {'nemoVersion': nemo.__version__, 'modelSha256': digest(args.root / 'citrinet-fp32.onnx'),
              'settings': {'evaluationMode': True, 'dither': 0, 'padTo': 16, 'convolutionMasks': True},
              'checks': checks}
    (args.root / 'native-parity.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'nemoVersion': nemo.__version__, 'clips': len(checks),
                      'worstError': max(item['maxAbsoluteLogProbabilityError'] for item in checks),
                      'minimumArgmaxAgreement': min(item['argmaxAgreement'] for item in checks)}, indent=2))
    if any(item['maxAbsoluteLogProbabilityError'] > .005 or item['argmaxAgreement'] != 1 for item in checks):
        raise ValueError('Export differs from NVIDIA NeMo inference')


if __name__ == '__main__':
    main()
