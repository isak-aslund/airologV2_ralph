import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const keyPath = path.resolve(__dirname, '../certs/key.pem')
const certPath = path.resolve(__dirname, '../certs/cert.pem')
const hasCerts = fs.existsSync(keyPath) && fs.existsSync(certPath)

// Resolve a build-time version string. Preference order:
//   1. VITE_APP_VERSION env var (passed in by the Docker build)
//   2. `git describe --tags --always --dirty` if a .git is available
//   3. "dev" as a last resort
function resolveAppVersion(): string {
  const fromEnv = process.env.VITE_APP_VERSION
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim()
  try {
    return execSync('git describe --tags --always --dirty', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

const appVersion = resolveAppVersion()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    https: hasCerts
      ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
      : undefined,
    host: true, // Listen on all network interfaces
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/img': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
