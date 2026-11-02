# ADR 0007 — Video consultations on 8x8 Jitsi as a Service (JaaS)

**Status:** Accepted by engineering, implemented · 2026-11-02 · **Deciders:** CTO (Khush), Security Officer · **Signature:** pending (below) · **Related:** [ADR 0001](0001-phi-hosting.md), [ADR 0006](0006-ai-provider-abstraction-and-phi-egress.md), HIPAA checklist §1.2

## Context

Doctor and patient meet by video inside MedoFlow: the provider's consultation room and the patient's join link both embed the call. The call is PHI (live audio and video of a patient). The code already embedded 8x8 JaaS through its iframe API, but:

- the call token turned on 8x8 **recording, livestreaming and transcription**, and carried the patient's full name and **email**;
- any provider or patient of the clinic who knew a session id got a token, and any provider became moderator;
- the patient's join link kept issuing tokens after it expired or the call ended;
- without configuration it silently fell back to `meet.jit.si`, which cannot be embedded any more;
- nothing stopped a production deploy from sending real patients' calls to 8x8 without a BAA;
- an unused Daily.co integration was still in the code.

## Decision

1. **One vendor: 8x8 JaaS (`8x8.vc`).** The browser loads `https://8x8.vc/external_api.js`; media flows between the browsers and 8x8. Nothing else is involved. Daily.co is removed.
2. **Tokens are signed by our backend per user and room** (RS256, `kid` header, `aud: "jitsi"`, `iss: "chat"`, `sub: <AppID>`, `room: <room suffix>`), valid for **90 minutes** and re-minted on every request. 8x8 holds only the public key.
3. **Minimum necessary in the token:** an opaque user id and a display name (`Dr. <surname>` for the provider, the patient's first name), no email.
4. **Nothing stored at 8x8:** the token sets `recording`, `livestreaming`, `transcription` and `outbound-call` to `false`, and the embedded toolbar offers none of them. The AI scribe records the provider's microphone in MedoFlow instead, under the scribe's own consent rules.
5. **Who gets a token:** only the session's own provider (moderator; only they can open the room) and the session's own patient — signed in, or holding a valid join link. Everyone else gets 404. The link answers 410 once it has expired (24 h) or the call has ended; a new call gets a new room.
6. **Audit:** `VIDEO_ROOM_CREATED` and `VIDEO_TOKEN_ISSUED` (moderator flag, path) rows, ids only.
7. **Configuration and the production gate:** `JAAS_APP_ID`, `JAAS_KID`, `JAAS_PRIVATE_KEY` (or `JAAS_PRIVATE_KEY_PATH`). Unset → video disabled (503 `video_not_configured`, the UI says so). Partial or unparseable config is fatal in production. With JaaS configured, production also requires `VIDEO_PHI_POLICY`:
   - `baa-signed` — 8x8's BAA is signed for this account;
   - `synthetic-data-only` — a test environment with synthetic patients only.

## Consequences

- Turning video on is three environment variables (plus the policy in production); no code.
- Until the BAA is signed, hosted environments run with `synthetic-data-only` and must not hold real patients.
- **End-to-end encryption is not enabled.** Calls use standard DTLS-SRTP transport encryption; 8x8's media servers could technically see the streams, which the BAA covers. 8x8's HIPAA guide asks for this decision to be documented; revisit if a clinic requires E2EE.
- The free JaaS tier covers 25 monthly active users; production needs a paid tier sized to the clinic count.

## Alternatives considered

- **Self-hosted Jitsi** (own server with JWT auth): no third party sees the media, but we would run TURN/JVB infrastructure. The token code works unchanged against a self-hosted Jitsi with RS256/JWT auth, so this stays open.
- **Daily.co:** integration existed but was never wired in; removed to keep one vendor in the BAA register.
- **Public meet.jit.si:** no longer embeddable and no BAA.

## Signatures

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| CTO              |      |      |           |
| Security Officer |      |      |           |
