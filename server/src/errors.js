export class HttpError extends Error {
    constructor(status, message, details) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }
  export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  
  export function errorHandler(err, _req, res, _next) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }