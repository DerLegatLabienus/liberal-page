import express from 'express'
import cors from 'cors'
import trackingRouter from './routes/tracking'
import parliamentRouter from './routes/parliament'
import summarizeRouter from './routes/summarize'
import mksRouter from './routes/mks'
import knessetRouter from './routes/knesset'
import billsRouter from './routes/bills'
import committeesRouter from './routes/committees'
import { startPoller } from './services/poller'

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  startPoller()
})
