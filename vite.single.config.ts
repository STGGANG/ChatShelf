import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
})
