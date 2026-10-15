import { test } from 'vitest'
import assert from 'node:assert/strict'
import { startConsultationRecordingFlow } from './consultationRecordingFlow.js'

test('recording flow starts browser capture before backend state change', async () => {
  const calls = []

  await startConsultationRecordingFlow({
    startBrowserCapture: async () => {
      calls.push('browser')
    },
    markRecordingStarted: async () => {
      calls.push('backend')
      return 'ok'
    },
    rollbackBrowserCapture: async () => {
      calls.push('rollback')
    },
  })

  assert.deepEqual(calls, ['browser', 'backend'])
})

test('recording flow rolls back browser capture if backend start fails', async () => {
  const calls = []

  await assert.rejects(async () => {
    await startConsultationRecordingFlow({
      startBrowserCapture: async () => {
        calls.push('browser')
      },
      markRecordingStarted: async () => {
        calls.push('backend')
        throw new Error('backend failed')
      },
      rollbackBrowserCapture: async () => {
        calls.push('rollback')
      },
    })
  }, /backend failed/)

  assert.deepEqual(calls, ['browser', 'backend', 'rollback'])
})
