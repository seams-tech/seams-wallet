The model derives from NVIDIA's `stt_en_citrinet_256_ls` checkpoint at revision
`c7cdacff0262bbb2a17771d20ec9f9f3b5cff6ed`.
Source: https://huggingface.co/nvidia/stt_en_citrinet_256_ls
License: https://creativecommons.org/licenses/by/4.0/
Changes: ONNX waveform frontend, folded batch normalization, per-channel INT8
weight storage. No fine-tuning. Retain this attribution with derived models.

`model.py` adapts the architecture and weight mapping from
https://github.com/tlack/babytalk/blob/96b9bb73fdf8492617f38893622d42d1e2ee8558/export/citrinet.py
under the following license:

MIT License

Copyright (c) 2026 Thomas Lackner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
