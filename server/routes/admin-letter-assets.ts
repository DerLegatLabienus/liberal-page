import { Router } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { requireAdmin } from '../middleware/auth'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { LetterContactsRepository } from '../repositories/letter-contacts-repository'
import { LetterTemplatesRepository } from '../repositories/letter-templates-repository'
import { LetterMediaAssetsRepository } from '../repositories/letter-media-assets-repository'
import { sanitizeLetterHtml } from '../services/html-sanitizer'
import * as r2 from '../services/r2-client'
import { validateImage } from '../services/image-validator'
import type { LetterMediaAssetRow } from '../repositories/letter-media-assets-repository'

const router = Router()
const tagsRepo = new LetterIssueTagsRepository()
const contactsRepo = new LetterContactsRepository()
const templatesRepo = new LetterTemplatesRepository()
const mediaRepo = new LetterMediaAssetsRepository()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// Wrap multer so a too-large/invalid upload is a 400, not a thrown 500.
const uploadSingle = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code
      return res.status(400).json({ error: code === 'LIMIT_FILE_SIZE' ? 'file too large (max 5MB)' : 'upload failed' })
    }
    next()
  })

function toAsset(row: LetterMediaAssetRow) {
  return { ...row, url: r2.publicUrl(row.key) }
}

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
  // Sanitize after the placeholder check; {{CONTENT}} is plain text and survives sanitization.
  const template = await templatesRepo.create({ name, html: sanitizeLetterHtml(html) })
  res.status(201).json({ template })
})

router.put('/templates/:id', async (req, res) => {
  const { name, html } = req.body as { name?: string; html?: string }
  if (html && !html.includes('{{CONTENT}}')) return res.status(400).json({ error: 'Template html must contain {{CONTENT}}' })
  await templatesRepo.update(Number(req.params.id), { name, html: html ? sanitizeLetterHtml(html) : undefined })
  res.json({ ok: true })
})

router.delete('/templates/:id', async (req, res) => {
  await templatesRepo.delete(Number(req.params.id))
  res.json({ ok: true })
})

// --- Media (R2-hosted letter images) ---

router.get('/media', async (_req, res) => {
  if (!r2.isConfigured()) return res.status(503).json({ error: 'R2 not configured' })
  const rows = await mediaRepo.list()
  res.json({ assets: rows.map(toAsset) })
})

router.post('/media', uploadSingle, async (req, res) => {
  if (!r2.isConfigured()) return res.status(503).json({ error: 'R2 not configured' })
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required' })
  const v = validateImage(file.buffer)
  if (!v.ok) return res.status(400).json({ error: v.reason ?? 'invalid image' })
  const key = `${randomUUID()}.${v.ext}`
  await r2.putObject(key, file.buffer, v.contentType!)
  const row = await mediaRepo.create({
    key,
    filename: file.originalname,
    contentType: v.contentType!,
    sizeBytes: file.size,
    uploadedBy: req.user?.id ?? null, // req.user is attached by requireAuth (Express.Request augmentation in server/middleware/auth.ts)
  })
  res.status(201).json({ asset: toAsset(row) })
})

router.delete('/media/:id', async (req, res) => {
  if (!r2.isConfigured()) return res.status(503).json({ error: 'R2 not configured' })
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' })
  const row = await mediaRepo.getById(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  try {
    await r2.deleteObject(row.key)
  } catch (err) {
    console.error('[media] R2 delete failed (orphaned object):', err) // still remove the row
  }
  await mediaRepo.delete(id)
  res.json({ ok: true })
})

export default router
