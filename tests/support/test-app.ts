import express, { type Router } from 'express'

/** Mounts a single router with JSON body parsing — the shape shared by most route tests.
 *  Tests exercising custom CORS ordering or non-JSON bodies build their own `express()` app. */
export function createTestApp(basePath: string, router: Router) {
  const app = express()
  app.use(express.json())
  app.use(basePath, router)
  return app
}
