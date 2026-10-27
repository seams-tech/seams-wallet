"""Score browser outputs using calibration-only thresholds and held-out speakers."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path

import numpy as np


def unit(values):
    values = np.asarray(values, dtype=np.float64)
    return values / np.linalg.norm(values)


def trials_for(samples, outputs, split, seconds):
    selected = [s for s in samples if s['split'] == split and s['seconds'] == seconds]
    speakers = sorted({s['speaker'] for s in selected})
    templates = {}
    for speaker in speakers:
        enrollment = [outputs[s['id']] for s in selected
                      if s['speaker'] == speaker and s['role'] == 'enrollment']
        assert len(enrollment) == 3
        templates[speaker] = unit(np.mean(enrollment, axis=0))
    trials = []
    for sample in selected:
        if sample['role'] != 'probe':
            continue
        for speaker, template in templates.items():
            trials.append({'probe': sample['id'], 'probeSpeaker': sample['speaker'],
                           'enrolledSpeaker': speaker, 'genuine': speaker == sample['speaker'],
                           'score': float(unit(outputs[sample['id']]) @ template)})
    return trials


def rate_result(trials, threshold):
    targets = [t for t in trials if t['genuine']]
    others = [t for t in trials if not t['genuine']]
    rejected = sum(t['score'] < threshold for t in targets)
    accepted = sum(t['score'] >= threshold for t in others)
    return {'threshold': float(threshold), 'genuineTrials': len(targets),
            'impostorTrials': len(others), 'falseRejects': rejected, 'falseAccepts': accepted,
            'falseRejectRate': rejected / len(targets), 'falseAcceptRate': accepted / len(others)}


def select_threshold(trials, far):
    impostors = sorted(t['score'] for t in trials if not t['genuine'])
    allowed = int(np.floor(len(impostors) * far))
    return float(np.nextafter(impostors[-allowed - 1], np.inf))


def empirical_eer(trials):
    genuine = np.array([t['score'] for t in trials if t['genuine']])
    impostors = np.array([t['score'] for t in trials if not t['genuine']])
    best = None
    for threshold in np.unique(np.concatenate((genuine, impostors))):
        far = float(np.mean(impostors >= threshold))
        frr = float(np.mean(genuine < threshold))
        candidate = (abs(far - frr), (far + frr) / 2)
        if best is None or candidate < best:
            best = candidate
    return best[1]


def bootstrap_probe_speakers(trials, threshold):
    # Conditional on this fixed enrollment cohort. Does not cover template uncertainty.
    speakers = sorted({t['probeSpeaker'] for t in trials})
    counts = []
    for speaker in speakers:
        row = rate_result([t for t in trials if t['probeSpeaker'] == speaker], threshold)
        counts.append([row['falseRejects'], row['genuineTrials'],
                       row['falseAccepts'], row['impostorTrials']])
    counts = np.asarray(counts)
    rng = np.random.default_rng(417)
    draws = rng.integers(0, len(speakers), size=(2000, len(speakers)))
    totals = counts[draws].sum(axis=1)
    return {'falseRejectRate95': np.quantile(totals[:, 0] / totals[:, 1], [.025, .975]).tolist(),
            'falseAcceptRate95': np.quantile(totals[:, 2] / totals[:, 3], [.025, .975]).tolist(),
            'method': '2000 probe-speaker bootstrap draws; fixed enrollment cohort; seed 417. Zero-event intervals are degenerate and do not bound the true error rate.'}


def quantiles(values):
    values = np.asarray(values)
    return {'p50': float(np.quantile(values, .5)), 'p95': float(np.quantile(values, .95))}


def compare(root, engine, corpus):
    rows = []
    results = []
    for name in ('ecapa', 'b0', 'b1'):
        path = root / f'{engine}-{name}.json'
        run = json.loads(path.read_text())
        embeddings = {r['id']: unit(r['embedding']) for r in run['results']}
        assert len(embeddings) == len(corpus['samples'])
        cosines = [float(embeddings[s['id']] @ unit(s['reference'][name])) for s in corpus['samples']]
        if min(cosines) < 0.99999:
            raise AssertionError(f'{engine}/{name}: browser/reference parity failed: {min(cosines)}')
        cases = []
        for seconds in (4, 2):
            calibration = trials_for(corpus['samples'], embeddings, 'calibration', seconds)
            evaluation = trials_for(corpus['samples'], embeddings, 'evaluation', seconds)
            threshold = select_threshold(calibration, .01)
            cases.append({'seconds': seconds,
                          'calibration': rate_result(calibration, threshold),
                          'evaluation': rate_result(evaluation, threshold),
                          'evaluationEerDescriptiveOnly': empirical_eer(evaluation),
                          'evaluationUncertainty': bootstrap_probe_speakers(evaluation, threshold)})
            if name == 'ecapa':
                cases[-1]['currentThresholdEvaluation'] = rate_result(evaluation, .6)
            for split, trials in [('calibration', calibration), ('evaluation', evaluation)]:
                for trial in trials:
                    rows.append({'engine': engine, 'model': name, 'seconds': seconds,
                                 'split': split, **trial})
        timings = {r['id']: r['inferenceMs'] for r in run['results'][1:]}
        results.append({'name': name, 'rawResultSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'minReferenceCosine': min(cosines), 'loadMsLocalhost': run['loadMs'],
                        'firstInferenceMs': run['results'][0]['inferenceMs'],
                        'warmInferenceMs': {str(seconds): quantiles([timings[s['id']] for s in corpus['samples']
                                           if s['seconds'] == seconds and s['id'] in timings])
                                            for seconds in (4, 2)},
                        'quietFinite': run['quietFinite'], 'cases': cases})
    return results, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--sdk-assets', type=Path, required=True)
    parser.add_argument('--engines', nargs='+', default=['chromium'])
    args = parser.parse_args()
    corpus = json.loads((args.root / 'corpus.json').read_text())
    speakers = {split: sorted({s['speaker'] for s in corpus['samples'] if s['split'] == split})
                for split in ('calibration', 'evaluation')}
    assert not set(speakers['calibration']).intersection(speakers['evaluation'])
    runtime_assets = []
    for name in ('ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'):
        data = (args.sdk_assets / name).read_bytes()
        runtime_assets.append({'file': name, 'bytes': len(data),
                               'gzipBytes': len(gzip.compress(data, compresslevel=6, mtime=0))})
    runtime_js = list(args.sdk_assets.glob('ort.wasm.bundle*.js'))
    if len(runtime_js) != 1:
        raise ValueError('Expected one WASM runtime JS bundle')
    data = runtime_js[0].read_bytes()
    runtime_assets.append({'file': runtime_js[0].name, 'bytes': len(data),
                           'gzipBytes': len(gzip.compress(data, compresslevel=6, mtime=0))})
    report = {'status': 'passed', 'sources': {'sourceRevision': corpus['sourceRevision'],
              'weightsRevision': corpus['weightsRevision'], 'dataset': 'LibriSpeech test-clean',
              'datasetUrl': 'https://www.openslr.org/12', 'datasetLicense': 'CC-BY-4.0'},
              'versions': corpus['versions'], 'models': corpus['models'], 'speakers': speakers,
              'sharedRuntimeAssets': runtime_assets,
              'corpusArchiveSha256': hashlib.sha256((args.root / 'test-clean.tar.gz').read_bytes()).hexdigest(),
              'recordings': len({s['source'] for s in corpus['samples']}),
              'inputs': len(corpus['samples']), 'sampleRate': 16000,
              'protocol': 'Three enrollment utterances from one chapter; four probes from another. Center-crop to 4s or 2s and apply Wallet energy trimming. Independent templates and thresholds per duration. Calibration FAR target 1%.',
              'limitations': ['Small read-English cohort; not microphone or room robustness.',
                             'Corpus membership held out across calibration/evaluation; pretraining identity overlap not audited.',
                             'The 1% FAR target is an exploratory comparison, not a deployment security target.',
                             '2s clips allow 1s voiced audio as a stress test; production requires 2s voiced.',
                             'No physical mobile device measurements; WebKit is desktop automation.',
                             'Load timing uses localhost; no internet transfer latency or total memory measurement.',
                             'Browser runs are sequential, one pass per model; timing is indicative.',
                             'Small-sample zero-error observations and degenerate bootstrap intervals do not establish zero population error.'],
              'browsers': {}}
    all_rows = []
    for engine in args.engines:
        results, rows = compare(args.root, engine, corpus)
        report['browsers'][engine] = {'environment': json.loads((args.root / f'{engine}-environment.json').read_text()),
                                      'models': results}
        all_rows.extend(rows)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(all_rows[0]))
    writer.writeheader()
    writer.writerows(all_rows)
    trials = gzip.compress(output.getvalue().encode(), compresslevel=6, mtime=0)
    (args.root / 'trials.csv.gz').write_bytes(trials)
    report['trialArtifact'] = {'file': 'trials.csv.gz', 'rows': len(all_rows),
                               'sha256': hashlib.sha256(trials).hexdigest()}
    (args.root / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    # Reproducible input list, excluding raw audio and speaker embeddings.
    manifest = [{k: v for k, v in sample.items() if k != 'reference'} for sample in corpus['samples']]
    (args.root / 'inputs.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
