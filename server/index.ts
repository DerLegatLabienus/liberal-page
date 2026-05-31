import express from 'express'
import cors from 'cors'
import trackingRouter from './routes/tracking'
import parliamentRouter from './routes/parliament'
import summarizeRouter from './routes/summarize'
import mksRouter from './routes/mks'
import knessetRouter from './routes/knesset'
import { detectKnessetTransition, loadConfig } from './services/knesset-config'
import billsRouter from './routes/bills'
import committeesRouter from './routes/committees'
import { startPoller } from './services/poller'
import { runMigrations } from './db/migrate'

const app = express()
const PORT = 3001

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().toLowerCase())

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
app.use('/api/summarize', summarizeRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

runMigrations()
  .then(() => loadConfig())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`)
      startPoller()
      detectKnessetTransition().then((transitioned) => {
        if (transitioned) console.log('Knesset transition detected and applied on startup')
      }).catch((err) => {
        console.error('Knesset transition detection failed on startup:', err)
      })
    })
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
