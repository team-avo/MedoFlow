/**
 * Speaker turns for live captions (CTO-41).
 *
 * Live captions ask a `chat-audio` speech-to-text provider to prefix each turn
 * with `Provider:` / `Patient:`, the same convention the batch pipeline's
 * labelling pass produces (`services/scribeAnalysis.ts`), and this module
 * turns that text into structured turns for the provider's screen.
 *
 * Deliberately pure and dependency-free: no Prisma, no config, no logging.
 * Nothing here may log its input or output: a caption is PHI.
 *
 * Whisper (`transcriptions` mode) cannot diarize, so the live path only parses
 * when the provider claims support (`SpeechToTextProvider.supportsSpeakerTurns`).
 * That way a transcribed word can never acquire a fabricated label.
 */

export type Speaker = 'PROVIDER' | 'PATIENT'

export interface SpeakerTurn {
  /** null when the speaker is unknown: no prefix, or a continued sentence. */
  speaker: Speaker | null
  text: string
}

/**
 * Upper bound on labelled turns in one segment, so a model that spews cannot
 * grow the response. Markers past it stay as literal text in the last turn.
 * A result therefore holds at most this many labelled turns, plus an optional
 * leading unlabelled one.
 */
export const MAX_SPEAKER_TURNS = 20

/** Appended to the transcription prompt when the provider is asked for turns. */
export const SPEAKER_TURN_INSTRUCTION = [
  'Write the transcript as a dialogue, one speaker turn per line, prefixing each line with',
  'exactly "Provider:" or "Patient:". The clinician is the Provider.',
  "If you cannot tell who is speaking, or the audio continues the previous speaker's sentence,",
  'write the words with no prefix. Never guess a speaker.',
  'Keep the exact words. Output only the transcript.',
].join(' ')

const MARKER = /(provider|patient)[ \t]*:/gi
/** Start of a line, indentation allowed: models indent their dialogue. */
const AT_LINE_START = /(?:^|\n)[ \t]*$/
const AFTER_SENTENCE = /[.!?…]["'”’)\]]?[ \t]+$/
const AFTER_SPACE = /[ \t]+$/

const speakerOf = (word: string): Speaker =>
  word.toLowerCase() === 'provider' ? 'PROVIDER' : 'PATIENT'

/**
 * Whether a `Provider:` / `Patient:` match really starts a turn.
 *
 * Mid-line after plain whitespace, only an exactly capitalised marker counts.
 * That is what keeps dictated prose intact: "…and the patient: she said it
 * started Tuesday" must not split, while "Any pain? Patient: a little" must.
 */
function isTurnBoundary(before: string, word: string): boolean {
  if (before.length === 0) return true
  if (AT_LINE_START.test(before)) return true
  if (AFTER_SENTENCE.test(before)) return true
  return AFTER_SPACE.test(before) && (word === 'Provider' || word === 'Patient')
}

/**
 * Splits transcript text into speaker turns. Text with no usable prefix comes
 * back as a single turn with `speaker: null`, so callers always get the same
 * shape. Empty input gives an empty array.
 */
export function parseSpeakerTurns(raw: string): SpeakerTurn[] {
  const text = raw.replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const marks: { at: number; bodyFrom: number; speaker: Speaker }[] = []
  MARKER.lastIndex = 0
  for (let m = MARKER.exec(text); m; m = MARKER.exec(text)) {
    if (marks.length >= MAX_SPEAKER_TURNS) break
    if (isTurnBoundary(text.slice(0, m.index), m[1]!)) {
      marks.push({
        at: m.index,
        bodyFrom: m.index + m[0].length,
        speaker: speakerOf(m[1]!),
      })
    }
  }

  const turns: SpeakerTurn[] = []
  const push = (speaker: Speaker | null, body: string): void => {
    const trimmed = body.trim()
    if (trimmed) turns.push({ speaker, text: trimmed })
  }

  if (marks.length === 0) {
    push(null, text)
    return turns
  }

  // Anything before the first marker continues an earlier turn.
  push(null, text.slice(0, marks[0]!.at))
  marks.forEach((mark, i) => {
    push(mark.speaker, text.slice(mark.bodyFrom, marks[i + 1]?.at ?? text.length))
  })
  return turns
}
