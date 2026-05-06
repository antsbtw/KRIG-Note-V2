// V2 ESLint 配置 — 屏障原则强制
// 详见 docs/00-architecture/directory-structure.md § 4

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  // 全局基础
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // 屏障层 1:可视化相关层(views / shell)零业务 npm import
  // V2 架构(v0.5):view 通过 driver(@drivers/*)间接使用 PM 等底层工具
  {
    files: ['src/views/**/*.{ts,tsx}', 'src/shell/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*'], message: 'view 通过 driver(@drivers/text-editing-driver) 间接用 PM,禁止直接 import' },
          { group: ['three', 'three/*'], message: 'view 通过 driver(@drivers/graph-editing-driver) 间接用 Three.js' },
          { group: ['pdfjs-dist'], message: 'view 通过 driver(@drivers/ebook-rendering-driver) 间接用' },
          { group: ['epubjs', 'foliate-js'], message: 'view 通过 driver(@drivers/ebook-rendering-driver) 间接用' },
          { group: ['electron'], message: 'Electron API 必须经能力层封装' },
        ],
      }],
    },
  },

  // drivers 层:driver 封装底层工具(PM / Three.js / etc.),允许 import 对应 npm 包
  // 这是 v0.5 架构的核心 — driver 是必经的业务驱动层,负责把底层工具编织成 view 可用形态
  {
    files: ['src/drivers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          // driver 之间零代码 import(driver 协议铁律 5)
          { group: ['@drivers/*'], message: 'driver 之间零代码 import — 共享逻辑下沉 src/shared/ 或 bus channel' },
          // electron 仍受限
          { group: ['electron'], message: 'Electron API 必须经能力层封装' },
        ],
      }],
    },
  },

  // 屏障层 2:Workspace / Slot 层零业务 npm import
  {
    files: ['src/workspace/**/*.{ts,tsx}', 'src/slot/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js'],
            message: '基础设施层禁止 import 业务 npm 包' },
        ],
      }],
    },
  },

  // 存储层只允许 surrealdb(L0 阶段尚未引入,本规则预留)
  {
    files: ['src/storage/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js', 'react'],
            message: '存储层只允许 surrealdb + 内部模块' },
        ],
      }],
    },
  },

  // 语义 / 共享层只允许纯类型 + 同层相对路径
  // 禁所有 npm 业务包(屏障)和跨层 alias(@views / @capabilities / @platform 等)
  {
    files: ['src/semantic/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          // 禁业务 npm 包
          { group: ['prosemirror-*', 'three', 'three/*', 'pdfjs-dist', 'epubjs', 'foliate-js', 'electron', 'react', 'react-dom'],
            message: '语义层 / 共享层只允许纯类型,不允许 import npm 包' },
          // 禁跨层 alias(只允许同层相对路径)
          { group: ['@views/*', '@capabilities/*', '@storage/*', '@platform/*', '@shell/*', '@workspace/*', '@slot/*'],
            message: '语义层 / 共享层只允许 import 同层内部模块(相对路径)' },
        ],
      }],
    },
  },

  // capabilities 是唯一允许业务 npm 的位置(无限制)

  // 忽略文件
  {
    ignores: ['node_modules/**', '.vite/**', 'dist/**', 'out/**', 'docs/**'],
  },
];
