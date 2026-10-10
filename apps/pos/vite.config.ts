import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Path relatif agar hasil build bisa dimuat dari file:// di dalam Electron.
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
});
