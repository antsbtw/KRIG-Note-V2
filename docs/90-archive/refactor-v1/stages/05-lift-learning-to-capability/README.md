# 阶段 05 — 把学习模块从 NoteView 上提到 learning capability

> 起因:2026-05-15 stage 04 收尾后用户提出"学习模块应该为所有 view 可调用,
> 这是一个底层公共模块"。当前 LearningApi(vocab/dictionary/translate/tts)已在
> learning capability,但 UI 层(DictionaryPanel 473 行 + dictionary-panel.css 271 行)、
> help-panel 注册、触发函数、context-menu 命令都还粘在 NoteView,任何其他 view
> (ebook 选词查词 / canvas-text-node 查词)想要复用都得 view 各自重写。
>
> 分支:`feature/lift-learning-to-capability`(memory feedback_branch_module_boundary)

## 一、决议(全 5 条已拍板)

### D-1 dictionary-panel UI 整目录上提

```
src/views/note/dictionary-panel/  →  src/capabilities/learning/ui/dictionary-panel/
  ├── DictionaryPanel.tsx (473 行)
  └── dictionary-panel.css (271 行)
```

理由:grep 实证 DictionaryPanel 内部只依赖 `LearningApi`,跟 view 业务零耦合,整搬合规。

### D-2 help-panel 注册改 capability 自注册(仿 stage 04 popup C4 模式)

- `views/note/help-panel-registrations.ts` 删除
- `capabilities/learning/ui/help-panels.ts` 新建,capability 加载时调用
  `registerLearningHelpPanels()` 注册 dictionary panel
- **id 改名**:`note-view.help.dictionary` → `learning.help.dictionary`
- view 字段:undefined(全 view 可用 — 学习模块底层公共定位的字面落地)

**架构依据**:`help-panel-registry` 在 `src/slot/interaction-registries/`(L4 框架层),
registry 内部 `Map<id, item>` 按 id 全局唯一,HelpPanelFrame 只按 id 取 Component
渲染,**view 字段对渲染无作用**(grep 实证)— 完全等价 stage 04 popup C4 的诊断。

### D-3 触发函数 showDictionaryPanel / showTranslationPanel 上提

- `views/note/learning-integration.ts` 的 export 函数搬到
  `capabilities/learning/ui/help-panel-integration.ts`
- 暴露 `LearningApi.ui.dictionaryPanel` 命名空间(typeof namespace import 同 stage 04 模式)
- 任何 view 想触发查词都调
  `requireCapabilityApi<LearningApi>('learning').ui.dictionaryPanel.showLookup(word)`

### D-4 vocab → text-editing driver 桥接 — **选 A:learning 主动推**

`learning-integration.ts` 当前在 view 层做:
- 启动一次性 `vocabList()` + `onVocabChanged` 订阅 → 调
  `text-editing capability.api.setVocabWords` 分发到所有 PM 实例

**A 拍板理由(字面证据)**:

1. **capability 加载顺序字面支撑**:`platform/renderer/index.tsx:32` 先 import
   `@capabilities/text-editing`,line 33 再 import `@capabilities/learning`。
   learning 加载时 text-editing 已注册,可安全 `requireCapabilityApi`。
2. **跨 view 平等消费**:text-editing driver `setVocabWords` 遍历 instanceRegistry
   给每个 PM 实例 dispatch(build-vocab-highlight-plugin.ts 字面),所以**所有
   PM-using view 自动受益**,无需 view 各自集成。
3. **事件源 → 消费者 方向自然**:vocab 数据源在 learning,消费方是 text-editing
   driver 的 highlight plugin;learning 主动推语义对。
4. **同 stage 04 popup/note-link-search "capability 自管 lifecycle" 模式**:避开
   view 装配集成代码、避开 view 各自重复初始化的隐患。

实施位置:`capabilities/learning/integrations/vocab-to-text-editing.ts`,
`capabilities/learning/index.ts` 加载副作用末尾调 `bridgeVocabToTextEditing()`。

### D-5 命令 `cm-dictionary-lookup` / `cm-translate-text` 归 learning capability

- `note-view.cm-dictionary-lookup` → `learning.cm-dictionary-lookup`
- `note-view.cm-translate-text` → `learning.cm-translate-text`
- 命令实现搬 `capabilities/learning/commands/register-commands.ts`
- learning capability 加载副作用调 `registerLearningCommands()` 一次性注册
- context-menu item 工厂搬 `capabilities/learning/ui/context-menu/items.ts`
- NoteView 端 `views/note/context-menu-content.ts` 改调工厂(类比 stage 04 模式)

匹配学习模块"底层公共"定位 — ThoughtView / ebook view 想右键查词时
`...createDictionaryLookupItem('thought-view')` 即可,不重复造轮子。

## 二、目标结构

