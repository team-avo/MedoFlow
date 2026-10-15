import { Router } from 'express'
import * as ctrl from '../controllers/voiceAgentController'
import { Role } from '@prisma/client'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { audioUpload } from '../config/audioUpload'

const router = Router()

router.use(protect)
router.use(requireClinic)
// Staff console only: call logs hold callers' phone numbers and transcripts
// (found by the B0.5.3 authZ matrix — patients could previously read them).
router.use(authorize(Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PROVIDER, Role.STAFF))

// Config
router.get('/config', ctrl.getConfig)
router.put('/config', authorize(Role.SUPER_ADMIN), ctrl.updateConfig)

// OpenAI Realtime session (Phase 1B, browser WebRTC — currently broken on
// non-Realtime-tier accounts; the Groq turn endpoint below is the default).
router.post('/session', ctrl.createSession)

// Static greeting (UI plays this before the first user turn).
router.get('/greeting', ctrl.getGreeting)

// Text-to-speech — synthesize any text using clinic's configured voice.
router.post('/speak', ctrl.speakText)

// Groq push-to-talk turn — multipart audio upload, returns transcript + reply.
router.post('/turn', audioUpload.single('audio'), ctrl.runTurn)

// Calls
router.post('/calls', ctrl.startCall)
router.get('/calls', ctrl.listCalls)
router.get('/calls/:id', ctrl.getCall)
router.patch('/calls/:id', ctrl.endCall)
router.post('/calls/:id/summarize', ctrl.summarizeCall)

// Tool execution (used by the OpenAI Realtime path; Groq path executes tools
// server-side inside /turn).
router.post('/tools/execute', ctrl.executeTool)

export default router
