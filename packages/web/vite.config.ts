import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// スキャフォルド。TanStack Router プラグイン等は実装時に追加。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
})
