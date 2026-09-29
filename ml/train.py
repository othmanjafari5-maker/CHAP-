"""Reproducible DEMO decision tree. Standard library only; no real-world claims."""
import csv
import json
import random
from pathlib import Path

ROOT = Path(__file__).parent
rng = random.Random(42)
names = ['battery_voltage', 'battery_slope_per_hour', 'overheat_fraction',
         'vibration', 'vibration_slope_per_hour', 'fault_fraction']
rows = []
for vehicle in range(600):
    # Independent synthetic vehicle scenarios. Hidden degradation drives both
    # telemetry and a stochastic future outcome; labels are not model outputs.
    wear = rng.random()
    battery = 13.1 - 1.6 * wear + rng.gauss(0, .25)
    slope = -.5 * wear + rng.gauss(0, .13)
    hot = max(0, min(1, wear * .9 + rng.gauss(0, .15)))
    vibration = .7 + wear * 3 + rng.gauss(0, .2)
    growth = wear * .7 + rng.gauss(0, .15)
    faults = max(0, min(1, wear * .6 + rng.gauss(0, .1)))
    failure = int(rng.random() < .03 + .94 * wear ** 2)
    rows.append([vehicle, battery, slope, hot, vibration, growth, faults, failure])

from tree import train

training, test = rows[:450], rows[450:]
tree = train(training)
def predict(row):
    node = tree
    while 'feature' in node:
        node = node['left'] if row[node['feature'] + 1] <= node['threshold'] else node['right']
    return int(node['positiveRate'] >= .5)

tp = sum(predict(r) == 1 and r[-1] == 1 for r in test)
tn = sum(predict(r) == 0 and r[-1] == 0 for r in test)
fp = sum(predict(r) == 1 and r[-1] == 0 for r in test)
fn = sum(predict(r) == 0 and r[-1] == 1 for r in test)
metrics = {'data': 'SYNTHETIC DEMO ONLY', 'split': '450 training / 150 held-out independent vehicle scenarios',
           'truePositive': tp, 'trueNegative': tn, 'falsePositive': fp, 'falseNegative': fn,
           'precision': tp / max(1, tp + fp), 'recall': tp / max(1, tp + fn),
           'accuracy': (tp + tn) / len(test),
           'alwaysHealthyBaselineAccuracy': sum(r[-1] == 0 for r in test) / len(test),
           'positiveTestOutcomes': sum(r[-1] for r in test),
           'limitations': 'Synthetic scenario summaries, not real longitudinal vehicle validation. Rates are uncalibrated. Never use this model as evidence of dispatch safety.'}
with (ROOT / 'synthetic_dataset.csv').open('w') as f:
    writer = csv.writer(f)
    writer.writerow(['scenario_id', *names, 'failure_within_7_days'])
    writer.writerows(rows)
(ROOT / 'model.json').write_text(json.dumps({'version': 'synthetic-tree-1', 'features': names, 'tree': tree}, indent=2) + '\n')
(ROOT / 'evaluation.json').write_text(json.dumps(metrics, indent=2) + '\n')
print(json.dumps(metrics, indent=2))
