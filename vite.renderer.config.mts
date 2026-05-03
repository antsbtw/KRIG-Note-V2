import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// V2 renderer 构建配置(单一 main_window renderer)
export default defineConfig({
  root: 'src/platform/renderer',
  plugins: [react()],
  resolve: {
    alias: {
      '@views':        fileURLToPath(new URL('./src/views', import.meta.url)),
      '@capabilities': fileURLToPath(new URL('./src/capabilities', import.meta.url)),
      '@semantic':     fileURLToPath(new URL('./src/semantic', import.meta.url)),
      '@storage':      fileURLToPath(new URL('./src/storage', import.meta.url)),
      '@platform':     fileURLToPath(new URL('./src/platform', import.meta.url)),
      '@shell':        fileURLToPath(new URL('./src/shell', import.meta.url)),
      '@workspace':    fileURLToPath(new URL('./src/workspace', import.meta.url)),
      '@slot':         fileURLToPath(new URL('./src/slot', import.meta.url)),
      '@shared':       fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});
