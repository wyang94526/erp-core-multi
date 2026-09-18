/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Vite 6+ blocks unknown Host headers (public OCI IP would 403).
    allowedHosts: true,
    // Proxy API calls through Vite so the UI works via localhost OR LAN IP
    // without hardcoding http://localhost:8000 (which breaks on other hosts).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
