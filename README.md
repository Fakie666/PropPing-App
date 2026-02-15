# PropPing (MVP)

Production-minded MVP for UK letting agents/property managers with multi-tenant support.

Current progress: Stage 6 complete.

Latest uplift: Product Experience Upgrade complete (dashboard, filters, exports, and test tooling).

## Stack

- Node.js 20
- Next.js (App Router) + TypeScript
- PostgreSQL + Prisma
- Twilio/OpenAI SDKs installed for later stages
- Vitest

## Stage 1 Scope Implemented

- Project scaffold with scripts: `dev`, `build`, `start`, `prisma`, `test`, `worker`
- Docker Compose for PostgreSQL
- Prisma schema, initial migration, and seed data
- Basic login auth (email/password + signed cookie session)
- Minimal admin UI shell:
  - `/dashboard`
  - `/login`
  - `/inbox/leads`
  - `/inbox/maintenance`
  - detail pages for leads/maintenance
  - `/properties`
  - `/compliance`
  - `/settings`
  - `/test`
- Worker process skeleton (`npm run worker`)
- Initial Vitest test (`tests/session.test.ts`)

## Stage 2 Scope Implemented

- `POST /api/twilio/voice/incoming`
  - Resolves tenant by Twilio `To` number
  - Returns TwiML `<Dial>` forwarding to tenant `forwardToPhoneNumber` with `timeout=20` and action callback to dial-status route
- `POST /api/twilio/voice/dial-status`
  - Verifies Twilio signature (`x-twilio-signature`)
  - Logs answered/missed call into `Call`
  - For `no-answer`/`busy`/`failed`:
    - Creates a new `Lead`
    - Sends missed-call triage SMS (mocked sender by default in dev)
    - Logs outbound messages
    - Schedules follow-up jobs (+2h and next business day 09:30 tenant timezone)
    - Sends owner notification SMS
- Mockable Twilio SMS client with `MOCK_TWILIO=true` default-friendly behavior when credentials are missing

## Stage 3 Scope Implemented

- `POST /api/twilio/sms/incoming`
  - Verifies Twilio signature
  - Resolves tenant by Twilio `To` number
  - Processes inbound SMS through deterministic state machine
- Deterministic lead/maintenance state machine:
  - STOP/UNSUBSCRIBE opt-out handling (`OptOut` + cancel pending jobs)
  - Intent routing (`1/2/3`) for viewing, maintenance, and general
  - Viewing flow: name -> area/postcode/property -> requirements -> booking/callback
  - Maintenance flow: name -> address/postcode -> issue -> severity
  - General flow: name -> topic -> callback
  - Out-of-area postcode handling (`OUT_OF_AREA` + job cancellation)
- OpenAI structured extraction (single call per inbound max) with fallback parser for:
  - STOP detection
  - intent `1/2/3`
  - UK postcode
  - severity keywords
  - anger/safety heuristics
- Template engine and message logging for inbound/outbound customer + owner notifications

## Stage 4 Scope Implemented

- Worker now processes due jobs end-to-end:
  - DB locking with `FOR UPDATE SKIP LOCKED`
  - lock timeout recovery
  - retry scheduling and max-attempt fail handling
  - `SENT` / `FAILED` / `CANCELED` transitions
- Implemented executors for:
  - `LEAD_FOLLOW_UP`
  - `COMPLIANCE_REMINDER` (execution support for future scheduled jobs)
  - `OWNER_NOTIFICATION`
- Follow-up cancellation logic:
  - cancels pending jobs when linked lead/maintenance conversation reaches terminal status
  - worker pre-pass cleanup each cycle
- Worker runtime knobs via env:
  - `WORKER_POLL_INTERVAL_MS`
  - `WORKER_BATCH_SIZE`
  - `WORKER_LOCK_TIMEOUT_MS`
  - `JOB_RETRY_DELAY_MS`

## Stage 5 Scope Implemented

- Properties workflow:
  - Manual property create form on `/properties`
  - CSV import on `/properties` with header validation
  - Default compliance document shells (MISSING) auto-created for each property
- Compliance workflow:
  - `/compliance` overview with property-level links
  - `/compliance/property/[propertyId]` detail page
  - Upload/update compliance document metadata and local file storage under `/uploads`
  - Per-property reminder schedule refresh action
