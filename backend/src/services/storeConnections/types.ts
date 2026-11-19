import type { FetchPage, StoreProvider } from '../catalogImport/types'

/** What a connector needs to call the store. Secrets are already decrypted. */
export interface ConnectionCredentials {
  id: string
  clinicId: string
  provider: StoreProvider
  externalAccountId: string
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
  apiKeyId: string | null
}

/** New or refreshed credentials a connector hands back to be stored. */
export interface TokenUpdate {
  accessToken: string
  refreshToken?: string | null
  tokenExpiresAt?: Date | null
}

export interface StoreConnector {
  provider: StoreProvider
  label: string
  /** How the owner connects: an OAuth redirect, or pasting a key. */
  connectKind: 'oauth' | 'key' | 'oauth_or_key'
  /** Platform credentials present (OAuth apps need a client id and secret). */
  isConfigured(): boolean
  /**
   * One page of products. `onTokenRefresh` is called when the connector had
   * to refresh an expiring token, so the caller can store the new one.
   */
  fetchPage(
    conn: ConnectionCredentials,
    cursor: string | undefined,
    onTokenRefresh: (t: TokenUpdate) => Promise<void>
  ): Promise<FetchPage>
  /** Best effort: tell the provider to drop our access. */
  revoke?(conn: ConnectionCredentials): Promise<void>
}

/** The browser's return address after an OAuth consent screen. */
export const callbackPath = (provider: StoreProvider) =>
  `/dashboard/settings/integrations/callback/${provider.toLowerCase()}`

export const frontendOrigin = (env: NodeJS.ProcessEnv = process.env) =>
  (env.FRONTEND_URL || env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '')

export const backendOrigin = (env: NodeJS.ProcessEnv = process.env) =>
  (env.BACKEND_URL || `http://localhost:${env.PORT || 3001}`).replace(/\/+$/, '')
