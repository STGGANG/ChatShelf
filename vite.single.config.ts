import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_CHATSHELF_SINGLE': JSON.stringify('true'),
  },
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
