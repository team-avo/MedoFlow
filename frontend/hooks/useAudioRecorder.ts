'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

export interface UseAudioRecorderReturn {
  isRecording: boolean
  isPaused: boolean
  duration: number // seconds
  error: string | null
  audioBlob: Blob | null
  /** The live microphone stream while recording (live captions tap it). */
  stream: MediaStream | null
  startRecording: () => Promise<void>
  stopRecording: () => void
  cancelRecording: () => void
  resetRecording: () => void
}

/**
 * React hook wrapping browser MediaRecorder API for consultation audio capture.
 *
 * Records the provider's microphone only: no screen-share required.
 *
 * Why microphone-only is the right approach here:
 *   - The Jitsi iframe runs on a cross-origin domain (8x8.vc), so the only
 *     browser-native way to capture its audio is via getDisplayMedia + "Share
 *     tab audio". That flow requires the provider to:
 *       1. Click a system picker dialog
 *       2. Select the correct tab
 *       3. Remember to tick "Share tab audio"
 *     All of this breaks automatic recording on `videoConferenceJoined`.
 *
 *   - The standard industry approach (Otter.ai, Fireflies, Grain, etc.) is to
 *     capture only the microphone. The patient's voice reaches the provider
 *     through speakers / headset side-tone, so it is picked up by the mic.
 *     With echoCancellation disabled the bleed is even clearer.
 *
 *   - Result: recording starts silently and automatically when the provider
 *     joins the Jitsi call: no manual steps, no popup, no user training.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const discardOnStopRef = useRef(false)

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const getMimeType = (): string => {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    for (const mime of preferred) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
        return mime
      }
    }
    return 'audio/webm' // fallback
  }

  const startRecording = useCallback(async () => {
    const fail = (message: string): never => {
      setError(message)
      throw new Error(message)
    }

    setError(null)
    setAudioBlob(null)
    chunksRef.current = []
    discardOnStopRef.current = false

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      fail('Microphone recording is not supported in this browser')
    }

    try {
      // Microphone only: captures provider voice + patient voice via speakers.
      // echoCancellation is intentionally OFF so the patient's audio (playing
      // through speakers) is not subtracted from the recording.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      })

      streamRef.current = micStream
      setStream(micStream)

      const mimeType = getMimeType()
      const recorder = new MediaRecorder(micStream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (discardOnStopRef.current) {
          setAudioBlob(null)
          setDuration(0)
          discardOnStopRef.current = false
        } else {
          setAudioBlob(blob)
        }
        setIsRecording(false)
        setIsPaused(false)

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        setStream(null)

        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      }

      recorder.onerror = () => {
        setError('Recording error occurred')
        setIsRecording(false)
      }

      recorder.start(1000)
      setIsRecording(true)
      startTimeRef.current = Date.now()

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          fail('Microphone access denied. Please allow microphone access in your browser settings.')
        } else if (err.name === 'NotFoundError') {
          fail('No microphone found. Please connect a microphone and try again.')
        } else {
          fail(`Recording error: ${err.message}`)
        }
      } else {
        if (err instanceof Error) throw err
        fail('Failed to start recording')
      }
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const cancelRecording = useCallback(() => {
    discardOnStopRef.current = true
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      return
    }
    setAudioBlob(null)
    setDuration(0)
  }, [])

  const resetRecording = useCallback(() => {
    setAudioBlob(null)
    setDuration(0)
    setError(null)
    chunksRef.current = []
  }, [])

  return {
    isRecording,
    isPaused,
    duration,
    error,
    audioBlob,
    stream,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecording,
  }
}
