"""Inference-only Citrinet-256 architecture for the pinned NVIDIA checkpoint.

Adapted from Thomas Lackner's MIT-licensed BabyTalk implementation at
96b9bb73fdf8492617f38893622d42d1e2ee8558/export/citrinet.py.
See NOTICE.md. All checkpoint tensors must map to the inference architecture.
"""
import copy

import torch
from torch import nn
from torch.nn import functional as functional


class SeparableConv(nn.Module):
    def __init__(self, inputs, outputs, kernel, stride):
        super().__init__()
        self.depthwise = nn.Conv1d(inputs, inputs, kernel, stride=stride,
                                   padding=(kernel - 1) // 2, groups=inputs, bias=False)
        self.pointwise = nn.Conv1d(inputs, outputs, 1, bias=False)
        self.normalization = nn.BatchNorm1d(outputs, eps=1e-3)

    def forward(self, features):
        return self.normalization(self.pointwise(self.depthwise(features)))


class ResidualConv(nn.Module):
    def __init__(self, inputs, outputs, stride):
        super().__init__()
        self.conv = nn.Conv1d(inputs, outputs, 1, stride=stride, bias=False)
        self.normalization = nn.BatchNorm1d(outputs, eps=1e-3)

    def forward(self, features):
        return self.normalization(self.conv(features))


class SqueezeExcite(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.first = nn.Linear(channels, channels // 8, bias=False)
        self.second = nn.Linear(channels // 8, channels, bias=False)

    def forward(self, features):
        gate = torch.sigmoid(self.second(functional.relu(self.first(features.mean(-1)))))
        return features * gate.unsqueeze(-1)


class JasperBlock(nn.Module):
    def __init__(self, inputs, config):
        super().__init__()
        if (config['dilation'] != [1] or not config['separable'] or not config['se']
                or config['se_context_size'] != -1 or config['dropout'] != 0):
            raise ValueError('Unsupported Citrinet block configuration')
        outputs = config['filters']
        self.convs = nn.ModuleList()
        for repeat in range(config['repeat']):
            last = repeat == config['repeat'] - 1
            stride = config['stride'][0] if last or not config.get('stride_last', False) else 1
            self.convs.append(SeparableConv(inputs, outputs, config['kernel'][0], stride))
            inputs = outputs
        self.excitation = SqueezeExcite(outputs)
        self.residual = None

    def forward(self, features):
        output = features
        for index, conv in enumerate(self.convs):
            output = conv(output)
            if index < len(self.convs) - 1:
                output = functional.relu(output)
        output = self.excitation(output)
        if self.residual is not None:
            output = output + self.residual(features)
        return functional.relu(output)


class Citrinet(nn.Module):
    def __init__(self, config):
        super().__init__()
        channels = config['encoder']['feat_in']
        self.blocks = nn.ModuleList()
        for block in config['encoder']['jasper']:
            layer = JasperBlock(channels, block)
            if block['residual']:
                stride = block['stride'][0] if block.get('residual_mode') == 'stride_add' else 1
                layer.residual = ResidualConv(channels, block['filters'], stride)
            self.blocks.append(layer)
            channels = block['filters']
        self.decoder = nn.Conv1d(channels, config['decoder']['num_classes'] + 1, 1)

    def forward(self, features):
        for block in self.blocks:
            features = block(features)
        return self.decoder(features).transpose(1, 2)


def take_tensor(source, output, used, original, mapped):
    output[mapped] = source[original]
    used.add(original)


def take_normalization(source, output, used, original, mapped):
    for field in ('weight', 'bias', 'running_mean', 'running_var', 'num_batches_tracked'):
        take_tensor(source, output, used, f'{original}.{field}', f'{mapped}.{field}')


def map_weights(source, config):
    output = {}
    used = set()
    for index, block in enumerate(config['encoder']['jasper']):
        original = f'encoder.encoder.{index}'
        cursor = 0
        for repeat in range(block['repeat']):
            mapped = f'blocks.{index}.convs.{repeat}'
            take_tensor(source, output, used, f'{original}.mconv.{cursor}.conv.weight',
                        f'{mapped}.depthwise.weight')
            take_tensor(source, output, used, f'{original}.mconv.{cursor + 1}.conv.weight',
                        f'{mapped}.pointwise.weight')
            take_normalization(source, output, used, f'{original}.mconv.{cursor + 2}',
                               f'{mapped}.normalization')
            cursor += 3 if repeat == block['repeat'] - 1 else 5
        for offset, name in ((0, 'first'), (2, 'second')):
            take_tensor(source, output, used, f'{original}.mconv.{cursor}.fc.{offset}.weight',
                        f'blocks.{index}.excitation.{name}.weight')
        if block['residual']:
            take_tensor(source, output, used, f'{original}.res.0.0.conv.weight',
                        f'blocks.{index}.residual.conv.weight')
            take_normalization(source, output, used, f'{original}.res.0.1',
                               f'blocks.{index}.residual.normalization')
    for field in ('weight', 'bias'):
        take_tensor(source, output, used, f'decoder.decoder_layers.0.{field}', f'decoder.{field}')
    used.update(('preprocessor.featurizer.window', 'preprocessor.featurizer.fb'))
    if set(source) != used:
        raise ValueError(f'Unmapped checkpoint tensors: {set(source) - used}')
    return output


def fold_conv(conv, normalization):
    scale = normalization.weight / torch.sqrt(normalization.running_var + normalization.eps)
    folded = nn.Conv1d(conv.in_channels, conv.out_channels, conv.kernel_size[0],
                       stride=conv.stride, padding=conv.padding, groups=conv.groups, bias=True)
    folded.weight.copy_(conv.weight * scale[:, None, None])
    folded.bias.copy_(-normalization.running_mean * scale + normalization.bias)
    return folded


@torch.no_grad()
def fold_normalization(model):
    folded = copy.deepcopy(model)
    for block in folded.blocks:
        for conv in block.convs:
            conv.pointwise = fold_conv(conv.pointwise, conv.normalization)
            conv.normalization = nn.Identity()
        if block.residual is not None:
            conv = block.residual
            conv.conv = fold_conv(conv.conv, conv.normalization)
            conv.normalization = nn.Identity()
    return folded.eval()
