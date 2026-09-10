import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || '/assistant/',
  plugins: [react(), basicSsl()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/assistant/bridge': { target: 'http://localhost:3001', changeOrigin: true },
      '/assistant/auth': { target: 'http://localhost:3001', changeOrigin: true },
      '/assistant/admin': { target: 'http://localhost:3001', changeOrigin: true },
      '/assistant/mtx': { target: 'http://localhost:9997', changeOrigin: true, rewrite: (p) => p.replace('/assistant/mtx', '') },
      '/assistant/hls': { target: 'http://localhost:8888', changeOrigin: true, rewrite: (p) => p.replace('/assistant/hls', '') }
    }
  },
  build: {
    target: 'esnext',
    cssTarget: 'chrome100'
  }
})
