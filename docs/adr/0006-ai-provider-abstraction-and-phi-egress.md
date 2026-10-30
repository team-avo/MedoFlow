# ADR 0006 — AI scribe: pluggable providers and the PHI egress gate (B2.1, B2.7)

**Status:** Accepted by engineering, implemented · 2026-10-29 · **Deciders:** CTO (Khush), Security Officer · **Signature:** pending (below) · **Related:** [ADR 0001](0001-phi-hosting.md), [ADR 0002](0002-field-level-encryption.md), [ADR 0003](0003-prescription-to-cart.md), PRD §9.1–9.2, HIPAA checklist §1.2

## Context

The AI scribe turns a consultation recording into a draft note. Audio and transcripts are PHI. Before this change, the scribe was hard-wired to a local whisper.cpp binary (`nodejs-whisper`) and a local Ollama, with settings read at import time, no timeouts and no interface. The vendor question is still open: PRD §9.1 shortlists Nabla, Suki and AWS HealthScribe, and §9.2 lists the BAA-capable LLM APIs. MedoFlow must therefore be able to move from development models to a BAA-covered vendor, or to a self-hosted model, **without code changes**. It must also be impossible to send real PHI to a vendor without a BAA by mistake.

## Decision

### 1. Two interfaces, chosen by configuration

- The scribe pipeline (`queues/aiScribeQueue.ts`, `services/scribeAnalysis.ts`) talks only to two interfaces in `services/ai/types.ts`:
  - `SpeechToTextProvider.transcribe(audio, mimeType)`;
  - `LlmProvider.complete({ system, user, jsonSchema? })`.
- `services/ai/registry.ts` builds them once from `AI_SCRIBE_*` environment variables. A vendor switch is an env change and a restart.
- Speech-to-text and the LLM are configured **independently**. They can come from different vendors, e.g. OpenAI transcription with Gemini drafting.

### 2. One OpenAI-compatible adapter, plus presets

- `services/ai/openaiCompatible.ts` uses plain `fetch`, with no SDK. It covers every vendor that exposes the OpenAI wire format.
- Presets fill in the base URL, default model, auth style and JSON mode:

| Preset           | Base URL                                                                                    | Auth                                                    | Notes                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `openai`         | `https://api.openai.com/v1`                                                                 | bearer                                                  | `json_schema` output; `whisper-1` STT                                |
| `azure`          | `https://<resource>.openai.azure.com/openai/v1`                                             | `api-key` header                                        | model = deployment name                                              |
| `groq`           | `https://api.groq.com/openai/v1`                                                            | bearer                                                  | `json_object`; `whisper-large-v3-turbo`                              |
| `gemini`         | `https://generativelanguage.googleapis.com/v1beta/openai`                                   | bearer                                                  | Developer API: **synthetic data only** (§4)                          |
| `vertex-gemini`  | `https://<loc>-aiplatform.googleapis.com/v1/projects/<p>/locations/<loc>/endpoints/openapi` | Google access token (service account / metadata server) | BAA-eligible Gemini                                                  |
| `ollama`         | `http://127.0.0.1:11434/v1`                                                                 | none                                                    | self-hosted LLM                                                      |
| `whisper-server` | `http://127.0.0.1:8000/v1`                                                                  | none                                                    | any self-hosted OpenAI-compatible whisper (faster-whisper, speaches) |
| `custom`         | explicit                                                                                    | explicit                                                | vLLM, LM Studio, OpenRouter, gateways                                |

- Speech-to-text has two modes:
  - `transcriptions`: `POST /audio/transcriptions`, multipart.
  - `chat-audio`: base64 audio in a chat message, which is how Gemini's OpenAI endpoint takes audio. Gemini documents WAV; whether it accepts browser webm/opus is verified with a key in the walkthrough. If not, Gemini drafts and another preset transcribes.
- `AI_SCRIBE_*_PROVIDER=mock` is a deterministic in-process provider for CI, integration tests and the live front-end ↔ back-end run. It is refused in production.
- An end-to-end scribe vendor (audio in, note and orders out: Nabla, Suki, HealthScribe) will be a third adapter shape behind the same pipeline once a vendor is chosen. It is not built yet.

### 3. Failure is a safe code, never provider text

