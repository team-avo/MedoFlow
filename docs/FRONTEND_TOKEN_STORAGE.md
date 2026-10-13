# Decision: where the web app keeps its tokens (F0.2.3)

**Status:** Accepted · 2026-10-14 · **Owner:** frontend lead · **Pairs with:** B0.2.1 (sessions), B0.2.3 (idle timeout), B0.6.9 (custom domains)

## Decision

| Token                                            | Lifetime                                 | Where it lives                                     | Readable by page script?                                                                                      |
| ------------------------------------------------ | ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Access token (JWT, carries the session id `sid`) | 15 min                                   | **JavaScript memory only** (`frontend/lib/api.ts`) | Yes, but only while the tab is open; never written to `localStorage`, `sessionStorage`, IndexedDB or a cookie |
| Refresh token (opaque, rotating)                 | 7 days, revoked on logout / idle / reuse | **HttpOnly cookie** set by the API                 | **No**                                                                                                        |

A page reload restores the session with one `POST /auth/refresh-token`. The cookie is sent automatically, and the API returns a new access token and rotates the refresh token.

## Why

- **Before this change**, the access token sat in `localStorage` (`medoflow_access_token`). Any injected script, such as a compromised dependency or an XSS, could copy it and use it from anywhere. In memory it disappears when the tab closes, and an attacker who runs script in the page still cannot read the refresh cookie.
- **Server-side sessions (B0.2.1)** mean logout, idle timeout and deactivation revoke both tokens at once. A stolen access token is good for 15 minutes at most and dies with its session.
- **Leftover copies are deleted.** On load, `lib/api.ts` removes any old `medoflow_access_token` value from `localStorage`.

## Refresh-cookie attributes

| Setting (`REFRESH_COOKIE_SAMESITE`) | When                                                                                                              | Cookie                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `none` (production default)         | App and API are on **different sites** (`*.workers.dev` and `*.onrender.com` are both on the Public Suffix List). | `HttpOnly; Secure; SameSite=None; Partitioned` |
| `strict`                            | Once app and API share a registrable domain, e.g. `app.medoflow.com` / `api.medoflow.com` (B0.6.9)                | `HttpOnly; Secure; SameSite=Strict`            |
| `lax` (development default)         | localhost on different ports                                                                                      | `HttpOnly; SameSite=Lax`                       |

**This fixes a production bug.** Before F0.2.3 the production cookie was `SameSite=Strict` across two different sites. Browsers therefore never sent it with the app's requests, so every refresh failed, and users were signed out when the 15-minute access token expired.

**CSRF while `SameSite=None`.**

- `POST /auth/refresh-token` and `POST /auth/logout` require the `X-MedoFlow-Client` header and return 403 `client_header_required` without it.
- A cross-site form or image request cannot set that header. A cross-site `fetch` that sets it triggers a CORS preflight, which only `CORS_ORIGIN` origins pass.
- The refresh response body (the new access token) is unreadable to any other origin.
- `Partitioned` (CHIPS) keeps the cookie under the app's top-level site only.

## Multiple tabs

The refresh token rotates, and presenting an already-used one revokes every session (reuse detection). So:

- Refreshes are **single-flight** within a tab.
- Refreshes are **serialised across tabs** with the Web Locks API (`navigator.locks`), so a second tab presents the newly rotated cookie.
- **Sign-out in one tab signs out all tabs** (`BroadcastChannel('medoflow-auth')`).
- **Activity in any tab keeps the others signed in.** It is shared via a `localStorage` timestamp, which holds no PHI.

## Verification

| Check                                                    | Where                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Refresh cookie is HttpOnly                               | `backend/src/tests/integration/authSafeguards.int.test.ts`: "the refresh cookie is HttpOnly"                   |
| Cookie attributes per environment                        | `backend/src/tests/b0Foundation.test.ts`: "F0.2.3 refresh-cookie policy"                                       |
| Refresh/logout refuse requests without the client header | `authSafeguards.int.test.ts`: "refresh and logout refuse a request without the client header"                  |
| Access token never in Web Storage                        | `frontend/tests/unit/apiClient.test.ts` (runtime) and `frontend/tests/unit/staticGuards.test.ts` (source scan) |
| A reload restores the session from the cookie            | `frontend/tests/components/authProvider.test.tsx`: "session restore"                                           |
| Manual check                                             | DevTools › Application › Local Storage has no token; Cookies › `refreshToken` shows HttpOnly ✓                 |
