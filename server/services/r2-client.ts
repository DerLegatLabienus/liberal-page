import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

export class R2NotConfiguredError extends Error {
  constructor() {
    super('R2 is not configured (missing R2_* env vars)')
    this.name = 'R2NotConfiguredError'
  }
}

const REQUIRED = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'] as const

export function isConfigured(): boolean {
  return REQUIRED.every((k) => !!process.env[k])
}

// Constructed per call (low-volume admin tool) so tests can toggle env freely.
function client(): S3Client {
  if (!isConfigured()) throw new R2NotConfiguredError()
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export function publicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) throw new R2NotConfiguredError()
  return `${base.replace(/\/$/, '')}/${key}`
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }))
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }))
}
