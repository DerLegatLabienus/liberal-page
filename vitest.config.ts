import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    clearMocks: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
    environmentMatchGlobs: [
      ['tests/server/**', 'node'],
    ],
    alias: {
      'react-i18next': path.resolve(__dirname, './src/__mocks__/react-i18next.ts'),
    },
  },
})
