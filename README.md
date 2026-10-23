# MedSync — Medication Coordination Platform (Phases 1–5, partial)

Doctors, patients, caregivers and hospital staff coordinate medicines on one source of truth, with deterministic drug-safety checks.
Built to the *MedSync Build Spec*: TypeScript, AWS CDK, React. **Region:** deploy to a region that supports Bedrock, Comprehend Medical
and (optionally) HealthLake, e.g. `us-east-1` (the default). Check data-residency requirements (DPDP Act 2023) before real patient data.

## What is built (this release)

| Spec module | Status |
|---|---|
| 0 Foundation: Cognito roles/groups, API-level authorisation, ownership checks, append-only audit, KMS, CloudTrail, caregiver invite/accept/revoke | Built (MFA code entry in UI not built) |
| 1 Admin/Nurse: patients, read-only clinical view, doctors, appointments, insurance + history, pharmacies, confirmation queue, low-adherence overview | Built |
| 2 Doctor directory + booking: ZocDoc-style search, doctor cards with next-slot buttons, 3-step booking, double-booking prevention, reschedule/cancel, .ics export | Built (Google Calendar sync and map pane not built) |
| 3 Day-before confirmation: EventBridge 18:00 IST job -> task + automatic doctor message -> Confirm / Request reschedule -> live status; unanswered after 4 h flagged "Needs a call" | Built (delivery: in-app always, SMS via SNS when enabled; email/WhatsApp not built) |
| 4 Doctor dashboard: patients with adherence flags, appointments with confirmation prompts, availability, online status | Built |
| 5 Prescribing, modify, discontinue, immutable history, allergy + duplicate checks, multi-doctor view | Built |
| 6 Drug-drug interactions (dataset lookup + Step Functions + Bedrock explanation-only) | Built |
| 7 Dose tracking: schedule generation, 10-min reminders, Taken/Skip, auto-Missed after 60-min grace, escalation rules, adherence dashboards (%, streak, per-medicine, time-of-day), caregiver mark-on-behalf | Built. Live updates are 15-30 s polling, **not** AppSync subscriptions yet |
| 10 Patient/caregiver dashboard (home, find, health, appointments, caregivers, notifications bell, large-text toggle) | Mostly built (consultation summaries, ordering, chat, map pending) |
| 13 Insurance (view, admin edit, history) | Built (expiry reminder notification pending) |
| 8 AI transcription/summary/Google Calendar, 9 chat, 11 maps, 12 ordering + pharmacy portal | **Not built** |

