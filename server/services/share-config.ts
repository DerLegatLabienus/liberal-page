export interface ShareConfig {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null
  publicBaseUrl: string
  appBaseUrl: string
}

const DEFAULT_APP_URL = 'https://derlegatlabienus.github.io/liberal-page'

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function getShareConfig(): ShareConfig {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env
  const r2 = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
    ? { accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET }
    : null
  return {
    r2,
    publicBaseUrl: trimSlash(process.env.R2_PUBLIC_BASE_URL ?? ''),
    appBaseUrl: trimSlash(process.env.APP_PUBLIC_URL ?? DEFAULT_APP_URL),
  }
}

/** True only when R2 credentials AND a public base URL are present. */
export function isShareConfigured(): boolean {
  const c = getShareConfig()
  return c.r2 !== null && c.publicBaseUrl !== ''
}