- Every provider failure becomes an `AiError` with a fixed, PHI-free message (`services/ai/errors.ts`): `ai_unavailable`, `ai_timeout`, `ai_rate_limited`, `ai_auth`, `ai_rejected`, `ai_bad_output` or `ai_not_configured`.
- Provider error bodies are never read: they can echo the prompt.
- These codes and texts are the only things stored in `AIScribeSession.errorMessage`, logged, or kept by BullMQ as a failure reason.
- Retryable codes are retried by BullMQ. A session shows `FAILED` only once no retry is left.

### 4. The PHI egress gate (production)

`services/ai/egressPolicy.ts` runs at boot through `envValidation.ts`. In production the app **refuses to start** when:

- the STT or LLM host is external and not listed in `AI_SCRIBE_BAA_HOSTS`. That list mirrors the BAA register (HIPAA checklist §1.2), so a host is added only once its BAA and zero-retention are confirmed in writing;
- the host is `generativelanguage.googleapis.com`, the Gemini Developer API, which cannot be covered by a BAA (PRD §9.2). This holds even when the host is listed. Use `vertex-gemini` instead;
- an external host is reached over plain `http`;
- the provider is `mock`.

Self-hosted endpoints (loopback, RFC 1918, `.internal`, single-label docker names) are allowed, since no PHI leaves our network. Plain http to a non-loopback private host is a warning: put it behind TLS.

**One explicit opt-out: synthetic-data environments.**

- The hosted demo runs `NODE_ENV=production` on synthetic data only, while the [PHI gate](../PHI_GATE.md) is closed.
- There, `AI_SCRIBE_PHI_POLICY=synthetic-data-only` (that exact phrase) downgrades the two BAA checks to a boot warning that names the vendor. Those are the missing `AI_SCRIBE_BAA_HOSTS` entry and the Gemini Developer API.
- Plain http and `mock` stay fatal.
- Opening the PHI gate requires removing this variable. That step is added to the gate's checklist.

### 5. What the model receives and returns

- **Minimum necessary input:** the transcript, the provider's template and tone, and, for continuity (FR-7), a digest of the patient's last 3 approved visits in the same clinic: dates, assessment and plan, truncated, with no names or contact details.
- **Validated output:** one call returns JSON that must match a Zod schema (SOAP note, timeline, orders with name, dose and quantity, a "since last visit" line, and a patient summary). Invalid output gets one repair pass on the same provider, then fails as `ai_bad_output`.
- **Human in the loop:** approval makes **no** AI call. It records exactly the text the provider reviewed.
- **Provenance:** each session stores `aiProvider` (`kind:preset@host`), `aiModel` and `sttModel`, so every note a faulty model touched can be found. These fields never carry keys or URLs.

### 6. Removed

- `aiProviderService.ts`, `openaiService.ts` (misnamed; it ran Ollama), `test_ollama.ts`.
- The `nodejs-whisper` and unused `openai` dependencies.
- The `nodejs-whisper` audit exception, which was waiting for B2.1.

The website builder's AI copy (Component 8) now uses the same configured LLM. Its prompts hold business facts only.

## Consequences

- **Switching vendors**
  - Self-hosted: `AI_SCRIBE_LLM_PRESET=ollama` + `AI_SCRIBE_STT_PRESET=whisper-server`.
  - Production: a BAA-covered preset + `AI_SCRIBE_BAA_HOSTS`.
- **Configuration needed:** without `AI_SCRIBE_*` the scribe is unavailable. The UI says so, and manual notes and the demo conversation still work.
- **Self-hosting:** the self-hosted whisper path now needs a whisper server instead of an in-process binary. That trade removes the dependency vulnerability and the plaintext temp files in the API process.
- **Accepted risk:** a database owner can still bypass app-level controls. The immutability trigger on note versions (migration `20261029000000`) and the audit-log trigger narrow that, but cannot replace access control on the database itself.

## Owner actions

1. Choose the production scribe/LLM vendor. Sign its BAA, and get zero-retention confirmed in writing (B2.7).
2. Add the vendor to the BAA register and its host to `AI_SCRIBE_BAA_HOSTS`.
3. Set `AI_SCRIBE_*` on Render. Set `AI_SCRIBE_DEMO_ENABLED=true` only for the synthetic-data demo.

## Signature

| Role             | Name | Date | Decision |
| ---------------- | ---- | ---- | -------- |
| CTO              |      |      |          |
| Security Officer |      |      |          |
