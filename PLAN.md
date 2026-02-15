# PropPing Build Plan

## Stage Checklist

- [x] Stage 1: scaffold + docker + prisma + seed + basic auth + minimal UI shell
- [x] Stage 2: Twilio voice webhooks + mocked Twilio client + logging
- [x] Stage 3: SMS inbound + state machine + templates + OpenAI extraction + fallback
- [x] Stage 4: Jobs + worker + follow-ups
- [x] Stage 5: Properties + compliance + reminders
- [x] Stage 6: Calm mode + human handoff + tests + README polish

## Detailed Step-by-Step Plan

### Stage 1
- [x] Initialize Next.js App Router + TypeScript project and npm scripts (`dev`, `build`, `start`, `prisma`, `test`, `worker`).
- [x] Add Docker Compose for local PostgreSQL.
- [x] Add Prisma setup with initial schema and enums for MVP models:
  - `Tenant`, `User`, `Lead`, `MaintenanceRequest`, `Message`, `Call`, `Property`, `ComplianceDocument`, `Job`, `OptOut`.
- [x] Create initial migration files.
- [x] Add Prisma seed script for demo tenant, demo admin user, three properties, sample compliance docs.
- [x] Add basic auth primitives (password hashing + login action + cookie session).
- [x] Create minimal UI shell pages:
  - `/login`
  - `/inbox/leads`
  - `/inbox/maintenance`
  - `/properties`
  - `/compliance`
  - `/settings`
  - `/test`
- [x] Add `.env.example` with required variables.
- [x] Add initial README with setup + run + seed + verification commands.

### Stage 2
- [x] Implement Twilio voice incoming and dial-status routes.
- [x] Add Twilio signature verification utility.
- [x] Add TwiML response builder for call forwarding.
- [x] Add call/missed-call logging and mocked Twilio SMS sender abstraction.

### Stage 3
- [x] Implement SMS inbound webhook route.
- [x] Add deterministic state machine for lead and maintenance flows.
- [x] Add OpenAI structured extraction service + fallback parser.
- [x] Add template engine and message logging.

### Stage 4
- [x] Implement `Job` scheduler and worker loop (`npm run worker`).
- [x] Add follow-up scheduling and cancellation rules.
- [x] Add retry handling and status transitions for jobs.

### Stage 5
- [x] Implement properties CRUD list + CSV import.
- [x] Implement compliance overview/detail + document upload + expiry handling.
- [x] Implement compliance reminder job creation and notification behavior.

### Stage 6
- [x] Implement calm mode heuristics and automatic human handoff behavior.
- [x] Add safety/emergency template handling and owner notifications.
- [x] Add manual resume controls on lead and maintenance detail pages.
- [x] Add Vitest + API route tests with mocked Twilio/OpenAI.
- [x] Polish README with Twilio/ngrok webhook setup and operational notes.