- Settings workflow:
  - Tenant settings edit form (`forwardTo`, owner phone, timezone, postcode prefixes, booking URLs)
  - Message templates JSON editor
  - Compliance policy editor (`dueSoonDays`, `overdueReminderDays`) + tenant-wide reminder reschedule
- Reminder scheduling:
  - Compliance reminder job generation for 30/14/7 days before expiry and recurring overdue reminders
- Worker compliance executor now re-queues overdue reminders at policy frequency

## Stage 6 Scope Implemented

- Calm communications + auto handoff:
  - anger/escalation heuristics now trigger calm de-escalation template
  - conversation is marked `NEEDS_HUMAN`
  - owner notification SMS is sent
  - pending automation jobs are canceled
- Safety-critical maintenance handling:
  - emergency keyword detection forces `NEEDS_HUMAN`
  - emergency template sent to caller
  - owner notified immediately by SMS
- Manual human handoff resume controls:
  - lead detail page: `/inbox/leads/[leadId]` includes `Resume Automation`
  - maintenance detail page: `/inbox/maintenance/[requestId]` includes `Resume Automation`
  - resume transitions restore active statuses and clear maintenance `needsHuman`
- Expanded Stage 6 tests:
  - API route test for voice incoming TwiML Dial response
  - dial-status service test for missed-call SMS + follow-up scheduling
  - SMS state-machine tests for maintenance routing, emergency handoff, STOP opt-out, out-of-area cancellation, and calm-mode handoff
  - compliance threshold test for 30/14/7 + overdue reminder timing

## Product Experience Upgrade

- New command center page:
  - `/dashboard` with live KPI cards, priority queues, activity timeline, and platform-readiness checks
- Smarter inbox operations:
  - advanced filters on `/inbox/leads`, `/inbox/maintenance`, `/compliance`, and `/properties`
  - fast reset and one-click CSV export actions
- CSV exports (authenticated):
  - `/api/export/leads`
  - `/api/export/maintenance`
  - `/api/export/properties`
  - `/api/export/compliance`
- Test operations tooling:
  - `/test` now sends real/mock test SMS and logs messages in-app
- Ops navigation:
  - sidebar includes live Ops Pulse counters and export shortcuts

## Windows 10 PowerShell Quick Start

From repo root:

```powershell
npm run setup:win
```

After setup:

```powershell
npm run dev
```

Open: `http://localhost:3000/dashboard`

Full verification:

```powershell
npm run verify:win
```

Stage 6 targeted verification:

```powershell
npm test
npm run build
```

Stage 2 missed-call flow smoke check only:

```powershell
npm run smoke:stage2
```

Stage 3 SMS/state-machine smoke check only:

```powershell
npm run smoke:stage3
```

Stage 4 worker/job smoke check only:

```powershell
npm run smoke:stage4
```

Stage 5 properties/compliance/reminder smoke check only:

```powershell
npm run smoke:stage5
```

## Windows Desktop EXE (Electron)

Build and package:

```powershell
npm install
npm run desktop:exe
```

Send clients this installer:

- `dist-desktop\PropPing Desktop Setup *.exe`

Desktop behavior:

- Opens your hosted PropPing app and loads `/login`.
- If unreachable, it shows a setup screen to enter the correct hosted server URL (for example `https://app.yourdomain.com`).
- Includes `Retry` and `Open Config Folder` actions to recover quickly.

### Desktop Dev Mode (engineers)

```powershell
npm run desktop:dev
```

## Environment Setup

1. Copy env file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Run migration and generate Prisma client:

```bash
npm run db:generate
npm run prisma -- migrate deploy
```

5. Seed demo data:

```bash
npm run db:seed
```

6. Start app:

```bash
npm run dev
```

App URL: `http://localhost:3000`

## Demo Credentials

- Email: `admin@demo.propping.local`
- Password: `DemoPass123!`

## Worker

Run worker loop:

```bash
npm run worker
```

Optional worker tuning (set in `.env`):

- `WORKER_POLL_INTERVAL_MS` default `60000`
- `WORKER_BATCH_SIZE` default `25`
- `WORKER_LOCK_TIMEOUT_MS` default `600000`
- `JOB_RETRY_DELAY_MS` default `60000`

