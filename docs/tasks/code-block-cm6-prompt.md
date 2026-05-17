# 新对话提示词:inline code block 接入 CodeMirror 6 capability

> 把以下内容**整段**复制粘贴给新对话的 Claude(在 V2 工作目录 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2` 启动新对话后)。

---

请按照 `docs/tasks/code-block-cm6.md` 的设计实现 inline code block 接入 CodeMirror 6 capability,**Phase 1 + 2 + 3 三个阶段都做完**。

## 任务起点

- 前置 PR(`refactor/sdk-to-capability`)已合 main(merge commit `64eefbe`),引入了两个 capability:
  - `src/capabilities/code-editing/` — CM6 单点屏障,Host + 6 个内置语言(JS/TS/Python/JSON/Markdown/Mermaid)
  - `src/capabilities/graph-layout/` — ELK 单点屏障,mermaid 渲染走它
- ESLint 屏障已生效:driver / view / 其他 capability 禁止直 import `@codemirror/*` `@lezer/*` `elkjs` `@mermaid-js/layout-elk`,只能走 `requireCapabilityApi(...)`
- 当前 main 的 codeBlock:`buildPlainCodeBlockView`(空 `<pre><code>`,无 UI)+ `buildMermaidCodeBlockView`(完整 mermaid toolbar + 全屏)

## 唯一正本

**`docs/tasks/code-block-cm6.md`** 包含完整的:
- 10 个技术决议(D1-D10,已拍板)
- 3 个 Phase 拆分(Phase 1 inline UI、Phase 2 高亮 plugin、Phase 3 通用全屏)
- V1 参考 grep 速查表(`/Users/wenwu/Documents/VPN-Server/KRIG-Note` 里 V1 的 inline code 实现路径)
- mermaid 现状兼容分析(底线:不破坏已合 main 的 mermaid 全屏)
- 文件结构规划(哪些🆕新增 / ⚠️改 / ❌删 / 不动)
- 每 Phase 的验收标准

**先把这个 doc 完整读一遍**,所有架构决策、文件位置、命名约定都已经拍板。**不要重新设计任何已拍板的决议**,如果觉得某个决议不合理可以质疑但先停下来问用户,不要默认改。

## 任务范围

完整实现 doc 中的 Phase 1 + Phase 2 + Phase 3:

- **Phase 1**(`feature/code-block-generic-nodeview`):inline generic NodeView + toolbar + lang dropdown + Copy 按钮(无高亮、Fullscreen 按钮 disable)
- **Phase 2**(`feature/code-block-syntax-highlight`):全局 PM Plugin 走 CM6 StreamLanguage tokenize → `Decoration.inline` 语法高亮
- **Phase 3**(`feature/code-block-generic-fullscreen`):抽象 `MermaidFullscreenPanel` → 通用 `CodeFullscreenPanel` + `MermaidPreviewPane`,所有语言可全屏

每 Phase 独立 commit,**最后三个子分支都合到** `feature/code-block-cm6` 总分支,**等待用户授权再合 main**。

## 硬约束(对齐项目 memory)

1. **合前必须用户显式授权**。三个子分支合到 `feature/code-block-cm6` 总分支可自主完成(因为子分支只是过程不暴露 main);总分支合 main 必须用户说"合 main"。memory: `feedback_merge_requires_explicit_ok`
2. **绝不主动 push**。任务过程中只 commit + 本地 merge,**任何 `git push` 都要等用户显式指令**。
3. **每次 commit 后给"请验证"测试清单**,含可执行的逐项测试步骤(操作 + 期望结果),不只是"npm start 跑跑看"。memory: `feedback_implementation_test_checklist`
4. **任何跨 mermaid 现有行为的改动都要先告警用户**。Phase 1 不动 mermaid 路径;Phase 3 必须重构 `MermaidFullscreenPanel`,但**重构后 mermaid 所有功能等价**(工具栏 / split / 模板下拉 / 方向切换 / 主题切换 / PNG SVG 下载 / 复制 / 缩放 / Esc 关闭 / × 关闭 / 写回 PM)。重构前先告知用户"我要动 mermaid 全屏的内部结构,但行为保持等价"。
5. **如果 doc 里没说清楚的决策,必须问用户**。不要自作主张补设计。memory: `feedback_strict_compliance_workflow`
6. **V2 是工作目录**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。所有 cwd 敏感命令(git / npm / find / rm 等)每次 Bash 调用都要显式 `cd` 到 V2,**绝不能跑到 V1**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note`)。memory: `feedback_v2_is_workspace_v1_is_reference`
7. **ESLint 屏障不能破**。任何 `driver/` 层文件违规 import `@codemirror/*` / `@lezer/*` / `elkjs` / `@mermaid-js/layout-elk` 都会编译失败。本任务一律走 `requireCapabilityApi('code-editing')` / `requireCapabilityApi('graph-layout')`。

## 验收(每 Phase 跑一遍 + 总验收跑全)

每 Phase commit 前必须本地跑通:
- `npm run typecheck` 全绿
- `npm run lint` 全绿(`--max-warnings 0`)
- `npm start` 启动正常(首次 Electron 没赶上 Vite 是常见赛跑现象,`rs` 重启 main 即可,不是 bug)
- mermaid 全屏完整功能不回归(对照 [refactor/sdk-to-capability 测试清单](../tasks/cm6-elk-capability-refactor.md) §验收)
- 本 Phase doc 中列的验收项全过

## 分支策略

```
main (合前停)
  └─ feature/code-block-cm6 (总分支,从 main 切)
       ├─ feature/code-block-generic-nodeview   (Phase 1 子分支)
       ├─ feature/code-block-syntax-highlight   (Phase 2 子分支)
       └─ feature/code-block-generic-fullscreen (Phase 3 子分支)
```

每子分支独立 commit;Phase 走完后合到总分支(`feature/code-block-cm6`);最后总分支等用户授权合 main。

## 工作流建议

1. **先读 doc**:`docs/tasks/code-block-cm6.md` 通读,确认决议清单 + 文件结构 + V1 grep 速查表
2. **建总分支 + Phase 1 子分支**:`git checkout -b feature/code-block-cm6 main` → `git checkout -b feature/code-block-generic-nodeview feature/code-block-cm6`
3. **Phase 1 实施**:按 doc §Phase 1 改动列表来,每改一组(toolbar / dropdown / Copy / NodeView 入口分支)就 typecheck 一次
4. **Phase 1 commit 后**:给用户测试清单 → 用户测过 → 合到总分支 → 开 Phase 2 子分支
5. **Phase 2 实施**:核心是 `build-code-syntax-highlight-plugin.ts`,参考 [vocab-highlight 模式](../../src/drivers/text-editing-driver/plugins/build-vocab-highlight-plugin.ts)
6. **Phase 2 commit 后**:测试清单 → 用户测过 → 合到总分支 → 开 Phase 3 子分支
7. **Phase 3 实施**:**先告警**"要重构 MermaidFullscreenPanel 内部结构,行为等价";然后抽 `CodeFullscreenPanel` + `MermaidPreviewPane`,改 menu-context.ts(加 language 字段),改 fullscreen overlay 注册 id
8. **Phase 3 commit 后**:测试清单(含 mermaid 全屏完整回归)→ 用户测过 → 合到总分支 → **停**,等用户说"合 main"

## 不在范围内

- ❌ 行号 inline 显示
- ❌ 折叠 / 搜索 / linter / auto-complete UI
- ❌ vim / emacs keymap
- ❌ 第 7+ 语言
- ❌ 多步 slash menu 流(D9 拍板沿用现有命令)
- ❌ light theme
- ❌ 代码块差异比对 / 历史回滚 / 自动保存

## 一定要确认的事

开干前请回复确认:
- [ ] 我已读完 `docs/tasks/code-block-cm6.md`,理解 10 个决议 + 3 Phase 拆分 + mermaid 兼容底线
- [ ] 我会在每个 commit 后给测试清单,合前等用户授权,不主动 push
- [ ] 我会在 Phase 3 动 mermaid 内部结构前先告警用户
- [ ] 我会在遇到 doc 没说清楚的决策时先停下问用户,不自作主张

如果有任何疑问(比如某个决议的边界、V1 参考代码细节、mermaid 兼容点),**先问再动手**。

---

(提示词到此结束)
