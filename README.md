# ApparelFlow ERP - Cutting Operations & Gatekeeper Verification Terminal

A full-stack implementation of the Webtezza engineering challenge: a **server-enforced hard stop** that stops any cutting batch with a component shortage from reaching the Sewing Queue.

- **Live URL:** `https://YOUR-APP.onrender.com` (replace after deploying)
- **Stack:** React (Vite) · Node.js / Express · Knex · PostgreSQL (production, Neon) / SQLite (local and tests) · JWT auth · Vitest + Supertest

## Demo credentials

| Persona | Role | Email | Password |
|---|---|---|---|
| Cutting Supervisor | `cutting_supervisor` | supervisor@apparelflow.test | `Cutting@123` |
| Cutting Verifier | `cutting_verifier` | verifier@apparelflow.test | `Verify@123` |
| Sewing Supervisor | `sewing_supervisor` | sewing@apparelflow.test | `Sewing@123` |

The login screen has one-click persona buttons, and the header has a **Role Switcher** dropdown.
`GET /api/auth/demo-users` exists only to power this demo panel and would be removed in a real deployment.

## Run locally

```bash
npm install
npm --prefix client install
npm run build        # builds the React client into client/dist
npm start            # http://localhost:3000 (SQLite file in ./data)
npm test             # 24 automated tests
```
Development mode (two terminals): `npm run dev:server` and `npm run dev:client`, then open http://localhost:5173.
Requires Node 20 or newer (22 LTS recommended).

## Architecture

```
client/ (React + Vite)  --/api-->  server/src/app.js (Express)
                                     |- auth.js            JWT verify, role re-read from DB, requireRole()
                                     |- routes/orders.js   supervisor + verifier endpoints, hard stop
                                     |- routes/sewing.js   sewing queue (WHERE status = 'VERIFIED')
                                     |- domain.js          pure rules: traffic light, wastage, state machine, input guards
                                     |- orders.js          multiplier engine + response builder
                                     |- schema.js          tables + DB triggers (immutability)
                                     `- db.js              Knex: PostgreSQL via DATABASE_URL, else SQLite
```

### State machine

```
CUTTING_IN_PROGRESS -> PENDING_VERIFICATION -> VERIFIED -> IN_SEWING
                              |  ^
                              v  |
                           REJECTED (mandatory reason; supervisor re-submits)
```
Every transition passes through `assertTransition()` and uses a conditional `UPDATE ... WHERE id = ? AND status = ?` inside a transaction, so duplicate or concurrent requests cannot double-approve.

### API

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /api/auth/login | public | returns a JWT |
| GET | /api/recipes | supervisor, verifier | |
| GET / POST | /api/orders, /api/orders/:id | POST: supervisor. GET: supervisor + verifier | verifier never sees drafts |
| POST | /api/orders/:id/submit | supervisor | submit a draft / re-submit a rejected order |
| PUT | /api/orders/:id/counts | verifier | server computes GREEN / YELLOW / RED |
| POST | /api/orders/:id/approve | verifier | 403 wrong role, **422 if any RED or uncounted** |
| POST | /api/orders/:id/reject | verifier | 400 without a reason |
| GET | /api/sewing/queue | sewing | `WHERE status = 'VERIFIED'` hard-coded |
| POST | /api/sewing/:id/start | sewing | VERIFIED -> IN_SEWING |

### Security rules implemented

1. **Server-side RBAC:** `requireRole()` on every route. The role is re-read from the database on each request, not trusted from the token.
2. **Hard stop:** approval recomputes each status from the raw expected and actual counts, never from a stored or client-supplied flag. Any RED, missing or uncounted component returns `422`.
3. **Query isolation:** the sewing endpoints hard-code the status filter. Query parameters are ignored, and non-verified ids return `404`.
4. **Authenticated context:** `verifier_id` and the timestamp come from the JWT and the server clock. Values in the request body are ignored.
5. **Immutability:** database triggers make `verification_logs` append-only and lock `verification_items` once an order is VERIFIED or IN_SEWING.
6. **Input guards:** strict type and integer checks reject negatives, decimals, numeric strings and empty payloads with `400`. Fabric yards are the one exception: they allow up to 2 decimals because yardage is fractional by nature.

## Database schema

`users` · `recipes` · `recipe_components` · `cutting_orders` · `verification_items` · `verification_logs`

Extra columns: `cutting_orders.sewing_started_by` / `sewing_started_at`, and `verification_logs.audit_note` / `variance_snapshot`. There are foreign keys, unique constraints, CHECK constraints and an index on `cutting_orders.status`.

```
users 1--* cutting_orders *--1 recipes 1--* recipe_components
cutting_orders 1--* verification_items *--1 recipe_components
cutting_orders 1--* verification_logs *--1 users (verifier)
```

### Fabric wastage

`wastage % = (actual yards - expected yards) / expected yards x 100`, where expected = `target_qty x std_fabric_yards`.
It is stored in `verification_logs` when the decision is made, and shown to Sewing with a flag when it exceeds the recipe cap (informational only, per the spec).

## Tests

`npm test` runs 24 tests covering the 5 required rules (approve all-GREEN, block RED, reject needs a reason, 403 for non-verifiers, unapproved orders never reach the sewing queue) plus input validation, state-machine and immutability checks.

## Verify the security rules with cURL

```bash
BASE=http://localhost:3000
SUP=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{"email":"supervisor@apparelflow.test","password":"Cutting@123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")
curl -i -X POST $BASE/api/orders/1/approve -H "Authorization: Bearer $SUP"   # 403 Forbidden
```