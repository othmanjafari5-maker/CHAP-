const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('simulator preserves queued event IDs across offline restart', { timeout: 20000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chap-simulator-'));
  const devicesFile = path.join(directory, 'devices.json');
  fs.writeFileSync(devicesFile, JSON.stringify(Object.fromEntries([1,2,3].map(id=>[`AMB-00${id}`,{id,token:`test-device-${id}`}]))));
  const queueFile = path.join(directory, 'queue.json');
  let offline = true, notifyFailure, notifyRecovered;
  const failure = new Promise(resolve => { notifyFailure = resolve; });
  const recovered = new Promise(resolve => { notifyRecovered = resolve; });
  const accepted = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify([1,2,3].map(id => ({ id, ambulance_code: `AMB-00${id}` })))); return; }
    let text = ''; for await (const chunk of req) text += chunk;
    if (offline) { res.statusCode = 503; res.end('{}'); notifyFailure(); return; }
    const event = JSON.parse(text);
    assert.equal(req.headers.authorization, `Bearer test-device-${event.ambulanceId}`);
    accepted.push(event); res.end('{}');
    if (accepted.length >= 6) notifyRecovered();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let child;
  const start = () => spawn(process.execPath, [path.join(__dirname, 'simulator.js')], {
    env: { ...process.env, API_URL: `http://127.0.0.1:${server.address().port}`, QUEUE_FILE: queueFile, DEVICES_FILE: devicesFile }, stdio: 'ignore',
  });
  const stop = async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } };
  try {
    child = start(); await failure; await stop();
    const saved = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    assert.equal(saved.length, 3);
    offline = false; child = start(); await recovered;
    assert.deepEqual(accepted.slice(0,3).map(r=>r.eventId), saved.map(r=>r.eventId));
    assert.deepEqual(accepted.slice(0,3).map(r=>r.recordedAt), saved.map(r=>r.recordedAt));
  } finally {
    await stop(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
