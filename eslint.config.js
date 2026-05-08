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
          // W5 修订:对外 npm 包加 allowTypeImports: true,跟 W5 capability/driver 规则口径一致
          // (类型 import 不引入运行时依赖,view 端从 driver/PM 拿类型在 capability/types.ts
          //  中转之后仍然合规;PM EditorView 等类型在 view 操作 PM 实例时是必需的)
          { group: ['prosemirror-*'],
            message: 'view 通过 driver(@drivers/text-editing-driver) 间接用 PM,禁止直接 import 运行时;类型 import 允许',
            allowTypeImports: true },
          { group: ['three', 'three/*'],
            message: 'view 通过 driver(@drivers/graph-editing-driver) 间接用 Three.js',
            allowTypeImports: true },
          { group: ['pdfjs-dist'],
            message: 'view 通过 driver(@drivers/ebook-rendering-driver) 间接用',
            allowTypeImports: true },
          { group: ['epubjs', 'foliate-js'],
            message: 'view 通过 driver(@drivers/ebook-rendering-driver) 间接用',
            allowTypeImports: true },
          { group: ['electron'], message: 'Electron API 必须经能力层封装' },
          // Wave 2 新增 — audit P1-5:view 不直触 storage,走 capability(如 @capabilities/media-storage)
          { group: ['@storage/*'], message: 'view 不直接 import @storage/*,走对应 capability(audit P1-5)' },
          // Wave 2 新增 — audit P1-4:view 间不直连,跨 view 调用走 commandRegistry.execute
          { group: ['@views/*'], message: 'view 间不直接 import,跨 view 调用走 commandRegistry.execute(audit P1-4)' },
          // Wave 5 新增 — audit P1-A:view 不直 import capability 运行时值,走 requireCapabilityApi(id) 间接路由
          // allowTypeImports: true — 类型 import 允许(如 import type { XApi } from '@capabilities/<id>/types')
          { group: ['@capabilities/*'],
            message: 'view 不直接 import capability 运行时值,走 requireCapabilityApi(id) 间接路由;' +
                     '类型走 import type from @capabilities/<id>/types(W5 设计 § 5)',
            allowTypeImports: true },
          // Wave 5 C4 新增 — driver 是 capability 内部实现,view 不可见,走 capability api
          // allowTypeImports: true — view 仍可通过 import type 拿 driver 类型(经 capability/types.ts 中转)
          { group: ['@drivers/*'],
            message: 'view 不直接 import driver(driver 是 capability 内部实现);' +
                     '走 requireCapabilityApi(id),类型走 import type from @capabilities/<id>/types(W5 C4)',
            allowTypeImports: true },
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
          // Wave 2 新增 — audit P1-5:driver 不直触 storage,走对应 capability
          { group: ['@storage/*'], message: 'driver 不直接 import @storage/*,走对应 capability(audit P1-5)' },
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

  // 能力层(capabilities):charter § 1.1 单向调用
  // - 唯一允许业务 npm 的位置(对外屏障已在 views/drivers/storage/shared 等块布防)
  // - 禁反依赖 slot 视图层基础设施 + workspace per-ws 状态(audit P2-6 + Wave 3.3)
  // - 禁互拉(charter § 1.2:能力间不能互相 install)
  // - 禁 view / driver(向上调用)
  //
  // 例外:@slot/capability-registry / @slot/command-registry — charter § 1.2
  // 注册原则要求 capability 自注册到 Registry 并暴露 commands,这是合理的向上调用。
  {
    files: ['src/capabilities/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          // 禁 slot 视图层基础设施(audit P2-6;capability-registry/command-registry 不在此列,见上)
          { group: ['@slot/workspace-bus/*'],
            message: 'capability 不依赖 workspace-bus,共享原语在 @shared/event-bus(audit P2-6 / Wave 3.3)' },
          { group: ['@slot/triggers/*', '@slot/frame-bindings/*',
                    '@slot/interaction-registries/*', '@slot/toolbar-registry/*',
                    '@slot/nav-side-registry/*', '@slot/menu-registry/*',
                    '@slot/view-type-registry/*', '@slot/diagnostics/*',
                    '@slot/shared-ui/*'],
            message: 'capability 不依赖 slot 视图层基础设施(charter § 1.1 单向调用)' },
          // 禁 workspace(per-ws 状态属 L3,capability 跨 workspace 复用,不该绑死)
          { group: ['@workspace/*'],
            message: 'capability 不依赖 workspace 状态;若需 per-ws 数据,由 view 注入(charter § 1.1)' },
          // 禁 capability 间互拉(charter § 1.2:能力间不能互相 install)
          { group: ['@capabilities/*'],
            message: 'capability 间不互相 import(charter § 1.2);若需协作,view 自己组合 install 列表' },
          // 禁向上调用 view(charter § 1.1 单向调用)
          { group: ['@views/*'],
            message: 'capability 不向上调用 view(charter § 1.1 单向调用)' },
          // 注:capability → driver 是允许的(charter § 1.3 表格:capability 是 driver 的
          // 封装方 — 如 capability.text-editing 内部用 prosemirror-*;web-rendering capability
          // 内部编排 web-sync-driver / web-translate-driver)。不在禁列。
        ],
      }],
    },
  },

  // 忽略文件
  {
    ignores: ['node_modules/**', '.vite/**', 'dist/**', 'out/**', 'docs/**'],
  },
];
