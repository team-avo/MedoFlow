/**
 * The only place the frontend may write to the browser console (F0.3.2).
 * ESLint `no-console` is an error everywhere else.
 *
 * Callers pass a fixed context string plus the caught value; only a scrubbed
 * summary of the error (name, HTTP status, API code, masked message) is
 * printed — never request/response bodies, user objects or free text.
 */
import { describeError, scrubText } from './phiScrub'

export const clientLog = {
  error(context: string, err?: unknown) {
    console.error(`[medoflow] ${scrubText(context)}`, describeError(err))
  },
  warn(context: string, err?: unknown) {
    console.warn(`[medoflow] ${scrubText(context)}`, describeError(err))
  },
}
