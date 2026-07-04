import './lib/fetch-logger'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import trackingRouter from './routes/tracking'
import parliamentRouter from './routes/parliament'
import summarizeRouter from './routes/summarize'
import mksRouter from './routes/mks'
import knessetRouter from './routes/knesset'
import { detectKnessetTransition, loadConfig } from './services/knesset-config'
import billsRouter from './routes/bills'
import committeesRouter from './routes/committees'
import featureFlagsRouter from './routes/feature-flags'
import analyticsRouter from './routes/analytics'
import authRouter from './routes/auth'
import adminRouter from './routes/admin'
import meetingsRouter from './routes/meetings'
import lettersRouter from './routes/letters'
import publicLettersRouter from './routes/public-letters'
import adminLettersRouter from './routes/admin-letters'
import adminLetterAssetsRouter from './routes/admin-letter-assets'
import { startPoller, stopPoller } from './services/poller'
import { runMigrations } from './db/migrate'
import { closeDb } from './db/client'

const app = express()
const PORT = 3001

// Security headers. CSP is disabled because the API is JSON-first and the few HTML responses
// (e.g. the committee /info page) use inline styles a default CSP would block; the SPA is served
// from GitHub Pages, not here, so CSP belongs there.
app.use(helmet({ contentSecurityPolicy: false }))

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().toLowerCase())

// Public share-page endpoints accept ANY origin (called cross-origin from the
// R2-hosted share pages). Mount with permissive CORS BEFORE the global restrictive
// cors so the allowlist doesn't 500 the beacon. No body parsing needed (query-param action).
app.use('/api/public/letters', cors(), publicLettersRouter)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin.toLowerCase())) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`))
    }
  },
}))

app.use(express.json())

app.use('/api/tracking', trackingRouter)
app.use('/api/parliament', parliamentRouter)
app.use('/api/mks', mksRouter)
app.use('/api/knesset', knessetRouter)
app.use('/api/bills', billsRouter)
app.use('/api/committees', committeesRouter)
app.use('/api/feature-flags', featureFlagsRouter)
app.use('/api/analytics', analyticsRouter)
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/letters', lettersRouter)
// Both share the /api/admin/letters base: adminLettersRouter owns the letter CRUD
// (/, /:id, /:id/pin); adminLetterAssetsRouter owns /tags, /contacts, /templates.
// Keep this order, and do NOT add a `GET /:id` to adminLettersRouter — it would shadow
// the asset GETs below it. Add new asset sub-paths to adminLetterAssetsRouter only.
app.use('/api/admin/letters', adminLettersRouter)
app.use('/api/admin/letters', adminLetterAssetsRouter)
app.use('/api/summarize', summarizeRouter)
app.use('/api/meetings', meetingsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Unknown route → consistent JSON 404 (instead of Express's default HTML).
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Final error handler: catches unexpected throws (incl. the CORS-origin rejection) so clients get
// JSON, not a stack trace. Must keep all four args for Express to treat it as an error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Server error' })
})

runMigrations()
  .then(() => loadConfig())
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`)
      startPoller()
      detectKnessetTransition().then((transitioned) => {
        if (transitioned) console.log('Knesset transition detected and applied on startup')
      }).catch((err) => {
        console.error('Knesset transition detection failed on startup:', err)
      })
    })

    // Graceful shutdown: on a platform stop/redeploy (SIGTERM) or Ctrl-C (SIGINT), stop the
    // poller, drain in-flight HTTP, then close the DB pool — instead of being hard-killed
    // mid-write. Force-exit after 10s if something hangs.
    let shuttingDown = false
    const shutdown = (signal: string) => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`Received ${signal} — shutting down gracefully`)
      stopPoller()
      server.close(() => {
        closeDb()
          .catch((err) => console.error('Error closing DB pool:', err))
          .finally(() => process.exit(0))
      })
      setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1) }, 10_000).unref()
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
  .catch((err) => {
    console.error(
      'Database unavailable — migrations failed, server not started.\n' +
      'Check that DATABASE_URL is set (see .env.example) and the database is running ' +
      '(`npm run db:up` for local Docker). Original error:',
      err,
    )
    process.exit(1)
  })
