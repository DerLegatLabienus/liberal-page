import os from 'os'
import path from 'path'

/**
 * Path to the test suite's pre-migrated pglite snapshot. Written once by vitest
 * globalSetup (tests/global-setup.ts) and loaded by the test-mode DB client
 * (server/db/client.ts) so each test file starts from a migrated DB without
 * replaying every migration. Test-only — never read in production (the prod
 * client uses node-postgres). Imports are node builtins, so this file is safe
 * to import anywhere.
 */
export const PGLITE_SNAPSHOT_PATH = path.join(os.tmpdir(), 'liberal-page-pglite-test-snapshot.tar.gz')
