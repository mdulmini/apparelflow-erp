import React, { useState } from 'react';
import { describeError } from '../api.js';
import { Banner, Field } from '../ui.jsx';

const ROLE_LABEL = { cutting_supervisor: 'Cutting Supervisor', cutting_verifier: 'Cutting Verifier', sewing_supervisor: 'Sewing Supervisor' };
const ROLE_DESC = {
  cutting_supervisor: 'Creates cutting orders and tracks progress. Cannot verify or see the sewing queue.',
  cutting_verifier: 'QC checkpoint: counts parts, approves or rejects. Cannot create orders.',
  sewing_supervisor: 'Receives VERIFIED batches only and starts sewing.',
};

export default function Login({ demo, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds) => {
    e?.preventDefault();
    const em = creds?.email ?? email, pw = creds?.password ?? password;
    if (!em.trim() || !pw) return setError('Email and password are required');
    setBusy(true); setError('');
    try { await onLogin(em.trim(), pw); } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>ApparelFlow ERP</h1>
        <p className="muted">Cutting Operations &amp; Gatekeeper Verification Terminal</p>
        <form onSubmit={submit} noValidate>
          <Field label="Email" id="email"><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" id="password"><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Banner>{error}</Banner>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
      </div>
      <div className="card demo-card">
        <h2>Demo credentials</h2>
        <p className="muted">Click a persona to sign in instantly.</p>
        {demo.map((d) => (
          <div className="demo-row" key={d.email}>
            <div>
              <strong>{ROLE_LABEL[d.role]}</strong>
              <div className="muted small">{ROLE_DESC[d.role]}</div>
              <code>{d.email}</code> / <code>{d.password}</code>
            </div>
            <button className="btn btn-secondary" disabled={busy} onClick={() => submit(null, d)}>Sign in</button>
          </div>
        ))}
      </div>
    </div>
  );
}