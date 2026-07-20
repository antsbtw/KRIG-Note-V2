import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// 打包产物不含 node_modules(Vite-forge 不拷)。turndown 的预编译 CJS bundle 在
// Node 侧走一句运行时 require:
//   function s$(){ ... var t = require('@mixmark-io/domino'); ... }
// Rollup/commonjs 插件不会改写这种深层运行时 require,alias 也管不到它,于是它被
// 原样保留成悬空 external require → 打包版启动即
//   "Cannot find module '@mixmark-io/domino'"。
// 在 transform 阶段把这句 require 改写成 import 进来的静态引用,强制 inline。
function inlineTurndownDomino(): Plugin {
  const NEEDLE = "require('@mixmark-io/domino')";
  return {
    name: 'inline-turndown-domino',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('turndown') || !code.includes(NEEDLE)) return null;
      const banner = "import __domino from '@mixmark-io/domino';\n";
      return { code: banner + code.split(NEEDLE).join('__domino'), map: null };
    },
  };
}

// V2 主进程构建配置
export default defineConfig({
  plugins: [inlineTurndownDomino()],
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
