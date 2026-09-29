import { useAuth } from '../auth-context';
import { useState } from 'react';
import { request } from '../api';
export default function CoverageSettings({ hospital, minimum, onChange }) {
  const {can}=useAuth();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request('/api/fleet/coverage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospital, minimum: Number(form.get('minimum')) }),
      });
      setMessage('Minimum coverage updated.');
      onChange();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  if (!can('admin')) return null;
  return <details><summary>Configure minimum coverage</summary><form onSubmit={save} className="maintenance-form">
    <label>Minimum ready vehicles<input name="minimum" type="number" min="1" max="1000" defaultValue={minimum} required /></label>
    <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save minimum'}</button>
  </form>{message && <p role="status">{message}</p>}</details>;
}
