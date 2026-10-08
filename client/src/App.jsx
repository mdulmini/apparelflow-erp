import React, { useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, describeError } from './api.js';
import Login from './pages/Login.jsx';
import Supervisor from './pages/Supervisor.jsx';
import Verifier from './pages/Verifier.jsx';
import Sewing from './pages/Sewing.jsx';

const ROLE_LABEL = { cutting_supervisor: 'Cutting Supervisor', cutting_verifier: 'Cutting Verifier', sewing_supervisor: 'Sewing Supervisor' };
const Soon = ({ day }) => <div className="card empty">This screen is built on {day}.</div>;

export default function App() {
  const [user, setUser] = useState(null);
  const [demo, setDemo] = useState([]);
  const [booting, setBooting] = useState(true);
  const [switchErr, setSwitchErr] = useState('');

  useEffect(() => {
    (async () => {
      try { setDemo(await api('/auth/demo-users')); } catch { /* ignore */ }
      if (getToken()) {
        try { setUser((await api('/auth/me')).user); } catch { setToken(null); }
      }
      setBooting(false);
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.token);
    setUser(res.user);
  }, []);
  const logout = () => { setToken(null); setUser(null); };

  if (booting) return <div className="center">Loading...</div>;
  if (!user) return <Login demo={demo} onLogin={login} />;

  const switchTo = async (email) => {
    setSwitchErr('');
    const d = demo.find((x) => x.email === email);
    if (!d) return;
    try { await login(d.email, d.password); } catch (e) { setSwitchErr(describeError(e)); }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ApparelFlow <span>Cutting Gatekeeper</span></div>
        <div className="topbar-right">
          <label htmlFor="role-switch" className="sr-only">Role switcher</label>
          <select id="role-switch" value={user.email} onChange={(e) => switchTo(e.target.value)} aria-label="Role switcher">
            {demo.map((d) => <option key={d.email} value={d.email}>Switch persona: {ROLE_LABEL[d.role]}</option>)}
          </select>
          <div className="whoami"><strong>{user.full_name}</strong><small>{ROLE_LABEL[user.role]}</small></div>
          <button className="btn btn-secondary" onClick={logout}>Sign out</button>
        </div>
      </header>
      {switchErr && <div className="banner banner-error">{switchErr}</div>}
      <main key={user.role}>
        {user.role === 'cutting_supervisor' && <Supervisor />}
        {user.role === 'cutting_verifier' && <Verifier />}
        {user.role === 'sewing_supervisor' && <Sewing />}
      </main>
    </div>
  );
}