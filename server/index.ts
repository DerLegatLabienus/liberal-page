import express from 'express'
import cors from 'cors'
import trackingRouter from './routes/tracking'
import parliamentRouter from './routes/parliament'
import summarizeRouter from './routes/summarize'
import mksRouter from './routes/mks'
import billsRouter from './routes/bills'
import { startPoller } from './services/poller'

const app = express()
const PORT = 3001

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

app.use('/api/tracking', trackingRouter)
app.use('/api/parliament', parliamentRouter)
app.use('/api/mks', mksRouter)
app.use('/api/bills', billsRouter)
app.use('/api/summarize', summarizeRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  startPoller()
})
