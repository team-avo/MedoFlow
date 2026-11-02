# Video consultations (8x8 JaaS) — walkthrough and verification

**Branch:** `feat/video-jaas` (from `development` at `ff72768`) · **Date:** 2026-11-02 · **Decision record:** [ADR 0007](../docs/adr/0007-video-consultations-jaas.md)

Doctor and patient meet by video inside MedoFlow: the provider in the consultation room, the patient from their join link. The integration with 8x8's Jitsi as a Service (JaaS) already existed; this change makes it safe to switch on. Turning it on is now three settings (plus one policy in production), and a server without them says "Video calls are not set up" instead of failing.

**Want to check it yourself?** §6 is a step-by-step guide with your JaaS key: two browser windows, one call.

## 1. Status

| Area             | What it must do                                                                                                                  | State              | Evidence                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------- |
| Token content    | No email; first name only for the patient; 8x8 recording, livestreaming and transcription off; 90-minute lifetime                | ✅                 | `jaasTokens.test.ts` (12)                      |
| Who gets a token | Only the session's provider (moderator) and the session's patient; others 404; another clinic 404                                | ✅                 | `consultationVideo.int.test.ts` (12)           |
| Join link        | 410 once expired or the call ended; a new call gets a new room                                                                   | ✅                 | same                                           |
| Not configured   | 503 `video_not_configured`; the UI says so on both sides                                                                         | ✅                 | integration + `video-consultation.spec.ts` (5) |
| Production gate  | Partial or broken key fatal; `VIDEO_PHI_POLICY` required with JaaS on                                                            | ✅                 | `jaasTokens.test.ts`                           |
| Call UI          | Only mic, camera, hang up, chat, tile view, fullscreen, settings; a refused token shows **Try again**, which fetches a new token | ✅                 | `jitsiVideoCall.test.tsx` (7) + e2e            |
| Audit            | `VIDEO_ROOM_CREATED`, `VIDEO_TOKEN_ISSUED` with ids only                                                                         | ✅                 | integration                                    |
| Real 8x8 call    | Two browsers, one call, no 8x8 log-in                                                                                            | ⬜ owner step (§6) | —                                              |
| BAA              | 8x8 BAA signed before real patients                                                                                              | ⬜ owner step (§5) | HIPAA checklist §1.2                           |

## 2. What was wrong

Found by reading the code before changing it:

1. **The token switched 8x8 recording, livestreaming and transcription on**, and carried the patient's full name and email. Any of those would put patient data at 8x8 beyond the live call.
2. **Anyone in the clinic could get a token.** `GET /consultations/:id/video-token` checked only the clinic: any patient or provider of the clinic with a session id got in, and every provider became moderator. Any provider could also open the room.
3. **The join link never stopped working for video.** It issued tokens after its 24-hour expiry and after the call ended.
4. **Silent fallback.** Without JaaS settings the backend pointed the browser at `meet.jit.si`, which cannot be embedded any more; the call just failed to load.
5. **No production gate.** Nothing stopped a deploy from sending real patients' calls to 8x8 without a BAA.
6. **"Retry" did nothing.** The call component's Retry button reset a flag but never reloaded the call.
7. **Dead code.** An unused Daily.co integration, plus comments calling the 8x8 room "Daily.co".

## 3. What changed

**Backend**

| File                                            | Change                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/jaasService.ts`                       | Token: no email, `Dr. <surname>` / first name, features off, 90 min. No `meet.jit.si` fallback: 503 `video_not_configured`. `videoConfigProblems()` for boot. `isOwnRoom()`, display-name helpers.                                                                               |
| `controllers/consultationController.ts`         | `createVideoRoom`: only the session's own provider. `getVideoToken`: only the session's patient or provider; moderator only for the provider. `getVideoTokenByJoinToken`: reuses `getSessionByToken` (expiry → 410), refuses ended calls (410 `consultation_ended`). Audit rows. |
| `services/consultationService.ts`               | Expired-link message now says what to do: "Ask your clinic for a new one."                                                                                                                                                                                                       |
| `config/envValidation.ts`                       | Runs `videoConfigProblems()`.                                                                                                                                                                                                                                                    |
| `services/dailyService.ts`                      | Removed (unused).                                                                                                                                                                                                                                                                |
| `render.yaml`, `.env.example`, `edge/worker.ts` | `JAAS_*` and `VIDEO_PHI_POLICY` documented on Render; Daily.co removed.                                                                                                                                                                                                          |

**Frontend**

| File                                                             | Change                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/consultation/JitsiVideoCall.tsx`                     | Toolbar pinned in `JITSI_TOOLBAR_BUTTONS`; recording/livestreaming off in the call config too. A fatal call error (e.g. a refused token) or a blocked script shows a panel; **Try again** asks the page for a fresh token (or reloads the call). Responsive height. |
| `app/dashboard/provider/appointments/[id]/consultation/page.tsx` | The provider's name in the call; **Try again** re-fetches the token. The 503 text reaches the page's error banner.                                                                                                                                                  |
| `app/(public)/consultation/[token]/page.tsx`                     | Stops polling and says why on 503 ("Video calls are not set up yet. Please contact your clinic.") and 410 ("This consultation has ended" / link expired). First name only in the call. Full-height call.                                                            |

