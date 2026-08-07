// frontend/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    // Keep React and React Router as singletons so lazy chunks share context.
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'],
    alias: {
      '@context': path.resolve(__dirname, './src/context'),
      '@services': path.resolve(__dirname, './src/services'),
      '@screens': path.resolve(__dirname, './src/screens'),
      '@tools': path.resolve(__dirname, './src/tools'),
      '@components': path.resolve(__dirname, './src/components'),
      '@investigation': path.resolve(__dirname, './src/tools/investigation'),
      '@investigation-layout': path.resolve(__dirname, './src/tools/investigation/layout'),
      '@calibration': path.resolve(__dirname, './src/tools/calibration'),
      '@mule': path.resolve(__dirname, './src/tools/mule_detection'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@btsy': path.resolve(__dirname, './src/tools/btsy'),
    },
  },
  optimizeDeps: {
    force: process.env.VITE_FORCE_OPTIMIZE_DEPS === 'true',
  },
  server: {
    allowedHosts: [
      'fccanalytics.online',
      'www.fccanalytics.online',
      'fcip-dev.fccanalytics.online',
    ],
    headers: {
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:;",
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    }
  }
})
