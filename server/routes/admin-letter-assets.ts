import { Router } from 'express'
import { requireAdmin } from '../middleware/auth'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { LetterContactsRepository } from '../repositories/letter-contacts-repository'
import { LetterTemplatesRepository } from '../repositories/letter-templates-repository'

const router = Router()
const tagsRepo = new LetterIssueTagsRepository()
const contactsRepo = new LetterContactsRepository()
const templatesRepo = new LetterTemplatesRepository()

router.use(requireAdmin)

// --- Issue Tags ---

router.get('/tags', async (_req, res) => {
  res.json({ tags: await tagsRepo.list() })
})

router.post('/tags', async (req, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string }
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' })
  const tag = await tagsRepo.create({ name, slug })
  res.status(201).json({ tag })
})

router.put('/tags/:id', async (req, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string }
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' })
  await tagsRepo.update(Number(req.params.id), { name, slug })
  res.json({ ok: true })
})

router.delete('/tags/:id', async (req, res) => {
  await tagsRepo.delete(Number(req.params.id))
  res.json({ ok: true })
})

// --- Contacts ---

router.get('/contacts', async (req, res) => {
  const q = req.query.q as string | undefined
  const contacts = q ? await contactsRepo.search(q) : await contactsRepo.list()
  res.json({ contacts })
})

router.post('/contacts', async (req, res) => {
  const { displayName, email, category } = req.body as { displayName?: string; email?: string; category?: string }
  if (!displayName || !email) return res.status(400).json({ error: 'displayName and email required' })
  const contact = await contactsRepo.create({ displayName, email, category: category ?? 'custom' })
  res.status(201).json({ contact })
})

router.put('/contacts/:id', async (req, res) => {
  const { displayName, email, category } = req.body as { displayName?: string; email?: string; category?: string }
  if (!displayName || !email) return res.status(400).json({ error: 'displayName and email required' })
  await contactsRepo.update(Number(req.params.id), { displayName, email, category: category ?? 'custom' })
  res.json({ ok: true })
})

router.delete('/contacts/:id', async (req, res) => {
  await contactsRepo.delete(Number(req.params.id))
  res.json({ ok: true })
})

// --- Letter Templates ---

router.get('/templates', async (_req, res) => {
  res.json({ templates: await templatesRepo.list() })
})

router.post('/templates', async (req, res) => {
  const { name, html } = req.body as { name?: string; html?: string }
  if (!name || !html) return res.status(400).json({ error: 'name and html required' })
  if (!html.includes('{{CONTENT}}')) return res.status(400).json({ error: 'Template html must contain {{CONTENT}}' })
  const template = await templatesRepo.create({ name, html })
  res.status(201).json({ template })
})

router.put('/templates/:id', async (req, res) => {
  const { name, html } = req.body as { name?: string; html?: string }
  if (html && !html.includes('{{CONTENT}}')) return res.status(400).json({ error: 'Template html must contain {{CONTENT}}' })
  await templatesRepo.update(Number(req.params.id), { name, html })
  res.json({ ok: true })
})

router.delete('/templates/:id', async (req, res) => {
  await templatesRepo.delete(Number(req.params.id))
  res.json({ ok: true })
})

export default router
