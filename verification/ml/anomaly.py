"""Optional anomaly scoring. No labels, pass verdicts or synthetic training data are invented."""
import hashlib
import json
import math
import sys
from pathlib import Path

MINIMUM_RUNS = 20
MODEL_VERSION = 'isolation-forest-http-v1'


def eligible(report):
    return (report.get('schemaVersion') == '1'
            and report.get('sourceHashAfter') == report.get('inventory', {}).get('sourceHash'))


def feature(row):
    duration, size = row.get('durationMs'), row.get('responseBytes')
    if not isinstance(duration, (int, float)) or not isinstance(size, (int, float)):
        return None
    if not math.isfinite(duration) or not math.isfinite(size) or duration < 0 or size < 0:
        return None
    return [math.log1p(duration), math.log1p(size)]


def key(row):
    return row.get('environment'), row.get('id'), row.get('expected')


def analyze(current, history_root):
    base = {'modelVersion': MODEL_VERSION, 'minimumHistoricalRunsPerCheck': MINIMUM_RUNS,
            'status': 'insufficient_history', 'checks': [], 'canOverrideVerification': False}
    if not eligible(current):
        base['status'] = 'source_changed_during_run'
        return base
    history = []
    if history_root.exists():
        for folder in sorted(history_root.iterdir(), reverse=True)[:100]:
            file = folder / 'report.json'
            if not file.is_file() or file.stat().st_size > 15_000_000:
                continue
            try:
                report = json.loads(file.read_text(encoding='utf-8'))
                if (eligible(report) and report.get('completedAt')
                        and report.get('runId') != current.get('runId')
                        and report.get('completedAt', '') < current.get('startedAt', '')):
                    history.append(report)
            except (OSError, ValueError, TypeError):
                continue
    ready = []
    for row in current.get('runtime', []):
        sample = feature(row)
        if sample is None:
            continue
        observations, run_ids, seen = [], [], set()
        for report in history:
            run_id = report.get('runId')
            if run_id in seen:
                continue
            for prior in report.get('runtime', []):
                values = feature(prior)
                if key(prior) == key(row) and prior.get('verdict') == 'passed' and values is not None:
                    observations.append(values)
                    run_ids.append(run_id)
                    seen.add(run_id)
                    break
        assessment = {'id': row['id'], 'environment': row['environment'], 'historicalRuns': len(observations),
                      'status': 'insufficient_history', 'anomaly': None}
        base['checks'].append(assessment)
        if len(observations) >= MINIMUM_RUNS:
            ready.append((assessment, observations, run_ids, sample))
    if not ready:
        return base
    try:
        import sklearn
        from sklearn.ensemble import IsolationForest
    except ImportError:
        base['status'] = 'dependency_missing'
        return base
    base['status'] = 'scored'
    base['libraryVersion'] = sklearn.__version__
    for assessment, observations, run_ids, sample in ready:
        model = IsolationForest(n_estimators=100, contamination='auto', random_state=42, n_jobs=1)
        model.fit(observations)
        assessment.update(status='scored', anomaly=bool(model.predict([sample])[0] == -1),
                          decisionScore=float(model.decision_function([sample])[0]),
                          trainingFingerprint=hashlib.sha256(json.dumps({'runIds': run_ids, 'observations': observations}, sort_keys=True).encode()).hexdigest())
    return base


if __name__ == '__main__':
    current = json.load(sys.stdin)
    print(json.dumps(analyze(current, Path(sys.argv[1])), ensure_ascii=False))
