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
  {
    files: ['src/views/**/*.{ts,tsx}', 'src/shell/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*'], message: '使用 capability(具体哪个能力等真实现时定)' },
          { group: ['three', 'three/*'], message: '使用 capability(具体哪个能力等真实现时定)' },
          { group: ['pdfjs-dist'], message: '使用 capability' },
          { group: ['epubjs', 'foliate-js'], message: '使用 capability' },
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
