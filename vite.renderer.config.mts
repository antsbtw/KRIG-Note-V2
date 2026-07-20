import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// V2 renderer 构建配置(单一 main_window renderer)
//
// 坑:root 指向 src/platform/renderer 后,forge 传入的相对 outDir
// '.vite/renderer/main_window' 会被 vite 从 root 解析,产物错落到
// src/platform/renderer/.vite/renderer/main_window/,而 forge 打包只从项目根的
// .vite/renderer/ 拷进 asar → 拷到空 → 打包版白屏。
// 用绝对路径把 outDir 钉回项目根,抵消 root 的相对解析。
export default defineConfig({
  root: 'src/platform/renderer',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('.vite/renderer/main_window', import.meta.url)),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@views':        fileURLToPath(new URL('./src/views', import.meta.url)),
      '@capabilities': fileURLToPath(new URL('./src/capabilities', import.meta.url)),
      '@drivers':      fileURLToPath(new URL('./src/drivers', import.meta.url)),
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
