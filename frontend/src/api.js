export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export async function request(path, options = {}) {
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(`${API_URL}${path}`, { ...options, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Request failed');
  return body;
}
export function freshness(time, now = Date.now()) {
  if (!time) return 'UNKNOWN';
  const age = (now - new Date(time).getTime()) / 1000;
  return !Number.isFinite(age) ? 'UNKNOWN' : age <= 15 ? 'LIVE' : age <= 60 ? 'DELAYED' : 'OFFLINE';
}
export function validGPS(a) {
  return a.latitude !== null && a.longitude !== null && a.latitude !== undefined && a.longitude !== undefined && Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)) && Math.abs(Number(a.latitude)) <= 90 && Math.abs(Number(a.longitude)) <= 180;
}
