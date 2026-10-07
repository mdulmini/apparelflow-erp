const TOKEN_KEY = 'af_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  return data;
}

/** Turn an ApiError into a human-readable line including server field details. */
export function describeError(e) {
  if (!(e instanceof ApiError)) return e.message || 'Unexpected error';
  const d = e.details;
  if (!d) return e.message;
  if (Array.isArray(d.red)) return `${e.message} Short: ${d.red.map((r) => `${r.component} (${r.actual}/${r.expected})`).join(', ')}`;
  if (Array.isArray(d.uncounted)) return `${e.message} Missing: ${d.uncounted.join(', ')}`;
  return `${e.message}: ${Object.values(d).join('; ')}`;
}