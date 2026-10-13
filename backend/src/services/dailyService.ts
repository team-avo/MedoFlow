/**
 * Daily.co Video Room Service
 *
 * Creates and manages Daily.co rooms for embedded video consultations.
 * Free tier: 10,000 participant-minutes/month.
 */

const DAILY_API_KEY = process.env.DAILY_API_KEY || ''
const DAILY_API_URL = 'https://api.daily.co/v1'

interface DailyRoom {
  url: string
  name: string
  exp?: number
}

/**
 * Create a private Daily.co room for a consultation.
 * If the room already exists but is expired, it deletes and recreates it.
 * Room auto-expires after 24 hours.
 */
export async function createRoom(appointmentId: string): Promise<DailyRoom> {
  if (!DAILY_API_KEY) {
    throw new Error('DAILY_API_KEY is not configured. Set it in environment variables.')
  }

  // Sanitize room name (Daily allows alphanumeric + hyphens, max 41 chars)
  const roomName = `mf-${appointmentId}`.slice(0, 41).replace(/[^a-zA-Z0-9-]/g, '-')

  // Check if room already exists
  const existing = await getRoom(roomName)
  if (existing) {
    // If it's expired or about to expire (within 5 minutes), delete and recreate
    const now = Math.floor(Date.now() / 1000)
    if (existing.exp && existing.exp < now + 300) {
      console.warn(`Daily room ${roomName} expired or expiring soon, recreating...`)
      await deleteRoom(roomName)
    } else {
      return existing
    }
  }

  const expiry = Math.floor(Date.now() / 1000) + 86400 // 24hr expiry

  const response = await fetch(`${DAILY_API_URL}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: {
        exp: expiry,
        enable_chat: true,
        enable_screenshare: true,
        max_participants: 4,
        enable_knocking: false,
        start_audio_off: false,
        start_video_off: false,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    // If room already exists (race condition), fetch it
    if (response.status === 400 && errorText.includes('already exists')) {
      const existingRoom = await getRoom(roomName)
      if (existingRoom) return existingRoom
    }
    throw new Error(`Daily.co create room failed (${response.status}): ${errorText}`)
  }

  const room = (await response.json()) as { url: string; name: string }
  return { url: room.url, name: room.name }
}

/**
 * Get an existing room by name, including its expiry.
 */
async function getRoom(roomName: string): Promise<DailyRoom | null> {
  const response = await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
  })
  if (!response.ok) return null
  const room = (await response.json()) as { url: string; name: string; config?: { exp?: number } }
  return { url: room.url, name: room.name, exp: room.config?.exp }
}

/**
 * Create a meeting token for a participant.
 * Owners (providers) can record; guests (patients) cannot.
 * Token valid for 24 hours.
 */
export async function createMeetingToken(
  roomName: string,
  isOwner: boolean,
  userName?: string
): Promise<string> {
  if (!DAILY_API_KEY) {
    throw new Error('DAILY_API_KEY is not configured.')
  }

  const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        is_owner: isOwner,
        exp: Math.floor(Date.now() / 1000) + 86400, // 24hr expiry
        user_name: userName || (isOwner ? 'Provider' : 'Patient'),
        enable_recording: isOwner ? 'local' : undefined,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Daily.co create token failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as { token: string }
  return data.token
}

/**
 * Delete a room after the consultation ends.
 */
export async function deleteRoom(roomName: string): Promise<void> {
  if (!DAILY_API_KEY) return

  try {
    await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    })
  } catch {
    // Non-critical — room will auto-expire anyway
    console.warn(`Failed to delete Daily room: ${roomName}`)
  }
}

/**
 * Check if Daily.co API is reachable.
 */
export async function checkHealth(): Promise<boolean> {
  if (!DAILY_API_KEY) return false
  try {
    const response = await fetch(`${DAILY_API_URL}/rooms?limit=1`, {
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
