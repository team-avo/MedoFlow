# CTO-41 · Live transcription: keep refining — walkthrough and verification

**Date:** 2026-11-20 · **Branch:** `feat/cto-41-live-captions` (from `development` at `9650395`) · **Data:** synthetic only · **Machine:** macOS, Node 22

**Trigger:** CTO-41 in [cto-feedback-tasks.md](../arh-agent-docs/cto-feedback-tasks.md), from the 2026-11-11 CTO demo. Live captions already shipped as B2.9 (PR #20 WS2); two gaps were recorded as known limits in [the WS2 walkthrough](demo-feedback-consult-site-signup-WALKTHROUGH-AND-VERIFICATION.md) §8: the lag had never been measured (the real Groq run reported "your own words appear within ~10 s"), and there were no speaker labels.

**Owner decisions taken while building:**

- **Delay targets are stated per profile**, because first-word delay is bounded below by the segment length and speaker labels need longer segments than pure speed does. One blended "p95 < 4 s" would have been unachievable with labels on. See §1.
- **Speaker labels are provider-native only.** No second AI call per segment — that would fight the latency work.
- **No new vendor, no new telemetry sink.** Same STT provider, same PHI path, ADR 0006 unchanged.

---

## 1. Outcome

### Agreed targets

| Profile               | STT mode                                              | Segment floor | **First-word p95** | **Round-trip p95** |
| --------------------- | ----------------------------------------------------- | ------------- | ------------------ | ------------------ |
| **Speed** (no labels) | `transcriptions` — Whisper: OpenAI, Groq, self-hosted | 2000 ms       | **< 4 s**          | **< 1.5 s**        |
| **Labels**            | `chat-audio` — Vertex Gemini, self-hosted, mock       | 3000 ms       | **< 5.5 s**        | **< 2.5 s**        |

- **First-word delay** = caption _rendered_ − segment recording _started_. The headline: a word spoken at the start of a segment waits for that segment to close before anything uploads, so this is what the provider feels.
- **Round-trip** = caption _rendered_ − segment recording _ended_.
- "Rendered", not "received": measured at React commit, not promise resolution.
- Both always reported **beside the dropped and not-counted counts**, because excluding dropped segments from a percentile is how you report a good p95 on a panel that is missing part of the conversation.

### Acceptance criteria

| AC  | What                                                                                                      | Status         | Evidence                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Caption delay measured and reported (p50 and p95 from speech to caption), with a target agreed in the PR. | ✅ engineering | Measured in the browser by `useLiveTranscription`, reported on screen behind a **Delay** toggle in the caption panel. Percentile definition pinned by `liveCaptionStats.test.ts` (14); plumbing by `useLiveTranscription.test.ts` (16); on-screen readout by `consultControls.test.tsx` and `consultation-room.spec.ts`. Targets above. **Real-provider numbers = owner step (§6).** |
| 2   | Speaker labels (provider vs patient) where the STT provider supports them.                                | ✅             | `services/ai/speakerTurns.ts` + the `chat-audio` prompt; capability flag `liveSpeakerLabels`. Tests: `speakerTurns.test.ts` (17), `aiOpenAiCompatible.test.ts` (+4), `consultationLive.int.test.ts` (+2), `consultation-room.spec.ts` (labelled **and** Whisper paths).                                                                                                              |
| 3   | No storage or logging of captions; `consultationLive.int.test.ts` stays green.                            | ✅             | Every no-storage and no-logging assertion in that file is **byte-identical**; only the two payload-shape assertions gained a `turns` key. A **new sibling test** closes a hole: the original compares against prefixed lines, so a log of a turn _body_ would have passed it.                                                                                                        |

**Universal standard:**

- Backend: typecheck clean, lint zero-warnings, **762 unit tests green** (47 files).
- Frontend: typecheck clean, lint zero-warnings, **675 unit tests green** (57 files).
- No regressions: all pre-existing assertions in the touched test files pass **unchanged** (see §4.2).
- HIPAA per-change gate ticked (§7) — no new vendor, no new PHI path.
- **Still open:** peer review; PR and merge; the real-provider latency run and the Vertex label run (§6).

---

## 2. Problems found before building

1. **`TranscriptionResult` could not grow a field.** `aiOpenAiCompatible.test.ts` asserts it with `assert.deepEqual(res, { text, model })` for both STT modes, so an extra key fails two tests. Labels therefore ride **in the text**, using the `Provider:` / `Patient:` convention the batch pipeline already produces, with a request flag on the input. A welcome consequence: `aiScribeQueue.ts` needed **no change at all**, so the post-consult transcript cannot regress.
2. **A rate limit is not detectable from the response body.** `liveTranscriptRateLimit` sent `{ success: false, error: '<string>' }` — no `code`, and because `error` was a string, `apiErrorOf` fell back to its generic message. Separately, a _vendor_ 429 is remapped to **HTTP 503 `ai_rate_limited`**. The client now branches on HTTP status plus the 503 code, and the limiter's body gained `code` and `message`.
3. **The adapted segment length could not be React state.** `segmentMs` was in the capture effect's dependency array, so adapting it would tear the effect down: `generation` bumps, in-flight results are discarded, the recorder restarts and **`seq` resets to 0**, colliding with lines already on screen and duplicating React keys. It lives in a ref, and a test asserts the sequence numbers never restart.
4. **A naive 2 s floor is an oscillator.** 2 s a segment is 30 requests a minute; Groq's free Whisper tier allows 20. The client's own floor would _cause_ the 429, then back off, then shorten again. `onThrottled` sets a **sticky floor** that is never crossed again for the rest of the recording.
5. **`LIVE_SEGMENT_TIMEOUT_MS` was 20 s** and imported nowhere. Against a 4 s target that is indefensible: it holds one of the in-flight slots for several segments while the queue silently discards audio — lost words with no error shown. Now configurable, default **8 s**.
6. **Coarse fake-timer jumps cannot measure latency.** `advanceTimersByTime` runs every timer in its window synchronously and only then lets promise callbacks run, so one big jump stamps every caption with the clock at the end of the jump. The tests step in 100 ms increments; the exact percentile arithmetic is pinned in the pure module's own test instead.
7. **Whisper cannot diarize at all.** `response_format=verbose_json` returns timestamps, not speakers. So AC2 is genuinely conditional, and the capability flag is the honest way to express it.
8. **Labels are Vertex-only in production.** `egressPolicy.ts` makes `generativelanguage.googleapis.com` a fatal boot error in production, so the `gemini` preset is demo/dev only.

---

## 3. What changed (files)

### 3.1 Backend

| File                                  | Change                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/ai/speakerTurns.ts`     | **New, pure.** `parseSpeakerTurns`, `SPEAKER_TURN_INSTRUCTION`, `Speaker`, `SpeakerTurn`, `MAX_SPEAKER_TURNS`. Dictated prose is deliberately _not_ split: a mid-sentence marker only counts when capitalised exactly, so "I explained it to the patient: she said…" stays one turn.                              |
| `src/services/ai/types.ts`            | `TranscriptionInput.speakerTurns?`; `SpeechToTextProvider.supportsSpeakerTurns()`. `TranscriptionResult` unchanged.                                                                                                                                                                                               |
| `src/services/ai/openaiCompatible.ts` | `supportsSpeakerTurns()` = `mode === 'chat-audio'`. With the flag, the chat-audio system prompt gains the turn instruction; **without it the request body is byte-identical to before**. The Whisper branch ignores the flag, with a comment saying why.                                                          |
| `src/services/ai/mock.ts`             | `supportsSpeakerTurns()` from a new `mockScribeControl.speakerTurns` (default true), plus `latencyMs` for the benchmark. `MOCK_TRANSCRIPT` untouched — its last line has no prefix, which is a free `speaker: null` fixture.                                                                                      |
| `src/services/ai/registry.ts`         | `DisabledStt.supportsSpeakerTurns()`. Capabilities gain `liveSpeakerLabels`, `liveSegmentMs`, `liveSegmentMinMs`, `liveSegmentMaxMs`, all top-level. `LABELLED_SEGMENT_FLOOR_MS` raises the floor to 3 s when labels are on.                                                                                      |
| `src/services/ai/config.ts`           | `liveSegmentMs` / `liveSegmentMinMs` / `liveSegmentMaxMs` / `liveSegmentTimeoutMs`, clamped so `min ≤ start ≤ max` holds for any env value.                                                                                                                                                                       |
| `src/services/consultationService.ts` | `transcribeLiveSegment` returns `{ text, segment, turns }`. **`text` is unchanged** — verbatim, prefixes included. Turns are parsed **only** when the provider claims support, so a transcribed word can never acquire a fabricated speaker. Timeout from config. Still no persistence, no audit row, no logging. |
| `src/middleware/rateLimit.ts`         | Default 60 → **90**/min/user (a 2 s cadence is ~30, the rest is retry headroom); body gains `code: 'rate_limited'` and `message`; stale "~6 s segment" comment fixed.                                                                                                                                             |
| `.env.example`                        | `AI_SCRIBE_LIVE_SEGMENT_MS`, `AI_SCRIBE_LIVE_TIMEOUT_MS`, `LIVE_TRANSCRIPT_RATE_LIMIT_MAX`.                                                                                                                                                                                                                       |

### 3.2 Frontend

| File                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/liveCaptionStats.ts`                                        | **New, pure.** `nowMs` (monotonic), nearest-rank `percentile`, `summarize`, `isMeasurable`. One predicate excludes the short final segment and a backgrounded tab's clamped segment from the first-word figure, and counts the exclusions.                                                                                                                                                                                                                                                                       |
| `lib/liveSegmentPacing.ts`                                       | **New, pure.** `initPacing` / `onRoundTrip` / `onThrottled` / `onDropped`. A 1200–2500 ms dead band is the anti-oscillation guarantee; `onThrottled` sets the sticky floor.                                                                                                                                                                                                                                                                                                                                      |
| `hooks/useLiveTranscription.ts`                                  | Pacing in a **ref** (problem 3). Five marks per segment; `renderedAt` taken in an effect keyed on `lines`, so the figure is "on screen", not "received". `maxInFlight` 2 → 3; `maxQueued` now a **backlog budget** (8 s of audio) rather than a fixed 3. Back-off on 429 / 503 `ai_rate_limited` / `ai_timeout` via `apiErrorOf`. `insertLine` replaces a full re-sort per caption with an append or a binary-search splice. Returns `stats`; `LiveLine` gains `turns`. A plain-string answer is still accepted. |
| `lib/consultationApi.ts`                                         | `liveTranscript` returns `{ text, turns? }` and **normalises turns at the boundary**: an unrecognised speaker becomes unknown rather than being rendered.                                                                                                                                                                                                                                                                                                                                                        |
| `lib/aiScribeApi.ts`                                             | The four new capability fields, all optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `components/consultation/LiveTranscriptPanel.tsx`                | `turnsOf` is the single derivation for both variants, so the panel and the strip can never disagree. Labels render from a local constant, never raw provider output; the timestamp shows once per segment. Delay readout behind a **Delay** toggle, outside the log, `aria-live="off"`, amber past the 4 s target. The strip shows the last two _turns_ and never shows numbers. Footer now says labels are a best guess.                                                                                        |
| `app/dashboard/provider/appointments/[id]/consultation/page.tsx` | Server cadence bounds into the hook; `stats` into **both** panel render sites.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 3.3 Docs and tests

New: `backend/src/tests/speakerTurns.test.ts` (17), `backend/src/tests/integration/liveCaption.bench.int.test.ts` (opt-in), `frontend/tests/unit/liveCaptionStats.test.ts` (14), `frontend/tests/unit/liveSegmentPacing.test.ts` (15), this document.

Changed: `aiOpenAiCompatible.test.ts` (+4), `aiConfig.test.ts` (+5), `consultationLive.int.test.ts` (+3), `aiScribe.int.test.ts` (capabilities), `useLiveTranscription.test.ts` (+10), `consultControls.test.tsx` (+8), `consultation-room.spec.ts` (+1 test, labelled assertions), `e2e/scribeMock.ts`.

---

## 4. Verification: commands and results

### 4.1 Gates

```bash
cd backend  && pnpm run typecheck && pnpm run lint && pnpm test
cd frontend && pnpm run typecheck && pnpm run lint && pnpm test
cd frontend && pnpm exec playwright test e2e/consultation-room.spec.ts
```

| Gate                           | Result                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| Backend typecheck / lint       | clean / zero warnings                                                       |
| Backend unit                   | **762 passed**, 47 files                                                    |
| Frontend typecheck / lint      | clean / zero warnings                                                       |
| Frontend unit                  | **675 passed**, 57 files                                                    |
| Backend integration            | ⬜ not run here (needs the Docker Postgres); run before the PR              |
| Playwright `consultation-room` | **5 passed** (23.5 s), including both new CTO-41 cases                      |
| Playwright `start-scribe`      | **1 passed** — it also mocks the live-transcript route and needed no change |

> One pre-existing failure was hit and is **not** related to this work: the generated Prisma client was stale against `development`'s schema (six `meetLink` type errors in the Google Calendar files). `pnpm run prisma:generate` fixed it.

### 4.2 What was deliberately left untouched

The strongest evidence that captions still render as before is that the pre-existing assertions never moved:

- `consultControls.test.tsx` — all 20 original tests pass unchanged, including `'0:00Provider: How have you been?'`. Lines without `turns` take the old render path exactly.
- `useLiveTranscription.test.ts` — all 6 original tests pass with **no assertion changed**. One gained `adaptive: false`, because that test is about the queue and a fixed cadence keeps its arithmetic exact.
- `consultationLive.int.test.ts` — every gate, authorization, bad-input, failure-mapping, no-storage and no-logging assertion is byte-identical.

### 4.3 Playwright

`e2e/consultation-room.spec.ts` — **5 passed**:

| Test                                                                       | Proves                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| consent granted → recording → live transcript → stop                       | A caption appears, carries a `Provider:` label from the server's turns, the strip under the video shows a labelled line, the **Delay** toggle reveals a `p95` figure with `aria-live="off"`, and segments keep rotating. |
| a provider that cannot label speakers still shows plain captions (**new**) | With `liveSpeakerLabels: false` and no `turns` in the response, captions render with **zero** `caption-speaker` elements — the "exactly as before" guarantee — while the delay readout still works.                      |
| the three pre-existing consent / end-call / idle-call tests                | No regression.                                                                                                                                                                                                           |

Two bugs were caught here and fixed, which is what the e2e was for:

1. **The strip had no space between the label and the text.** `mr-1.5` is a visual margin, so it _looked_ right but the text content read `"Provider:How have you been?"`. The panel used a literal space, so only the strip was wrong. Now both use a literal space, and a component test asserts `'Provider: How have you been?'` so it cannot regress.
2. **A strip assertion became racy at the new cadence.** It checked for caption 0 specifically, but the strip holds two turns and they now turn over in a few seconds rather than twelve. It asserts what the strip always shows instead: a labelled line, and not the placeholder.

`e2e/start-scribe.spec.ts` — **1 passed**, unchanged; it also mocks the live-transcript route and `turns` being optional meant no edit was needed.

> **Note on running these locally:** the Next.js CLI now interrupts `next build` with a security-upgrade recommendation and exits non-zero, which breaks Playwright's `build && serve` chain. Build once by hand (it continues on a retry), then run with `E2E_SKIP_BUILD=1`. The recommendation itself is unrelated to this change and is left for the team to decide on.

### 4.4 The opt-in server-side benchmark

```bash
LIVE_CAPTION_BENCH=1 pnpm exec vitest run --config vitest.integration.config.ts \
  src/tests/integration/liveCaption.bench.int.test.ts
```

Prints a p50/p95 table for the caption endpoint against the mock, and again with a 400 ms provider delay, asserting the server-side overhead is bounded relative to a plain authenticated request. **It cannot measure either headline metric** — both need the browser's clocks — and its header says so.

---

## 5. Design notes

- **Why first-word is the headline.** Round-trip alone would have looked excellent from day one while the provider still waited ~8 s to see their first word, because the dominant term was the 6 s wait for the segment to close. Reporting both, with first-word as the headline, is the version that cannot flatter itself.
- **Why the client adapts and the server sets bounds.** The binding constraint is the vendor's rate limit, which only the server knows about; the evidence of whether it is being hit arrives in the browser. So the server publishes `liveSegmentMs` / `Min` / `Max` and the client moves within them.
- **Why labels are conditional, and advertised as "may appear".** Whisper cannot diarize. A chat-audio model can be asked and may still ignore the instruction, so the UI labels a turn only when that turn names a speaker and never reserves an empty gutter.
- **Why there is no `prompt` carry-over for Whisper.** It would have offset the accuracy cost of shorter segments, and it was rejected: it puts caption text into the request body, where a future body-logging middleware or error dump could reach it. Today the no-logging guarantee holds because of an architectural property — the text is a local that never enters `req.body` — and this would have reduced it to passing by accident. Whisper's `prompt` is also a decoder condition, so on the near-silence a 2–3 s chunk often contains it causes prompt echo, i.e. redisplaying the previous line as if newly spoken.
- **Why no telemetry.** `trackUsage`'s only numeric slot is `count` (integer 0–10 000) and per-caption emission would be 20–30 events a minute per consult. The on-screen readout is reproducible by any reviewer against their own provider, which makes the claim auditable later; `telemetry-allowlist.json` stays empty.

---

## 6. What you must do manually

1. **Record the real numbers** (this is what makes AC1 complete). Use a **production build** — `next build && next start` — because StrictMode double-invokes the capture effect in dev, discarding the first segment.
   - Run once on **Groq / Whisper** (`AI_SCRIBE_STT_PRESET=groq`): the Speed profile. Note p50/p95 of both figures, plus dropped and not-counted.
   - Run once on **Vertex `chat-audio`**: the Labels profile, and confirm model-produced labels.
   - Paste both into the table below.
2. **Force the free-tier rate limit** on Groq (talk continuously for a few minutes) and confirm the client backs off **and stays backed off** rather than oscillating.
3. **Confirm the Whisper path** shows unlabelled captions exactly as before, and that `liveSpeakerLabels` is `false` in `GET /ai-scribe/capabilities`.
4. **Set env on Render** if the defaults are not wanted: `AI_SCRIBE_LIVE_SEGMENT_MS`, `AI_SCRIBE_LIVE_TIMEOUT_MS`, `LIVE_TRANSCRIPT_RATE_LIMIT_MAX`.
5. **Run the backend integration suite** (needs the Docker Postgres) before the PR.

| Profile | Provider / model              | N   | Dropped | First-word p50 / p95 | Round-trip p50 / p95 | Target met |
| ------- | ----------------------------- | --- | ------- | -------------------- | -------------------- | ---------- |
| Speed   | Groq `whisper-large-v3-turbo` |     |         |                      |                      |            |
| Labels  | Vertex `gemini-2.5-flash`     |     |         |                      |                      |            |

---

## 7. HIPAA / review checklist

- **No new vendor and no new PHI path.** The same speech-to-text provider as the final transcript, so ADR 0006's egress and BAA gate applies unchanged. **No BAA register change.**
- **Captions still never stored and never logged.** No persistence, no audit row, no `console` in the caption path. The original no-logging test is untouched and a **new** one closes the prefix-stripped hole.
- **Turns are PHI** and are treated as such: they exist only in the response and the provider's browser memory.
- **No unvalidated model output reaches the DOM**: speakers are normalised at the API boundary and rendered from a local label constant.
- **Timings are not PHI and are not sent anywhere.** They live in browser memory for the on-screen readout; no telemetry sink was added and the allow-list stays empty.
- **Minimum necessary**: the capabilities payload still carries no hosts, URLs or keys — the existing `/http|host|key/i` guard passes and now also covers the new field names.

---

## 8. Known limits

- **Microphone-only capture is unchanged.** In a video call the patient is heard through the provider's speakers; with headphones the patient is not captured at all, so labels will show only the provider. Pre-existing, and the reason the footer says labels are a best guess.
- **Per-segment labelling has no cross-segment speaker identity.** Each 3 s segment is labelled from scratch, so the same continuous utterance can come back attributed differently across segments. This is why the floor rises to 3 s when labels are on, and why shorter segments make labels _worse_ at exactly the moment they make captions faster.
- **Shorter segments cut more words at boundaries.** Caption word-accuracy gets slightly worse as latency improves. Segment overlap is the follow-up lever; no `prompt` carry-over (§5).
- **The vendor's rate limit is per project, not per user.** Our limiter is per user, but Vertex/Gemini RPM is shared across every clinic on the deployment, so several concurrent consults could back off together. Not addressed here.
- **A model refusal becomes a caption.** Non-empty unprefixed text ("I can't transcribe this") displays as one unlabelled caption. Pre-existing; no content heuristic was added, since any filter is itself a false-positive generator.
- **Live captions still run in the consultation room only.** The separate scribe console uses a different session type and would need its own endpoint.
- **A separate follow-up is filed:** the `chat-audio` branch ignores `input.language`. It is a real bug, but fixing it mutates the _batch_ Gemini prompt, so it does not belong in this PR.

---

## 9. Manual local testing guide

Two terminals from the repo root. API on 4312, frontend on 3010.

**Terminal 1 — API with the mock AI (labels on, no keys needed):**

```bash
cd backend
AI_SCRIBE_LLM_PROVIDER=mock AI_SCRIBE_STT_PROVIDER=mock \
AI_SCRIBE_LIVE_SEGMENT_MS=3000 PORT=4312 pnpm dev
```

**Terminal 2 — frontend, production build (see §6 for why):**

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:4312 pnpm build
NEXT_PUBLIC_API_URL=http://127.0.0.1:4312 pnpm start -p 3010
```

| #    | Step                                                                                                   | Expect                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| L-1  | Sign in as the demo provider, open an appointment's consultation page, grant consent, start recording. | Captions appear within a few seconds.                                                                           |
| L-2  | Look at a caption line.                                                                                | A teal `Provider:` or grey `Patient:` label, one timestamp per segment, no empty gutter.                        |
| L-3  | Click **Delay** in the panel header.                                                                   | `Delay p50 … · p95 … · round-trip p50 … · p95 … · N captions · segment …`. Amber if first-word p95 is over 4 s. |
| L-4  | Keep talking for a minute or two.                                                                      | `segment` falls toward the floor (3000 ms with labels on) and the delay figures drop with it.                   |
| L-5  | Switch to another browser tab for a minute, then come back.                                            | The long clamped segment is **not counted** (the `not counted` figure rises) and p95 is not poisoned.           |
| L-6  | Stop recording, then reload the page.                                                                  | The panel is empty: captions live only in browser memory.                                                       |
| L-7  | Restart the API with `AI_SCRIBE_STT_PRESET=groq` and a real key, then repeat L-1.                      | Captions show **no** labels, `liveSpeakerLabels` is `false`, and the delay readout still works.                 |
| L-8  | With Groq's free key, talk continuously for several minutes.                                           | On a 429 the panel says "Captions are catching up…", `segment` goes to the ceiling and **stays** there.         |
| L-9  | `psql` the session row after a recording.                                                              | `transcriptText` and `aiScribeSessionId` are `NULL`.                                                            |
| L-10 | Grep the API's stdout for any caption wording.                                                         | Nothing — neither the prefixed line nor the turn body.                                                          |
