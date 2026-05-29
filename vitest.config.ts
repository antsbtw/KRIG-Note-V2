import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // bench 与普通 test 分开运行 (npm run bench)
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
  },
  resolve: {
    alias: {
      '@views':        path.resolve(__dirname, 'src/views'),
      '@capabilities': path.resolve(__dirname, 'src/capabilities'),
      '@drivers':      path.resolve(__dirname, 'src/drivers'),
      '@semantic':     path.resolve(__dirname, 'src/semantic'),
      '@storage':      path.resolve(__dirname, 'src/storage'),
      '@platform':     path.resolve(__dirname, 'src/platform'),
      '@shell':        path.resolve(__dirname, 'src/shell'),
      '@workspace':    path.resolve(__dirname, 'src/workspace'),
      '@slot':         path.resolve(__dirname, 'src/slot'),
      '@shared':       path.resolve(__dirname, 'src/shared'),
    },
  },
});
