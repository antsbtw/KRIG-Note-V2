# Stage 1 EM1 验收报告

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **commits**:`cc248822` 偏离日志 / `ee568236` 22 NodeSpec attrs.id / `82f6ca91` plugin + Host skipOnChange 守门
> **验收依据**:实施计划 §2.4 EM1 5 条
> **状态**:静态检查 PASS(2 条) / 手动测试待用户验(3 条)

---

## 静态检查(claude 自验,PASS)

### EM1.1 ✅ npm run typecheck 全绿

```bash
$ npm run typecheck
> krig-note-v2@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
(empty output = pass)
```

### EM1.2 ⚠ npm run lint = main 起点 3 个预存 warning(本 sub-phase 0 新增)

```
build-block-indent-keymap.ts:20:37 warning  'Transaction' is defined but never used
build-block-indent-keymap.ts:21:15 warning  'EditorView' is defined but never used
ThoughtCard.tsx:48:10 warning  'extractTitle' is defined but never used
```

三个 warning 都是 main 起点(commit 947c9961)上预先存在,跟 block atomization 完全无关 — D-05 字面登记。
用户拍板(2026-05-21 AskUserQuestion)"从带 warning 的 main 起步"。

**本 sub-phase 0 新增 lint warning**。

---

## 手动测试(用户验,3 条)

### 验证准备

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout feature/L7-block-atomization
git log --oneline -5  # 顶应是 82f6ca91
npm start
```

### EM1.3 新建 note 所有 block 有 attrs.id

**操作**:
1. App 启动后 NavSide 点击 ➕ 新建 note
2. 在新 note 输入 "hello" / 按 Enter / 输入 "world" / 按 Enter / 输入 "code" / 选 ``` 转 codeBlock
3. 浏览器 DevTools(Cmd+Option+I)→ Console
4. 输入:
   ```js
   // 找到本 note 的 PM EditorView 并打印 doc.toJSON()
   // V2 没有 window.view 直挂,这里需通过 instanceRegistry 拿:
   __INSTANCE_REGISTRY__?.get('note-view')?.view.state.doc.toJSON()
   ```
   *(若 instanceRegistry 不暴露,改为 React DevTools 找 Host 的 viewRef)*

**预期**:
- doc.content 每个 paragraph / heading / codeBlock 的 `attrs.id` 都不是 null,是 26 字符 ULID
- 同一 note 内每个 block 的 id 字面**不同**

### EM1.4 旧 note 打开自动注入 id(冷启动 race 防御 verify)

**操作**:
1. 关闭 app,启动 SurrealDB
   ```bash
   # 假设 V2 数据在 ~/Library/Application Support/krig-note-v2/krig-data
   # 不要直接操作,用 app 内"新建 note + 加几个 block"先填充几篇 note
   ```
2. 重新启动 app
3. 打开既有 note(没经过 Stage 6 migration 的旧 doc,attrs.id 全 null)
4. DevTools Network panel 监控 IPC(electron-trace 或类似工具)
5. 同时 Console 输入打印 doc.toJSON

**预期**:
- 打开 note 后(短暂 1-2 秒),doc 内每个 block 都被注 ULID(✅ plugin 工作)
- **网络层 0 个 noteUpdate IPC**(✅ skipOnChange 守门生效;若多次 IPC 走出 = race 防御失败)
- 之后正常输入文字,IPC 正常触发(✅ 仅 skipOnChange tr 跳过,user tr 不跳)

### EM1.5 undo/redo 不重复注入 id(idempotent)

**操作**:
1. 新建 note,输入 "A" 回车 "B" 回车 "C"(三个 paragraph)
2. 记录每段的 attrs.id 字面值(X / Y / Z)
3. Cmd+Z 撤销三次 → doc 应回到只有 isTitle paragraph
4. Cmd+Shift+Z 重做三次 → 恢复 "A/B/C"
5. 比较新的 attrs.id 跟原来的 X/Y/Z 是否字面相同

**预期**:
- Undo/Redo 后 attrs.id **字面不变**(PM history 精确回滚 attrs)
- ✅ Plugin 检查"无 id"才注入(idempotent),history transaction 不被重复注

---

## 已知遗留(D-09 偏差,Stage 7 测试验)

**粘贴语义未实施**(decision 026 §5.2):
- 当前 plugin 仅注入"无 id"的 node,粘贴的 node 字面保留来源 id
- Stage 7 测试 T5(Cmd+C / Cmd+V 三次)会捕到此偏差
- 后续 commit 加 paste hook(用 `transformPasted` API 在 paste 入口给所有 attrs.id 重新注 ULID)

---

## 后续步骤

EM1 静态检查通过,**等用户手动验证 EM1.3-1.5 后**才 mark 完整通过。

✅ 用户验证通过 → 推进 Stage 2(note capability 改造)
❌ 任一项失败 → 字面登记 + 修复 + 重 verify

---

*EM1 verify · 2026-05-21*
