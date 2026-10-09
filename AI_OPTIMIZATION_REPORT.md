# AI Optimization Report

## 1. Tools & Prompting

- **Tool used:** Claude (Anthropic)
- **What it was used for:**
  - Architecture planning: Express API + React client, Knex for SQLite (local/tests) and PostgreSQL (production), JWT auth.
  - Relational schema design, seed data, and the state-machine rules.
  - Scaffolding the API routes, the React screens, and the test suite.
  - Drafting this README and report structure.
- **How I worked:**  I built it in the milestone order from the brief (database, order engine, verifier terminal, sewing queue). After each step I ran it myself, checked the output, and committed.
- **What I did manually:** installed and configured the toolchain, ran every test, tested the API with cURL as each role, clicked through every screen in the browser, and debugged the problems listed below.

## 2. Flawed / Broken AI Code and Advice

**2.1 Native SQLite module crashed the server (`Segmentation fault: 11`).**
The generated project used `better-sqlite3`, a native (compiled) add-on. On my Mac, `npm start` crashed with a segmentation fault, while `npm test` for the pure domain tests still passed, which made it confusing. I isolated it by loading the module on its own in `node -e`, then found my terminals were running an older Node 22.12.0. Updating Node with nvm to 22.23.3 and reinstalling fixed it. Lesson: a dependency that works for the AI's environment can fail on mine, so I now run `node -v` in every new terminal.

**2.2 A commit plan that would have left the app broken.**
The first suggested commit order added `app.js`, which imports `routes/sewing.js`, before that file existed, so the app would crash on those commits. Reading the plan, I noticed this and had the sewing import left out until the sewing route was added.

**2.3 My own edit error while following AI instructions.**
When adding the `sewingRouter` import to `app.js` I replaced the `ordersRouter` import line by accident. The server crashed with `ReferenceError: ordersRouter is not defined`. I read the stack trace (it pointed at line 34), restored the missing import, and confirmed the server restarted cleanly.

## 3. Human Refactoring

- Verified the hard stop myself, not just by trusting the tests: saved a count of 99 against an expected 100 and confirmed approval returned `422`, then rejected without a reason and confirmed `400`.
- Re-tested the sewing isolation with the wrong roles: Supervisor and Verifier got `403` on the sewing queue, the Sewing role got `403` on the orders list, and `GET /api/sewing/queue/1` returned `404` for a rejected order so it does not reveal that the order exists.
- Kept the strict number validation on both sides: the browser shows inline errors, and the server independently re-validates everything and returns `400`.
- Added tests for cases the first draft did not cover: a client-supplied `status: "GREEN"` must not override the server's calculation, a count of `0` is a shortage (not "missing"), double-approval returns `409`, and forged or missing tokens return `401`.
- Documented one deliberate decision: fabric yards accept up to 2 decimals (yardage is fractional), while quantities and counts reject decimals.

## 4. Defensive Architecture

- **State machine:** the `TRANSITIONS` table in `server/src/domain.js` is the single source of truth. Every status change calls `assertTransition()`, and the database update is conditional (`WHERE id = ? AND status = ?`) inside a transaction, so a double click cannot approve twice.
- **Layered guards on approval:** valid login token, then `requireRole('cutting_verifier')`, then state check, then "every component counted", then "no RED". The traffic-light status is recomputed from the raw numbers on the server, never trusted from a stored or client value.
- **Server-side identity:** the verifier ID and timestamp come from the token and server clock, never from the request body. The user's role is re-read from the database on every request, not trusted from the token.
- **Query isolation:** the sewing endpoints hard-code `WHERE status = 'VERIFIED'`. Query parameters are ignored.
- **Immutability:** database triggers make `verification_logs` append-only and lock `verification_items` once an order is VERIFIED or IN_SEWING. A test proves an update or delete is rejected by the database itself.
- **Tests:** 24 automated tests (`npm test`) cover the five required rules and the guards above.

## Honest limitations

- The demo-credentials endpoint exposes the demo passwords on purpose, for the evaluator's role-switcher. It would be removed in a real system.
- There is no rate limiting on login.
- Tests run against in-memory SQLite. Production uses PostgreSQL (Neon). I confirmed manually that the schema and seed data are created correctly on Neon (6 tables, 10 recipe components). I then ran the full order flow against Neon by hand before deploying.