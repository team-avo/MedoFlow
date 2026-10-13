import 'dotenv/config'
import { installConsoleScrubber } from './utils/phiScrubber'
import { validateProductionEnv, validateDatabaseRole } from './config/envValidation'
import app from './app'
import prisma, { getDatabaseRoleInfo } from './config/prisma'
import { startCronJobs } from './scheduler/cronJobs'
import { createAiScribeWorker } from './queues/aiScribeQueue'
import { Server } from 'http'

const PORT = process.env.PORT || 3000
let server: Server

const connectDatabase = async (retries = 5, delay = 3000): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect()
      console.log('Database connected successfully.')
      return
    } catch (error) {
      console.error(
        `Database connection failed (attempt ${attempt}/${retries}):`,
        error instanceof Error ? error.message : 'Unknown error'
      )
      if (attempt === retries) {
        process.exit(1)
      }
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

const startServer = (): void => {
  server = app.listen(PORT, () => {
    console.log(
      `Medoflow server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`
    )
  })
}

const gracefulShutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received. Starting graceful shutdown...`)
  if (aiScribeWorker) {
    await aiScribeWorker.close()
    console.log('AI Scribe worker closed.')
  }
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.')
      try {
        await prisma.$disconnect()
        console.log('Database connection closed.')
        process.exit(0)
      } catch (error) {
        console.error('Error during database disconnection:', error)
        process.exit(1)
      }
    })
  } else {
    process.exit(0)
  }
}

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

let aiScribeWorker: ReturnType<typeof createAiScribeWorker> | null = null

const bootstrap = async (): Promise<void> => {
  // Every console.* line is PHI-scrubbed before it reaches the log drain (B0.3.5).
  installConsoleScrubber()
  validateProductionEnv()
  await connectDatabase()
  validateDatabaseRole(await getDatabaseRoleInfo())
  startCronJobs()
  try {
    aiScribeWorker = createAiScribeWorker()
    console.log('AI Scribe worker started (transcription will run when Redis is available)')
  } catch (err) {
    console.warn(
      'AI Scribe worker not started — transcription will stay "Processing" until Redis is running and the server is restarted:',
      err instanceof Error ? err.message : err
    )
  }
  startServer()
}

bootstrap()