```
src/capabilities/learning/
├── DESIGN.md
├── types.ts                       # 加 LearningUiApi 接口 + LearningApi.ui 字段
├── index.ts                       # 加副作用:registerLearningHelpPanels()
│                                   #          + registerLearningCommands()
│                                   #          + bridgeVocabToTextEditing()
├── commands/                      # 新建
│   └── register-commands.ts        # learning.cm-dictionary-lookup
│                                   # learning.cm-translate-text
├── integrations/                  # 新建
│   └── vocab-to-text-editing.ts    # D-4 bridgeVocabToTextEditing()
└── ui/                             # 新建
    ├── dictionary-panel/           # 整搬
    │   ├── DictionaryPanel.tsx
    │   └── dictionary-panel.css
    ├── help-panels.ts              # registerLearningHelpPanels() 全工程唯一注册源
    ├── help-panel-integration.ts   # showLookup(word, context?) / showTranslate(text)
    │                                # 入口 + LearningUiApi.dictionaryPanel 命名空间
    └── context-menu/
        └── items.ts                 # createDictionaryLookupItem(viewId)
                                     # createTranslateItem(viewId)
```

## 三、N-1 / N-2 / W5 lint 契约(sup stage 04 §4.5)

### 3.1 N-1 唯一注册源

| 注册对象 | 全工程仅 1 处 |
|---|---|
| help-panel id `learning.help.dictionary` | `capabilities/learning/ui/help-panels.ts` |
| 命令 `learning.cm-dictionary-lookup` | `capabilities/learning/commands/register-commands.ts` |
| 命令 `learning.cm-translate-text` | 同上 |

S5 验证 `grep -rn "helpPanelRegistry.register" src/` 全工程数清 — 应为
{NoteView 当前 0(C4 之后)+ learning 1 = 1}(目前是 1 在 view,搬后还是 1 在 capability)。

### 3.2 N-2 capability 分层契约

- `capabilities/learning/ui/` **不依赖 `@views/*`**(grep 验证)
- `capabilities/learning/` 内部允许 capability ↔ capability 横向依赖
  (`requireCapabilityApi<TextEditingApi>('text-editing')` 在 D-4 bridge 内调
  — 同 stage 04 C4/C6 popup + note-link-search 横向依赖先例)

### 3.3 W5 lint 0 error

按 memory `feedback_strict_compliance_workflow` + stage 04 教训
(`feedback_cross_view_capability_lift_must_sync_consumers` 已存),
**每个 commit 跑 lint + typecheck 双检**,不漏 lint。

## 四、跨 view 同步迁移核查(按 memory feedback_cross_view_capability_lift_must_sync_consumers)

stage 04 D-C 翻车的核心教训:删原 view 通配机制前必须 grep 隐式依赖。

本 stage 同款核查:

| 视图 | learning 当前消费状况 | 本 stage 处理 |
|---|---|---|
| NoteView | 4 文件 + 2 命令(全部当前现状) | 改成走 capability(主要迁移工作) |
| ebook view | grep 0 命中 LearningApi | 不动,等真需要时 view 自加 `createDictionaryLookupItem('ebook-view')` 一行 |
| web view | grep 0 命中 | 同上 |
| graph-canvas-view popup | grep 0 命中 | 同上(canvas-text-node popup 编辑器若想查词,view 自加 cm item) |

本 stage **只动 NoteView 一处消费者**,无 stage 04 D-C 同款隐式依赖断裂风险。
capability 暴露的 API 对所有 view 平等可用。

## 五、Commit 拆分(5 commit + 设计文档)

| Commit | 内容 | 验证 |
|---|---|---|
| **S1** | 本设计文档 + 开分支(已做) | git log 看分支 |
| **S2** | dictionary-panel 整搬到 capability + LearningUiApi 命名空间 + capability 自注册 help-panel | typecheck + lint pass / NoteView 查词翻译行为字面零变化 / `grep helpPanelRegistry.register` 全工程仅 1 处 |
| **S3** | learning commands 上提(`learning.cm-*`) + context-menu item 工厂化 + view 端调工厂 | typecheck + lint pass / N-1 命令唯一注册源 / NoteView 右键查词翻译 work |
| **S4** | D-4 vocab → text-editing 桥接搬 learning capability | typecheck + lint / vocab 高亮仍工作 |
| **S5** | view 端清理:删 learning-integration.ts、help-panel-registrations.ts、dictionary-panel/、views/note/index.ts 删 import | 全 grep 0 view 端 learning 残留 |

## 六、风险 + 回滚

- 每 commit 独立可回滚(`git revert <sha>`)
- N-1 双注册风险(S2~S5 期间):S2 capability 端 register 后 S5 才删 view 端 register
  → **中间 4 commit `help-panel` 双注册重复**。stage 04 popup C4 同款情况未实际造成问题
  (后注册覆盖前注册,Map.set 行为) — 本 stage 沿用同款,**中间状态不发布,5 commit 紧密推进**
- W5 lint 风险:每 commit 都跑 `npm run lint`(避开 stage 04 C2-C5 教训)
- 不走 main 合并(memory feedback_merge_requires_explicit_ok),里程碑后用户显式确认

## 七、规模估算

- view 端:`-560` 行(dictionary-panel 整搬 ~744 line + learning-integration 58 +
  help-panel-registrations 22)
- capability 端:`+600` 行(整搬 + 工厂 + 桥接 + 注册副作用)
- 净变动 ~40 行(主要是 capability 端新加 ui 命名空间装配 + 注册副作用)
