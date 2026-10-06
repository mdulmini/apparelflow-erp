import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { HttpError, wrap } from './errors.js';

export function makeAuth(db, secret) {
  const sign = (user) => jwt.sign({ sub: user.id }, secret, { expiresIn: '8h' });

  /** Identity comes ONLY from the verified JWT. The role is re-read from the DB on every request,
   *  so a stale/forged role claim in a token can never grant access. */
  const authenticate = wrap(async (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'Invalid or expired session');
    }
    const user = await db('users').where({ id: payload.sub }).first();
    if (!user) throw new HttpError(401, 'Invalid or expired session');
    req.user = { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
    next();
  });

  const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Forbidden: your role is not permitted to perform this action'));
    }
    next();
  };

  const login = wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }
    const user = await db('users').where({ email: email.trim().toLowerCase() }).first();
    if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'Invalid email or password');
    res.json({
      token: sign(user),
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    });
  });

  return { authenticate, requireRole, login };
}