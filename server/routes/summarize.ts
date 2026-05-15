import { Router } from 'express'
import path from 'path'
import { Summarizer } from '../services/summarizer'

const router = Router()
const CACHE_PATH = path.join(process.cwd(), 'src/data/summaries-cache.json')
const summarizer = new Summarizer(CACHE_PATH)

router.post('/', async (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url) return res.status(400).json({ error: 'url נדרש' })

  try {
    const summary = await summarizer.summarizeUrl(url)
    if (!summary) return res.status(422).json({ error: 'לא ניתן לסכם את הקובץ' })
    res.json({ summary })
  } catch (err) {
    console.error('summarize error:', err)
    res.status(500).json({ error: 'שגיאת שרת' })
  }
})

export default router
