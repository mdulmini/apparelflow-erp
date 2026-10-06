// Pure domain rules. No I/O here so they are trivial to unit test.
export const ROLES = ['cutting_supervisor', 'cutting_verifier', 'sewing_supervisor'];

export const STATUS = Object.freeze({
  CUTTING_IN_PROGRESS: 'CUTTING_IN_PROGRESS',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  REJECTED: 'REJECTED',
  VERIFIED: 'VERIFIED',
  IN_SEWING: 'IN_SEWING',
});

// The ONLY legal transitions. Every status change in the API goes through assertTransition().
export const TRANSITIONS = Object.freeze({
  CUTTING_IN_PROGRESS: ['PENDING_VERIFICATION'],
  PENDING_VERIFICATION: ['VERIFIED', 'REJECTED'],
  REJECTED: ['PENDING_VERIFICATION'],
  VERIFIED: ['IN_SEWING'],
  IN_SEWING: [],
});

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Traffic light. actual === null/undefined means "not counted yet" -> null. */
export function itemStatus(expected, actual) {
  if (actual === null || actual === undefined) return null;
  if (actual === expected) return 'GREEN';
  return actual > expected ? 'YELLOW' : 'RED';
}

export const expectedQty = (piecesPerGarment, targetQty) => piecesPerGarment * targetQty;
export const expectedFabric = (stdYards, targetQty) => round2(stdYards * targetQty);

/** Fabric Wastage % = ((actual - expected) / expected) * 100 */
export function wastagePct(actualYds, expectedYds) {
  if (!(expectedYds > 0)) return 0;
  return round2(((actualYds - expectedYds) / expectedYds) * 100);
}

// ---- strict input guards (typeof checks: "50", 5.5, -1, NaN, null all fail) ----
export const isPositiveInt = (v, max = 1_000_000) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max;
export const isNonNegInt = (v, max = 10_000_000) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
/** Fabric yards: positive, max 2 decimal places (yards are naturally fractional). */
export const isYards = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1_000_000 && round2(v) === v;
export const isRollId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/.test(v);
