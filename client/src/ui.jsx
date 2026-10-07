import React, { useEffect } from 'react';
import { statusLabel } from './validators.js';

export function Light({ status }) {
  if (!status) return <span className="badge badge-none">NOT COUNTED</span>;
  const text = { GREEN: 'GREEN - Match', YELLOW: 'YELLOW - Excess', RED: 'RED - Shortage' }[status];
  return <span className={`badge badge-${status.toLowerCase()}`}><span className="dot" aria-hidden="true" />{text}</span>;
}

export const StatusBadge = ({ status }) => <span className={`pill pill-${status.toLowerCase()}`}>{statusLabel(status)}</span>;

export function Field({ label, error, hint, children, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn btn-ghost" onClick={onClose} aria-label="Close">x</button></div>
        {children}
      </div>
    </div>
  );
}

export const Banner = ({ kind = 'error', children }) => (children ? <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null);