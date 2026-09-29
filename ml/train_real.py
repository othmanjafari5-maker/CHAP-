"""Train a research candidate from explicitly reviewed seven-day outcome labels.
Never replaces the operational demo artifact or enables dispatch decisions.
"""
import argparse
import csv
import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from tree import train

parser = argparse.ArgumentParser()
parser.add_argument('csv_file', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
names = ['battery_voltage', 'battery_slope_per_hour', 'overheat_fraction',
         'vibration', 'vibration_slope_per_hour', 'fault_fraction']
with args.csv_file.open() as f:
    source = list(csv.DictReader(f))
records = []
for r in source:
    if r.get('outcome_verified') != 'yes' or r.get('failure_within_7_days') not in ('0', '1'):
        raise SystemExit('Every row needs outcome_verified=yes and a reviewed 0/1 seven-day outcome. Missing labels are not negatives.')
    observed = datetime.fromisoformat(r['observed_at'].replace('Z', '+00:00'))
    verified = datetime.fromisoformat(r['verified_through'].replace('Z', '+00:00'))
    if observed.tzinfo is None or verified.tzinfo is None or verified < observed + timedelta(days=7):
        raise SystemExit('Use timezone-aware timestamps and verify all seven days after each observation.')
    features = [float(r[name]) for name in names]
    if not all(math.isfinite(v) for v in features):
        raise SystemExit('Features must be finite numbers.')
    records.append((r['vehicle_id'], observed, [r['vehicle_id'], *features, int(r['failure_within_7_days'])]))
if len(records) < 100:
    raise SystemExit('At least 100 reviewed windows are required for this candidate pipeline.')
vehicles = sorted({r[0] for r in records})
if len(vehicles) < 5:
    raise SystemExit('At least five distinct vehicles are required for a vehicle-separated holdout.')
held_out = set(vehicles[-max(1, len(vehicles)//5):])
times = sorted(r[1] for r in records)
cutoff = times[int(len(times)*.7)]
training = [r[2] for r in records if r[0] not in held_out and r[1]+timedelta(days=7) < cutoff]
testing = [r[2] for r in records if r[0] in held_out and r[1] >= cutoff]
if len(training) < 40 or len(testing) < 20 or {r[-1] for r in training} != {0,1} or {r[-1] for r in testing} != {0,1}:
    raise SystemExit('Insufficient independent examples of both outcomes after vehicle/time separation. Collect more labelled data.')
tree = train(training)
def predict(r):
    node = tree
    while 'feature' in node:
        node = node['left'] if r[node['feature']+1] <= node['threshold'] else node['right']
    return int(node['positiveRate'] >= .5)
tp = sum(predict(r)==1 and r[-1]==1 for r in testing)
tn = sum(predict(r)==0 and r[-1]==0 for r in testing)
fp = sum(predict(r)==1 and r[-1]==0 for r in testing)
fn = sum(predict(r)==0 and r[-1]==1 for r in testing)
result = {'status':'RESEARCH CANDIDATE — NOT APPROVED FOR OPERATIONS', 'features':names, 'tree':tree,
          'trainingRows':len(training),'testRows':len(testing),'cutoff':cutoff.isoformat(),'heldOutVehicles':sorted(held_out),
          'evaluation':{'truePositive':tp,'trueNegative':tn,'falsePositive':fp,'falseNegative':fn,
                        'precision':tp/max(1,tp+fp),'recall':tp/max(1,tp+fn),'accuracy':(tp+tn)/len(testing),
                        'alwaysHealthyBaselineAccuracy':sum(r[-1]==0 for r in testing)/len(testing)},
          'limitations':'Uncalibrated research output. Requires independent domain review and prospective validation. No automatic promotion.'}
if args.output.resolve() == (Path(__file__).parent/'model.json').resolve():
    raise SystemExit('Choose a separate candidate filename; the live artifact cannot be overwritten by this command.')
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result['evaluation'],indent=2))
