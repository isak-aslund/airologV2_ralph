import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const keyPath = path.resolve(__dirname, '../certs/key.pem')
const certPath = path.resolve(__dirname, '../certs/cert.pem')
const hasCerts = fs.existsSync(keyPath) && fs.existsSync(certPath)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
