// Client-side validation is for UX only. The server re-validates everything.
export const validateInt = (raw, { min = 0, max = 10_000_000, label = 'Value' } = {}) => {
    const s = String(raw ?? '').trim();
    if (s === '') return `${label} is required`;
    if (!/^\d+$/.test(s)) return `${label} must be a whole number (no decimals, negatives or letters)`;
    const n = Number(s);
    if (n < min) return `${label} must be at least ${min}`;
    if (n > max) return `${label} must be at most ${max}`;
    return null;
  };
  export const validateYards = (raw) => {
    const s = String(raw ?? '').trim();
    if (s === '') return 'Fabric used is required';
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'Enter a positive number with at most 2 decimals';
    if (Number(s) <= 0) return 'Fabric used must be greater than 0';
    return null;
  };
  export const validateRoll = (raw) =>
    /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/.test(String(raw ?? '').trim()) ? null : 'Use 3-40 letters, digits or hyphens (e.g. FAB-ROLL-882)';
  
  export const statusLabel = (s) => ({
    CUTTING_IN_PROGRESS: 'Cutting in progress', PENDING_VERIFICATION: 'Pending verification',
    REJECTED: 'Rejected', VERIFIED: 'Verified', IN_SEWING: 'In sewing',
  }[s] || s);
  
  export const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '-');