**Notification channels:** in-app (bell) is always real and logged with delivery status. SMS is sent through SNS only when deployed with `-c smsEnabled=true` and the recipient has a valid E.164 phone number (SNS SMS usually needs sandbox exit/origination setup). Email, WhatsApp, push and voice are **not built**. Note: AWS has announced end of support for Amazon Pinpoint (Oct 30, 2026 per AWS's published notice; please verify), so this build uses SNS + in-app instead of Pinpoint. Timestream for LiveAnalytics may be unavailable to new accounts: it is optional (`-c timestream=true`) and write-only; dashboards read DynamoDB.

## Safety design (spec §2, §8)

* Interactions, allergies and duplicates are **rule/database driven** (`backend/src/domain`). Bedrock only rewrites an already-retrieved record (temperature 0, Guardrail, "not stated" rule); if it fails the UI still shows the stored fields.
* Free-text drug names are rejected; every prescribed drug, form and strength must exist in the catalogue.
* Save re-runs the safety workflow **server-side**; Major/Contraindicated/allergy alerts need a logged acknowledgement reason (HTTP 409 otherwise).
* "No known interaction found in our database" is the only neutral wording; the UI never says "safe".
* Admin/Nurse cannot change clinical content: API returns 403 and the denied attempt is written to `AuditEvents`.
* Prescription rows are immutable versions (`attribute_not_exists` conditional put). History = all versions across all doctors.

**Interaction dataset limitation:** `backend/src/seed/interactions.json` is a small hand-curated set for demonstration (see its `limitations` field). It is not a licensed interaction database. Have a clinical pharmacist review it, or replace it with an open/licensed source (e.g. DrugBank/openFDA-derived), before any real use. State this in the demo.

## Architecture (AWS)

API Gateway (Cognito authoriser) → Lambda (role + ownership checks) → DynamoDB (KMS-encrypted, PITR). Safety workflow = Step Functions Express
(Normalise → InteractionLookup → Evaluate → Explain) calling Lambdas; Bedrock + Guardrail for explanations; Comprehend Medical `InferRxNorm`
cross-reference (traceability only); optional HealthLake FHIR sync (best-effort, `MedicationRequest`/`AllergyIntolerance`); S3 + CloudFront for the web app;
CloudTrail for API audit. Only two services outside the mandated list are used: CloudFront (HTTPS) and — in the later transcription phase — Transcribe Medical.
IAM Identity Center is configured by your AWS admins (not CDK): assign least-privilege permission sets to the dev team and hospital IT.

## Run it

```bash
npm install
npm test                      # 21 unit tests, no AWS needed
npm run typecheck
cd infra && npx cdk bootstrap   # once per account/region
cd .. && npm run deploy         # builds the frontend, then cdk deploy
# optional flags:  -c healthLake=true   -c bedrockModelId=<id>   -c destroyOnDelete=true (hackathon teardown)
SEED_PASSWORD='Choose-A-Strong-Pw-1!' npm run seed   # catalogue + interactions + demo users (no emails are sent)
```

Enable access to your chosen Bedrock model in the Bedrock console first. Seeded logins use `@example.com` addresses (override with `SEED_EMAIL_DOMAIN`):
`nurse.demo`, `dr.rao`, `dr.shetty`, `dr.nair`, `dr.gowda`, `dr.khan`, `pt.ramesh`, `pt.lakshmi`, …, `cg.ramesh`, `pharmacy.demo`.
All demo data is fictional.

**Demo 1:** sign in as `dr.shetty`, open *Ramesh Iyer* (warfarin from Dr. Rao), prescribe aspirin or ibuprofen → Major alert from the stored record; finalising requires an acknowledgement reason.
Also try: *Arjun Mehta* (isosorbide) + sildenafil → Contraindicated; *Lakshmi Devi* (penicillin allergy) + amoxicillin → allergy block.
**Demo 2 (booking + confirmation):** sign in as a patient → Find a doctor → click a slot button → confirm; the nurse sees it under Appointments. The 18:00 IST job creates the confirmation task for tomorrow's bookings; to trigger it immediately, invoke the `DayBeforeFn` Lambda from the console.
**Demo 4 (adherence):** seeded data gives *Ramesh Iyer* poor adherence ending on two missed warfarin doses. Sign in as `dr.rao`: the patient list flags low adherence. The every-minute scheduler marks new overdue doses Missed, notifies the patient, and escalates to caregiver (`cg.ramesh`) and doctors with a deduplicated daily alert. Sign in as `pt.ramesh` to see the Today checklist, streak and heat map.

Local frontend dev: copy `frontend/public/config.example.json` to `config.json` with the stack outputs, then `npm run dev -w frontend`.

## Verification status — read this

This release was authored in a sandbox **without access to the npm registry or an AWS account**, so the following was **not** run:
`npm install`, the TypeScript build of AWS-SDK-dependent code, `cdk synth/deploy`, the Vite build, and any end-to-end test against real AWS.
What *was* verified: the 21 unit tests (interaction/allergy/duplicate/slot/permission/versioning/FHIR/dose-schedule/adherence/escalation logic), a TypeScript strict pass over backend code with AWS SDK types stubbed, and a syntax pass over every frontend/infra file.
Expect to fix small compile or CDK-property issues on first build (CDK/SDK versions move quickly); the module boundaries are small to make that easy.
Known gaps: MFA code entry in the UI, no AppSync real-time subscriptions yet (polling instead), the byStatus dose index is a single hot partition (fine for a demo, shard it for scale), dose events are generated 60 days ahead (extend with a nightly job for longer courses), the frontend was never type-checked or rendered in a browser (no registry access), doctors' appointment confirmation relies on in-app/SMS only, patient list uses a DynamoDB scan (fine for hundreds of rows; move to OpenSearch for scale), drug search uses a cached scan instead of OpenSearch, HealthLake sync is best-effort and POSTs a new FHIR resource per version.
