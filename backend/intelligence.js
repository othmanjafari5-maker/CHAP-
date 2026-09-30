const fs = require('node:fs');
const path = require('node:path');
let model;
try { model = JSON.parse(fs.readFileSync(path.join(__dirname, '../ml/model.json'), 'utf8')); } catch { /* Model is optional until trained. */ }
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
function connection(time, now = Date.now()) {
  const age = time ? Math.max(0, (now - new Date(time).getTime()) / 1000) : Infinity;
  return { status: !Number.isFinite(age) ? 'UNKNOWN' : age <= 15 ? 'LIVE' : age <= 60 ? 'DELAYED' : 'OFFLINE', ageSeconds: Number.isFinite(age) ? Math.round(age) : null };
}
function alerts(r) {
  const rules = [
    ['engine_temperature', 'ENGINE_TEMPERATURE', 95, 105, false],
    ['battery_voltage', 'BATTERY', 12, 11.5, true],
    ['fuel_level', 'FUEL', 20, 10, true],
    ['vibration', 'VIBRATION', 2.5, 4, false],
  ];
  const list = rules.flatMap(([key, type, warning, critical, low]) => {
    if (!numeric(r[key])) return [];
    const value = Number(r[key]);
    const bad = low ? value <= critical : value >= critical;
    const warn = low ? value <= warning : value >= warning;
    return bad || warn ? [{ type, severity: bad ? 'CRITICAL' : 'WARNING', message: `${type.replaceAll('_', ' ')} ${bad ? 'critical' : 'warning'}`, value }] : [];
  });
  if (r.fault_codes?.length) list.push({ type: 'FAULT_CODES', severity: 'CRITICAL', message: `Faults require inspection: ${r.fault_codes.join(', ')}`, value: null });
  return list;
}
function features(history) {
  const rows = history.filter(r => ['battery_voltage', 'engine_temperature', 'vibration'].every(k => numeric(r[k])));
  if (rows.length < 12) return null;
  const oldest = rows[0], latest = rows.at(-1);
  const hours = (new Date(latest.recorded_at) - new Date(oldest.recorded_at)) / 3600000;
  if (hours < 1 / 60) return null;
  return [Number(latest.battery_voltage), (Number(latest.battery_voltage) - Number(oldest.battery_voltage)) / hours,
    rows.filter(r => Number(r.engine_temperature) >= 95).length / rows.length,
    Number(latest.vibration), (Number(latest.vibration) - Number(oldest.vibration)) / hours,
    rows.filter(r => r.fault_codes?.length).length / rows.length];
}
function risk(history) {
  const input = features(history);
  if (!input || !model) return { level: 'UNKNOWN', source: 'Insufficient history or model unavailable', reasons: [] };
  let node = model.tree;
  while (node.feature !== undefined) node = input[node.feature] <= node.threshold ? node.left : node.right;
  const level = node.positiveRate >= .65 ? 'HIGH' : node.positiveRate >= .3 ? 'MEDIUM' : 'LOW';
  const reasons = [];
  if (input[1] < -.1) reasons.push('Battery voltage declining');
  if (input[2] > .2) reasons.push('Repeated overheating');
  if (input[4] > .1) reasons.push('Vibration increasing');
  if (input[5] > 0) reasons.push('Fault codes observed');
  return { level, source: 'DEMO decision tree · synthetic training data', modelVersion: model.version, horizonDays: 7, reasons, calculatedAt: new Date().toISOString() };
}
function assess(row, history = [], now = Date.now()) {
  const conn = { ...connection(row.recorded_at, now), lastObservedAt: row.recorded_at, lastSeenAt: row.last_seen_at };
  const current = alerts(row);
  const reasons = [];
  const weights = { fuel_level: 15, battery_voltage: 20, engine_temperature: 20, vibration: 15 };
  let score = 100;
  let complete = true;
  for (const [key, weight] of Object.entries(weights)) {
    if (!numeric(row[key])) { complete = false; reasons.push(`Missing ${key.replaceAll('_', ' ')}`); continue; }
    const item = current.find(a => a.type === ({fuel_level:'FUEL', battery_voltage:'BATTERY', engine_temperature:'ENGINE_TEMPERATURE', vibration:'VIBRATION'})[key]);
    if (item) score -= weight * (item.severity === 'CRITICAL' ? 1 : .5);
  }
  if (!Array.isArray(row.fault_codes)) { complete = false; reasons.push('Fault scan unavailable'); }
  else if (row.fault_codes.length) score -= 15;
  if (!row.next_service_date) { complete = false; reasons.push('Service schedule missing'); }
  if (numeric(row.next_service_km) && !numeric(row.odometer_km)) { complete = false; reasons.push('Mileage needed to check service schedule'); }
  const overdue = row.next_service_date && (new Date(row.next_service_date).getTime() < new Date(now).setUTCHours(0,0,0,0) || (numeric(row.next_service_km) && numeric(row.odometer_km) && Number(row.odometer_km) >= Number(row.next_service_km)));
  if (overdue) { score -= 10; reasons.push('Service overdue'); }
  if (conn.status !== 'LIVE') { score -= 5; reasons.push(`Telemetry ${conn.status.toLowerCase()}`); }
  reasons.push(...current.map(a => a.message));
  const predicted = risk(history);
  const exclusions = [...reasons];
  if (row.hold_id) exclusions.push('Inspection required');
  if (row.status !== 'available') exclusions.push(`Vehicle ${row.status}`);
  if(!row.crew_shift_id)exclusions.push('No available crew on an active shift');
  if(!row.crew_check_passed)exclusions.push('Pre-dispatch checklist missing, expired or failed');
  const label = !complete ? 'UNKNOWN' : row.hold_id || current.some(a => a.severity === 'CRITICAL') || conn.status !== 'LIVE' || score < 60 || overdue ? 'NOT RECOMMENDED FOR DISPATCH' : score < 80 || current.length ? 'WARNING' : 'READY';
  return { ...row, connection: conn, readiness: { score: complete ? Math.round(score) : null, complete, label, reasons, ruleVersion: 'prototype-1' },
    safety: { inspectionRequired: !!row.hold_id, holdId: row.hold_id, reason: row.hold_reason }, risk: predicted,
    dispatch: { eligible: label === 'READY' && row.status === 'available' && !!row.crew_shift_id && !!row.crew_check_passed, exclusionReasons: exclusions },
    effective_status: row.hold_id ? 'INSPECTION REQUIRED' : row.status, alerts: current,
    active_alerts: current.length, critical_alerts: current.filter(a => a.severity === 'CRITICAL').length };
}
function distance(a, lat, lon) {
  const rad = x => x * Math.PI / 180;
  const dlat = rad(lat - Number(a.latitude)), dlon = rad(lon - Number(a.longitude));
  const q = Math.sin(dlat / 2) ** 2 + Math.cos(rad(Number(a.latitude))) * Math.cos(rad(lat)) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, q)));
}
module.exports = { numeric, connection, alerts, features, risk, assess, distance };