**Docs:** ADR 0007; HIPAA checklist §1.2 video row (8x8 only, BAA pending, the gate, the end-to-end-encryption decision).

## 4. Evidence (local, 2026-11-02)

```text
backend   typecheck (app + tests) ✓ · lint ✓
backend   unit: 28 files · 444 passed            (new: jaasTokens.test.ts, 12)
frontend  typecheck ✓ · lint ✓
frontend  unit: 30 files · 370 passed            (new: jitsiVideoCall.test.tsx, 7)
frontend  Playwright (mocked API, production build): 63 passed, 10 skipped (opt-in live specs), 0 failed
          new: video-consultation.spec.ts, 5 — provider opens the room, patient joins it,
          no video set up (both sides), ended consultation
backend   integration (Postgres, RLS enforced): 16 files · 262 passed, 1 skipped, 0 failed
          new: consultationVideo.int.test.ts, 12 — 7 of them fail against the old controller
          (wrong provider, other patient, expired / ended link, audit rows)
audit     backend ✓ · frontend ✓ (after raising the follow-redirects override, below)
secrets   gitleaks over every changed file: no leaks found
```

The e2e tests replace 8x8's `external_api.js` with a stub that records what the page hands to Jitsi (room, token, toolbar), so nothing reaches 8x8.

**Dependency fix found on the way:** the frontend audit gate failed on a new advisory, `follow-redirects` 1.16.1 (GHSA-mrwp-f3q8-3g9p, high, via `axios`), the same on `development`. The existing pnpm override in the root `package.json` now pins `^1.16.2`, the patched release; only that package changed in the lockfile. Frontend unit tests re-ran green on it.

## 5. Your steps

