"""Evaluate bounded enrollment adaptation without accessing Wallet or private audio.

Preparation freezes the protocol and selects disjoint public recordings before
inference. Analysis consumes actual browser embeddings and checks native parity.
This is an optimistic speaker-only experiment, not an authentication policy.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

from analyze import bootstrap_probe_speakers, rate_result, unit
from audio import SAMPLE_RATE, speech_crop

MODEL_HASH = 'e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269'
PROTOCOL = {
    'kind': 'voiceid_adaptation_feasibility_v1',
    'speakerThreshold': 0.5,
    'supplementWeight': 0.2,
    'maximumSupplements': 3,
    'minimumSampleBaselineCosine': 0.5,
    'minimumTemplateBaselineCosine': 0.98,
    'enrollmentSeconds': 4,
    'supplementSeconds': 2,
    'probeSeconds': [2, 4],
    'developmentSplit': 'calibration',
    'evaluationSplit': 'evaluation',
    'selection': 'Original speaker splits, baseline and probes; first three unused qualifying recordings from probe chapter.',
    'speakerOnlyGate': 'Fewer genuine rejects and no additional other-speaker accepts, in each duration and split.',
    'productionRelease': 'Blocked pending independent live sessions, phrase/quality gates, expiration policy, and a justified false-acceptance bound.',
    'phraseCheck': 'not_evaluated: audiobook content is outside the randomized phrase bank',
    'identityConfirmation': 'dataset_speaker_label: optimistic stand-in for independent owner confirmation',
    'capture': 'Historical RMS trim; no browser microphone, audio processing, or Silero capture simulation.',
    'chronology': 'Disjoint files, not dated sessions; no claim of later-day evaluation.',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def prepare(root, output):
    source_path = root / 'corpus.json'
    source = json.loads(source_path.read_text())
    if digest(root / 'b1.onnx') != MODEL_HASH:
        raise ValueError('Expected the deployed B1 model')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'pcm').mkdir()
    write_json(output / 'protocol.json', PROTOCOL)
    shutil.copyfile(root / 'b1.onnx', output / 'b1.onnx')
    session = ort.InferenceSession(str(output / 'b1.onnx'), providers=['CPUExecutionProvider'])
    samples = []
    excluded = []
    speakers = sorted({row['speaker'] for row in source['samples']}, key=int)
    for speaker in speakers:
        rows = [row for row in source['samples'] if row['speaker'] == speaker]
        baseline = [row for row in rows if row['role'] == 'enrollment' and row['seconds'] == 4]
        probes = [row for row in rows if row['role'] == 'probe']
        if len(baseline) != 3 or len(probes) != 8:
            raise ValueError(f'Unexpected source corpus roles for {speaker}')
        used = {row['source'] for row in rows}
        chapter = (root / probes[0]['source']).parent
        supplements = []
        for path in sorted(chapter.glob('*.flac')):
            relative = str(path.relative_to(root))
            if relative in used:
                continue
            waveform, rate = sf.read(path, dtype='float32')
            if rate != SAMPLE_RATE or waveform.ndim != 1 or len(waveform) < 2 * SAMPLE_RATE:
                continue
            crop = speech_crop(waveform, 2)
            if crop is None:
                continue
            metadata = {
                'id': f'{path.stem}-2s', 'speaker': speaker, 'chapter': chapter.name,
                'split': rows[0]['split'], 'role': 'supplement', 'seconds': 2,
                'source': relative,
            }
            supplements.append((metadata, crop))
            if len(supplements) == PROTOCOL['maximumSupplements']:
                break
        if len(supplements) != PROTOCOL['maximumSupplements']:
            excluded.append({'speaker': speaker, 'reason': 'Fewer than three unused qualifying supplement recordings'})
            continue
        for row in baseline + probes:
            pcm_path = root / 'pcm' / f"{row['id']}.f32"
            if digest(pcm_path) != row['sha256']:
                raise ValueError(f"Changed source PCM: {row['id']}")
            metadata = {key: value for key, value in row.items() if key != 'reference'}
            samples.append(save_sample(output, metadata, np.fromfile(pcm_path, dtype='<f4'), session))
        for metadata, crop in supplements:
            samples.append(save_sample(output, metadata, crop, session))
        print(f'Prepared speaker {speaker}', flush=True)
    if len({row['speaker'] for row in samples if row['split'] == 'evaluation'}) < 10:
        raise ValueError('Insufficient evaluation speakers')
    corpus = {
        'sourceCorpusSha256': digest(source_path), 'modelSha256': MODEL_HASH,
        'protocolSha256': digest(output / 'protocol.json'),
        'preparationScriptSha256': digest(Path(__file__)),
        'audioPreparationSha256': digest(Path(__file__).with_name('audio.py')),
        'sourceArchiveSha256': digest(root / 'test-clean.tar.gz'),
        'versions': {'numpy': np.__version__, 'onnxruntime': ort.__version__, 'soundfile': sf.__version__},
        'excluded': excluded, 'samples': samples,
    }
    write_json(output / 'corpus.json', corpus)
    write_json(output / 'inputs.json', [public_sample(row) for row in samples])
    print(f'Prepared {len(samples)} inputs; {len(excluded)} speakers excluded before scoring.')


def public_sample(row):
    return {key: value for key, value in row.items() if key != 'reference'}


def save_sample(output, metadata, samples, session):
    path = output / 'pcm' / f"{metadata['id']}.f32"
    if path.exists():
        raise ValueError(f'Duplicate recording ID: {metadata["id"]}')
    samples.astype('<f4').tofile(path)
    embedding = unit(session.run(None, {'samples': samples[None]})[0].reshape(-1))
    return {**metadata, 'sampleCount': len(samples), 'sha256': digest(path),
            'reference': {'b1': embedding.tolist()}}


def read_outputs(root, engine, corpus):
    outputs = json.loads((root / f'{engine}-b1.json').read_text())
    vectors = {}
    for row in outputs['results']:
        values = np.asarray(row['embedding'], dtype=np.float64)
        if row['id'] in vectors or values.shape != (192,) or not np.isfinite(values).all() or np.linalg.norm(values) < 1e-12:
            raise ValueError('Invalid or duplicate browser embedding')
        vectors[row['id']] = unit(values)
    if set(vectors) != {row['id'] for row in corpus['samples']}:
        raise ValueError('Browser output does not cover exactly this corpus')
    agreement = []
    for row in corpus['samples']:
        if digest(root / 'pcm' / f"{row['id']}.f32") != row['sha256']:
            raise ValueError('Input PCM changed after preparation')
        agreement.append(float(vectors[row['id']] @ unit(row['reference']['b1'])))
    if min(agreement) < 0.99999:
        raise ValueError('Browser/native model parity failed')
    return vectors, min(agreement)


def adapted_template(baseline, supplements, vectors, protocol):
    retained = []
    admissions = []
    effective = baseline
    for row in supplements:
        vector = vectors[row['id']]
        similarity = float(vector @ baseline)
        decision = 'sample_below_baseline_bound'
        if similarity >= protocol['minimumSampleBaselineCosine']:
            candidate = retained + [vector]
            weight = protocol['supplementWeight']
            proposed = unit((1 - weight) * baseline + weight * unit(np.mean(candidate, axis=0)))
            if float(proposed @ baseline) >= protocol['minimumTemplateBaselineCosine']:
                retained = candidate
                effective = proposed
                decision = 'admitted'
            else:
                decision = 'template_outside_baseline_bound'
        admissions.append({'sample': row['id'], 'baselineScore': similarity, 'decision': decision})
    return effective, admissions


def evaluate_split(samples, vectors, split, protocol):
    selected = [row for row in samples if row['split'] == split]
    speakers = sorted({row['speaker'] for row in selected}, key=int)
    templates = {}
    updates = []
    for speaker in speakers:
        rows = [row for row in selected if row['speaker'] == speaker]
        enrollment = [row for row in rows if row['role'] == 'enrollment']
        supplements = [row for row in rows if row['role'] == 'supplement']
        probes = [row for row in rows if row['role'] == 'probe']
        source_sets = [{row['source'] for row in role} for role in (enrollment, supplements, probes)]
        if len(enrollment) != 3 or len(supplements) != protocol['maximumSupplements']:
            raise ValueError('Unexpected enrollment or supplement count')
        if source_sets[0] & source_sets[1] or source_sets[0] & source_sets[2] or source_sets[1] & source_sets[2]:
            raise ValueError('Enrollment, adaptation and probe recordings must be disjoint')
        baseline = unit(np.mean([vectors[row['id']] for row in enrollment], axis=0))
        adapted, admissions = adapted_template(baseline, supplements, vectors, protocol)
        templates[speaker] = (baseline, adapted)
        updates.append({'speaker': speaker, 'templateBaselineCosine': float(adapted @ baseline), 'admissions': admissions})
    trials = []
    for row in selected:
        if row['role'] != 'probe':
            continue
        for owner, (baseline, adapted) in templates.items():
            trials.append({
                'split': split, 'seconds': row['seconds'], 'probe': row['id'],
                'probeSpeaker': row['speaker'], 'enrolledSpeaker': owner,
                'genuine': owner == row['speaker'],
                'baselineScore': float(vectors[row['id']] @ baseline),
                'adaptedScore': float(vectors[row['id']] @ adapted),
            })
    return trials, updates


def score_rows(rows, name):
    return [{**row, 'score': row[name]} for row in rows]


def paired_summary(rows, threshold):
    baseline = score_rows(rows, 'baselineScore')
    adapted = score_rows(rows, 'adaptedScore')
    base_rates = rate_result(baseline, threshold)
    adapted_rates = rate_result(adapted, threshold)
    recovered = sum(row['genuine'] and row['baselineScore'] < threshold <= row['adaptedScore'] for row in rows)
    regressed = sum(row['genuine'] and row['adaptedScore'] < threshold <= row['baselineScore'] for row in rows)
    new_false_accepts = sum(not row['genuine'] and row['baselineScore'] < threshold <= row['adaptedScore'] for row in rows)
    return {
        'baseline': base_rates, 'adapted': adapted_rates,
        'recoveredGenuine': recovered, 'regressedGenuine': regressed,
        'newOtherSpeakerAccepts': new_false_accepts,
        'feasibilityGatePassed': recovered > regressed and new_false_accepts == 0,
        'baselineUncertainty': bootstrap_probe_speakers(baseline, threshold),
        'adaptedUncertainty': bootstrap_probe_speakers(adapted, threshold),
    }


def analyze(root, engine):
    corpus = json.loads((root / 'corpus.json').read_text())
    protocol = json.loads((root / 'protocol.json').read_text())
    if digest(root / 'protocol.json') != corpus['protocolSha256'] or protocol != PROTOCOL:
        raise ValueError('Frozen protocol changed; prepare a separately labeled experiment')
    if digest(root / 'b1.onnx') != MODEL_HASH or corpus['modelSha256'] != MODEL_HASH:
        raise ValueError('Model changed after preparation')
    vectors, parity = read_outputs(root, engine, corpus)
    all_trials = []
    cases = []
    all_updates = []
    groups = []
    for split in ('calibration', 'evaluation'):
        groups.append({row['speaker'] for row in corpus['samples'] if row['split'] == split})
        trials, updates = evaluate_split(corpus['samples'], vectors, split, protocol)
        all_trials.extend(trials)
        all_updates.append({'split': split, 'updates': updates})
        for seconds in protocol['probeSeconds']:
            rows = [row for row in trials if row['seconds'] == seconds]
            cases.append({'split': split, 'seconds': seconds,
                          **paired_summary(rows, protocol['speakerThreshold']),
                          'perSpeaker': [{'speaker': speaker,
                                          **paired_summary([row for row in rows if row['probeSpeaker'] == speaker], protocol['speakerThreshold'])}
                                         for speaker in sorted(groups[-1], key=int)]})
    if groups[0] & groups[1]:
        raise ValueError('Development and evaluation speakers overlap')
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=list(all_trials[0]))
    writer.writeheader()
    writer.writerows(all_trials)
    trial_path = root / f'{engine}-adaptation-trials.csv.gz'
    trial_path.write_bytes(gzip.compress(stream.getvalue().encode(), mtime=0))
    report = {
        'status': 'experiment_complete_production_not_qualified',
        'engine': json.loads((root / f'{engine}-environment.json').read_text()),
        'modelSha256': MODEL_HASH, 'protocol': protocol, 'protocolSha256': corpus['protocolSha256'],
        'corpusSha256': digest(root / 'corpus.json'), 'inputsSha256': digest(root / 'inputs.json'),
        'sourceArchiveSha256': corpus['sourceArchiveSha256'],
        'analysisScriptSha256': digest(Path(__file__)),
        'minimumNativeCosine': parity, 'excluded': corpus['excluded'],
        'trialArtifact': {'file': trial_path.name, 'sha256': digest(trial_path), 'rows': len(all_trials)},
        'cases': cases, 'updates': all_updates,
        'limitations': [
            'Public read speech; no proof of parity with the reported live failures.',
            'Baseline and probes were used in earlier model studies; this is not a new independent validation corpus.',
            'Supplement and probe files share a chapter; same-session benefit may overstate later-session benefit.',
            '2s and 4s probes come from the same recordings and are correlated.',
            'Dataset speaker labels stand in for trusted confirmation; no passkey flow is exercised.',
            'Phrase checks, live capture quality, expiration, automatic updates, and poisoning resistance are not evaluated.',
            'Bootstrap resamples probe speakers conditional on fixed templates; zero events do not bound population risk.',
        ],
    }
    write_json(root / f'{engine}-adaptation-report.json', report)
    print(json.dumps({'status': report['status'], 'cases': [
        {key: value for key, value in case.items() if key not in ('perSpeaker', 'baselineUncertainty', 'adaptedUncertainty')}
        for case in cases]}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    preparation = commands.add_parser('prepare')
    preparation.add_argument('--root', type=Path, required=True)
    preparation.add_argument('--output', type=Path, required=True)
    analysis = commands.add_parser('analyze')
    analysis.add_argument('--root', type=Path, required=True)
    analysis.add_argument('--engine', choices=['chromium', 'webkit'], required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.root, args.output)
    else:
        analyze(args.root, args.engine)


if __name__ == '__main__':
    main()
