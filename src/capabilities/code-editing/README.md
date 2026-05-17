# code-editing capability

> v0.1 · Phase 1A · CodeMirror 6 单点屏障

## 职责

封装 **CodeMirror 6** 编辑器 + 语言扩展 + 主题,对外提供 React `Host` 组件 + 语言注册 API。

## 屏障原则

**本 capability 是 V2 唯一允许 import `@codemirror/*` 和 `@lezer/*` 的位置**(对齐 [canvas-rendering 的 Three.js 单点屏障](../canvas-rendering/) 模式)。

其他位置(view / driver / 其他 capability / shell / workspace / slot)0 import,通过 `requireCapabilityApi<CodeEditingApi>('code-editing')` 拿 Host + 注册 API。

ESLint 规则:

```
no-restricted-imports:
  - @codemirror/*  只允许 src/capabilities/code-editing/ 内
  - @lezer/*       同上
```

## 业务方接入示例

```tsx
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi, CodeEditingHandle } from '@capabilities/code-editing/types';

function MyPanel({ initialCode, onSave }: { initialCode: string; onSave: (v: string) => void }) {
  const { Host } = requireCapabilityApi<CodeEditingApi>('code-editing');
  const lastValueRef = useRef(initialCode);

  return (
    <Host
      initialValue={initialCode}
      language="mermaid"
      theme="dark"
      onChange={(v) => { lastValueRef.current = v; }}
      onMount={(handle: CodeEditingHandle) => {
        // 可保 handle 给"重置到初始值"等命令式按钮用
      }}
    />
  );
}
```

**重要**:cleanup 写回业务上游(如 PM)时必须用 `lastValueRef.current`,**不要**通过 imperative handle 调 `getValue()` — React unmount 时子组件 cleanup 先于父执行,Host 内部已 destroy CMView,`getValue()` 返回 `''`,会把上游清空。详见 memory `feedback_react_unmount_child_cleanup_order`。

## 内置语言(Phase 1:6 个)

| id | label | loader |
|----|-------|--------|
| `mermaid` | Mermaid | StreamLanguage(轻量自定义) |
| `javascript` | JavaScript | `@codemirror/lang-javascript` |
| `typescript` | TypeScript | `@codemirror/lang-javascript` typescript:true |
| `python` | Python | `@codemirror/lang-python` |
| `json` | JSON | `@codemirror/lang-json` |
| `markdown` | Markdown | `@codemirror/lang-markdown` |

业务方贡献新语言:

```ts
requireCapabilityApi<CodeEditingApi>('code-editing').registerLanguage({
  id: 'rust',
  label: 'Rust',
  loader: async () => (await import('@codemirror/lang-rust')).rust(),
});
```

> 注:新语言包要装到 `package.json`(`npm i @codemirror/lang-rust`)。

## 文件结构

```
src/capabilities/code-editing/
├── README.md              本文件
├── index.ts               capability 注册 + Host + 注册 API
├── types.ts               对外类型(0 import @codemirror)
├── register-builtin.ts    启动期一次性注册 6 个内置语言
├── host/
│   ├── CodeHost.tsx       React Host(CMView 自管 DOM)
│   ├── theme-dark.ts      VS Code Dark+ 风格主题 + 高亮
│   └── theme-light.ts     占位(Phase 1 未实现)
└── languages/
    ├── registry.ts        语言注册中心(模块单例)
    ├── mermaid-lang.ts    Mermaid StreamLanguage(轻量自定义)
    ├── javascript.ts
    ├── typescript.ts
    ├── python.ts
    ├── json.ts
    └── markdown.ts
```

## Host API

见 [./types.ts](./types.ts)。

`CodeEditingHostProps`:
- `initialValue: string` — 初始种子;mount 后变化不重建
- `language?: string` — 已注册语言 id;undefined = plain
- `theme?: 'dark' | 'light'` — Phase 1 仅 dark
- `onChange?: (value: string) => void` — 防抖由父级控
- `onMount?: (handle: CodeEditingHandle) => void` — 暴露命令式 API
- `readOnly?: boolean` — 只读
- `features?` — lineNumbers / tabIndent / defaultKeymap 三个 boolean(默认全开)

`CodeEditingHandle`:
- `getValue(): string`
- `setValue(text: string): void`
- `focus(): void`

## Phase 路线

| Phase | 状态 | 内容 |
|-------|------|------|
| 1A | ✅ 当前 | capability 骨架 + 6 个内置语言 + Host(不接 mermaid) |
| 2 | 待 | mermaid 全屏切换到 capability Host |
| 后续 | 待 | inline code-block 接 CM6;light theme;dynamic language import |

## 不在 Phase 1 范围内

- ❌ inline code-block 接 CM6(等本 capability 落地后再起 Path 1 PR)
- ❌ light theme 完整支持(只占位接口)
- ❌ vim / emacs keymap(后续按需扩展)
- ❌ 折叠 / 搜索 / linter / auto-complete UI(后续按需扩展)