1. **JaaS console** (<https://jaas.8x8.vc>) → **API Keys**:
   - copy the **App ID** (`vpaas-magic-cookie-…`);
   - **Add API key → Generate API key pair**, and **download the private key at once** (8x8 keeps only the public key);
   - copy the key's **Key ID** (`kid`, `vpaas-magic-cookie-…/…`).
2. **Render** (backend service → Environment):
   - `JAAS_APP_ID`, `JAAS_KID`;
   - `JAAS_PRIVATE_KEY`: the PEM on **one line**, each newline written as `\n`. In Git Bash: `awk 'BEGIN{ORS="\\n"} {print}' jaas-private.pem` prints it that way; copy the output;
   - `VIDEO_PHI_POLICY=synthetic-data-only` (test environment). Without it the deploy log shows `[FATAL] VIDEO_PHI_POLICY must be …` and the backend does not start.

   Saving restarts the service; no rebuild needed.

3. **Before real patients:** request and sign 8x8's BAA, then change `VIDEO_PHI_POLICY` to `baa-signed`. The free tier covers 25 monthly active users; size a paid tier to the clinics.
4. Sign ADR 0007 (CTO, Security Officer).

## 6. Manual local test with your JaaS key

Synthetic accounts only. About 20 minutes.

### 6.1 Setup

1. Save the private key as `backend/secrets/jaas-private.pem` (the `secrets/` folder is gitignored).
2. Add to `backend/.env`:

   ```bash
   JAAS_APP_ID=vpaas-magic-cookie-…
   JAAS_KID=vpaas-magic-cookie-…/…
   JAAS_PRIVATE_KEY_PATH=./secrets/jaas-private.pem
   ```

3. Start Postgres (and Redis if you also use the AI scribe), the backend (`corepack pnpm --filter medoflow-backend dev`) and the frontend (`corepack pnpm --filter medoflow-frontend dev`) as usual.
   - **Expect** in the backend log: no `JAAS_*` line. If the key is missing or broken you see `[WARN] JAAS_KID is not set` (or similar) locally; production would refuse to start.
4. The test accounts come from `prisma/seed.ts`: `doctor@medoflow.test` (Dr. Chen) and `patient@medoflow.test` (Anika Patel), password `test1234`. If they are missing: `cd backend && corepack pnpm exec ts-node prisma/seed.ts`.

Use two windows: a normal one for the provider and an **Incognito** one for the patient. Allow camera and microphone when the browser asks. With one webcam, Chrome may give it to only one window; the other then joins with audio only, which is fine for this test.

### 6.2 Checks

| #    | Do                                                                                                                                                                                                                                   | Expect                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | **Patient window:** sign in as `patient@medoflow.test`, book **Telehealth Check-in** with Dr. Chen, the next free weekday slot.                                                                                                      | The booking is confirmed (the seeded services need no prepayment or approval).                                                                                                                                                                             |
| V-2  | Open **Account → Appointments**, click the new appointment. Note the id at the end of the URL.                                                                                                                                       | The appointment page. No "Join Consultation" yet: the provider has not opened the room.                                                                                                                                                                    |
| V-3  | **Provider window:** sign in as `doctor@medoflow.test`, open `http://localhost:3000/dashboard/provider/appointments/<id>/consultation`.                                                                                              | The consultation room with a **Patient join link** and **Start Video Call**.                                                                                                                                                                               |
| V-4  | **Patient window:** reload the appointment page, click **Join Consultation**, then **I Consent to Recording** (V-9 relies on the recording; with **No, do not record** the call works the same, but the link stays usable after it). | "Waiting for your provider to start the video call…".                                                                                                                                                                                                      |
| V-5  | **Provider:** click **Start Video Call**.                                                                                                                                                                                            | The 8x8 call opens inside the page, straight into the meeting: no 8x8 log-in, no pre-join screen. The toolbar has microphone, camera, hang up, chat, tile view, fullscreen and settings — **no record, livestream or invite**.                             |
| V-6  | **Patient:** within a few seconds **Join video consultation** appears; click it.                                                                                                                                                     | The call fills the window; both see and hear each other. The provider shows as **"Dr. Chen"**, the patient as **"Anika"**.                                                                                                                                 |
| V-7  | **Provider window,** DevTools → Network → the `video-room` response → copy `jwt`. In Git Bash: `node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url')))" '<jwt>'`                                   | `context.user` has `id`, `name: 'Dr. Chen'`, `moderator: 'true'` — **no email**. `context.features`: `recording`, `livestreaming`, `transcription`, `outbound-call` all `'false'`. `exp` − `nbf` ≈ 90 minutes.                                             |
| V-8  | **Patient window:** reload the page during the call.                                                                                                                                                                                 | The page reloads; **Join video consultation** brings the patient back into the same call.                                                                                                                                                                  |
| V-9  | **Provider:** hang up. The AI scribe recording of the call uploads ("Call ended — AI Scribe finishing up"). **Patient window:** reload.                                                                                              | No join button any more: the patient sees **"Session has ended. Thank you for your participation."**, or **"Your provider is processing the consultation notes…"** once transcription has started. The server refuses new call tokens for this link (410). |
| V-10 | **Provider:** click **Start Video Call** again.                                                                                                                                                                                      | A **new** room (a different name in the `video-room` response); the patient can join it again from the link.                                                                                                                                               |
| V-11 | **Not configured:** stop the backend, comment out the three `JAAS_*` lines, start it again. Provider: **Start Video Call**. Patient: open the join link.                                                                             | Backend log: `[WARN] JAAS_* is not set — video consultations are disabled`. Provider: "Video calls are not set up on this server". Patient: "Video calls are not set up yet. Please contact your clinic." Restore the lines afterwards.                    |

That another provider, another patient or another clinic gets no token is proven by the integration suite (§4); it cannot be checked from a browser console, because the app keeps its sign-in token in memory.

### 6.3 Result sheet

| Check                                                          | Result | Notes |
| -------------------------------------------------------------- | ------ | ----- |
| V-1 – V-4 booking, room, consent                               | ☐      |       |
| V-5 – V-6 both in one call, right names, no recording controls | ☐      |       |
| V-7 token content                                              | ☐      |       |
| V-8 – V-10 reload, end, new room                               | ☐      |       |
| V-11 not configured says so                                    | ☐      |       |

### 6.4 Troubleshooting

| Symptom                                                           | Cause                                                                                           | Fix                                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| "The video call could not start" right after joining              | 8x8 refused the token: wrong `JAAS_KID`, or the key pair does not match the uploaded public key | Copy the Key ID again from the console; regenerate the key pair if the private key was lost. Then **Try again**. |
| "Could not load the video call"                                   | A browser extension or network blocks `8x8.vc`                                                  | Allow `8x8.vc`, then **Try again**.                                                                              |
| Backend log `The JaaS private key is not a valid PEM private key` | The `\n` escapes were lost when pasting into Render                                             | Re-copy with the `awk` line in §5.                                                                               |
| Render deploy log `[FATAL] VIDEO_PHI_POLICY must be …`            | JaaS is set but no BAA decision                                                                 | Set `VIDEO_PHI_POLICY=synthetic-data-only` (test) or `baa-signed`.                                               |
| No camera in the second window                                    | One webcam, two windows                                                                         | Expected; join with audio, or use a second device.                                                               |
| Patient sees "This consultation link has expired"                 | Join links last 24 hours                                                                        | The provider reopens the consultation room; a fresh link is made.                                                |

## 7. Not done here

- **Real 8x8 call** (§6) and the **BAA** (§5) are owner steps.
- **Out of scope, noted:** appointments do not record whether a visit is virtual (any confirmed appointment can have a call); the join link is shared by hand or found on the patient's appointment page — there is no email with the link; the edge worker (`backend/edge/worker.ts`) forwards `JAAS_*` but not `VIDEO_PHI_POLICY` or the AI scribe settings, so it is behind the Render setup.
