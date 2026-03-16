# sodacircle

`sodacircle` is an internal recruiting workflow app for turning a hiring brief into a ranked shortlist, personalized outreach, and structured follow-up.

The current MVP is designed around a simple but useful loop:

`hiring brief -> candidate import -> AI ranking -> shortlist approval -> outreach draft -> reply triage`

## What the MVP does

- Paste a job req in plain English
- Define must-haves, nice-to-haves, and disqualifiers
- Upload a candidate source CSV
- Convert the brief into a structured search recipe
- Score and rank candidates with explainable fit signals
- Approve, save, or reject top candidates
- Generate personalized outbound email drafts
- Mark reply outcomes and preview downstream workflow actions

## Current stack

- Next.js
- React
- TypeScript
- Tailwind CSS

## Project structure

```text
app/
  globals.css
  health/route.ts
  layout.tsx
  page.tsx
components/
  recruiting-workbench.tsx
lib/
  ai.ts
  mock-data.ts
  types.ts
public/
  sample-candidates.csv
```

## How it works

### 1. Intake

The app starts with a recruiter-style hiring brief and a structured criteria editor. The brief can be converted into a search recipe with:

- function
- segment
- industry focus
- evidence signals
- exclusions

### 2. Candidate import

For v1, candidate sourcing is driven by CSV upload rather than external integrations. This keeps the first version fast, debuggable, and useful.

The included sample file is:

- `public/sample-candidates.csv`

Expected columns:

- `name`
- `title`
- `company`
- `location`
- `linkedin_url`
- `summary`
- `experience`
- `email`
- `notes`

### 3. Ranking

The ranking engine in `lib/ai.ts` uses a hybrid scoring approach:

- Rules-based scoring for trust and explainability
- LLM-style fit reasoning based on the candidate profile
- Lightweight semantic overlap between the candidate profile and ideal role context

Each candidate gets:

- a fit score
- matched signals
- risks or gaps
- an outreach angle
- a recommendation

### 4. Outreach

Approved candidates get a personalized outbound draft with:

- role context
- candidate-specific relevance
- a suggested narrative angle
- a simple CTA

### 5. Reply triage

The MVP includes stubbed reply classification states such as:

- `interested`
- `maybe later`
- `not interested`
- `refer me`
- `comp mismatch`
- `location mismatch`
- `unsubscribe`

## Local development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Then open `http://localhost:8080`.

Health check endpoint:

```bash
curl http://localhost:8080/health
```

## Docker and ECS

Build the production image:

```bash
docker build -t sodacircle .
```

Run it locally:

```bash
docker run --env-file .env.example -p 8080:8080 sodacircle
```

Deployment helpers:

- `Dockerfile`
- `.env.example`
- `deploy/ecs.md`

For Union Station with Google OAuth enabled, allow `/health` as a public path so ECS health checks can succeed without auth.

## Notes

- This repo currently uses mocked data and local client-side state.
- The app is optimized as an interactive prototype for product validation.
- The scoring logic is intentionally explainable rather than production-grade.

## Recommended next steps

- Add persistence with Postgres and Prisma or Supabase
- Store uploaded CSVs and normalized candidate records
- Move scoring and enrichment into background jobs
- Add auth
- Add email sending and delivery tracking
- Add Slack and ATS integrations
- Add DynamoDB-backed persistence for ECS environments
- Replace mocked AI logic with live model calls

## Positioning

`sodacircle` is not trying to replace recruiting teams.

The core idea is to remove repetitive sourcing and recruiting ops work so teams can spend more time:

- aligning with hiring managers
- prioritizing the right candidates
- writing better outreach
- moving strong replies into the workflow quickly