Run worker once (smoke check):

```bash
WORKER_ONCE=1 npm run worker
```

PowerShell:

```powershell
$env:WORKER_ONCE='1'; npm run worker; Remove-Item Env:WORKER_ONCE
```

Or run full automated verification:

```powershell
npm run verify:win
```

## Production Deployment

### Required production settings

- Set `NODE_ENV=production`
- Set a strong `SESSION_SECRET` (required in production)
- Set `MOCK_TWILIO=false`
- Set real `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and Twilio numbers
- Use persistent storage for:
  - Postgres data
  - `UPLOAD_DIR` (default `/app/uploads` in Docker setup)

### Process model

- Web app: `npm run start:prod`
- Optional separate worker: `npm run worker:prod`

`npm run start:prod` now:

- retries `prisma migrate deploy` on boot
- starts web server
- auto-starts worker on Railway by default (can be controlled with `RUN_WORKER`)

### Docker deployment (recommended)

1. Copy deployment env template:

```bash
cp .env.deploy.example .env.deploy
```

2. Fill `.env.deploy` values (`APP_BASE_URL`, Twilio/OpenAI credentials, `SESSION_SECRET`).

3. Build and run:

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

4. First deploy only: seed demo data:

```bash
docker compose -f docker-compose.deploy.yml exec web npm run db:seed
```

5. Verify health:

```bash
curl http://localhost:3000/api/health
```

PowerShell:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/health"
```

### Railway quick deploy (no VM, simplest)

1. Deploy from GitHub repo in Railway.
2. Add PostgreSQL service in the same Railway project.
3. In Web service variables, set:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
DIRECT_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
SESSION_SECRET=<long-random-secret>
MOCK_TWILIO=true
RUN_WORKER=true
```

4. Deploy Web service (`npm run start:prod` is default-safe).
5. Open service shell once and seed demo data:

```bash
npm run db:seed
```

6. Verify:
- `https://<your-railway-domain>/api/health`
- Login: `admin@demo.propping.local` / `DemoPass123!`

Notes:
- One Web service is enough on Railway because worker auto-runs when `RUN_WORKER=true`.
- If you want a dedicated Worker service, set Web `RUN_WORKER=false` and run `npm run worker:prod` on the Worker service.

### Non-Docker deployment

Run web and worker as two separate long-running processes with the same environment:

```bash
npm ci
npm run build
npm run start:prod
```

In a second process:

```bash
npm run worker:prod
```

## Tests

```bash
npm test
```

## Twilio + ngrok (for Stage 2+ wiring)

1. Expose local app:

```bash
ngrok http 3000
```

2. Set Twilio webhook URLs (replace `<NGROK_URL>`):

- Voice incoming: `<NGROK_URL>/api/twilio/voice/incoming`
- Voice status callback: `<NGROK_URL>/api/twilio/voice/dial-status`
- SMS inbound: `<NGROK_URL>/api/twilio/sms/incoming`

3. Add to `.env`:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_WEBHOOK_BASE_URL=<NGROK_URL>`
- `MOCK_TWILIO=true` (recommended for local testing)

### Local webhook simulation (PowerShell)

With `npm run dev` running:

```powershell
Invoke-WebRequest -Method Post `
  -Uri "http://localhost:3000/api/twilio/voice/incoming" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "To=%2B442071234567&From=%2B447700900333&CallSid=CA_LOCAL_INCOMING"
```

```powershell
Invoke-WebRequest -Method Post `
  -Uri "http://localhost:3000/api/twilio/voice/dial-status" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "To=%2B442071234567&From=%2B447700900333&CallSid=CA_LOCAL_DIAL&DialCallStatus=no-answer"
```

```powershell
Invoke-WebRequest -Method Post `
  -Uri "http://localhost:3000/api/twilio/sms/incoming" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "To=%2B442071234567&From=%2B447700900333&MessageSid=SM_LOCAL_1&Body=2"
```

Note: for local simulation, keep `TWILIO_AUTH_TOKEN` empty in `.env` or provide a valid Twilio signature header.

## Upload Storage

- Local file storage path: `uploads/`
- `ComplianceDocument.filePath` stores relative path
- S3 swap will be documented in later stages
