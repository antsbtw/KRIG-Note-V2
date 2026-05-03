# 链接系统 — link mark 统一设计

> **类型**：Mark（附加在 text 上）
> **状态**：link mark 已注册，待扩展为统一链接系统

---

## 一、定义

所有链接统一为 **link mark**，通过 `href` 协议区分链接类型。用户选中文字后添加链接，显示文字完全由用户控制，不强制和目标标题一致。

```
请参考 线性代数笔记 中的内容        ← "线性代数笔记"是 link mark，href = krig://note/xxx
详见 第三章定理证明                  ← "第三章定理证明"是 link mark，href = krig://block/yyy
参考 维基百科                       ← "维基百科"是 link mark，href = https://...
```

---

## 二、三种链接类型

| 类型 | href 协议 | 点击行为 | 说明 |
|------|----------|---------|------|
| **Note 链接** | `krig://note/{noteId}` | 在当前编辑器打开目标笔记，push 导航历史栈 | 指向另一个 NoteFile |
| **Block 引用** | `krig://block/{noteId}/{blockId}` | 打开目标笔记并滚动到指定 block | 指向某个笔记的某个 block |
| **Web 链接** | `https://...` / `http://...` | `shell.openExternal` 打开系统浏览器 | 外部网页链接 |

### 协议说明

```
krig://note/1712345678-abc123
krig://block/1712345678-abc123/atom-xyz789
https://en.wikipedia.org/wiki/Linear_algebra
```

---

## 三、Schema

link mark 已存在，不需要新增节点类型：

```typescript
// 现有 link mark（在 registry.ts 中）
link: {
  attrs: { href: {}, title: { default: null } },
  inclusive: false,
  parseDOM: [{ tag: 'a[href]' }],
  toDOM(node) { return ['a', { href: node.attrs.href, title: node.attrs.title }, 0]; },
}
```

不再需要 `noteLink` inline atom 节点——所有链接统一为 link mark。

---

## 四、创建方式

### 4.1 Floating Toolbar — Link 按钮

选中文字 → Floating Toolbar 出现 → 点击 Link 按钮 → 弹出链接输入面板：

```
┌─────────────────────────────────────────────┐
│ 🔗  搜索笔记或输入 URL...                    │
│                                              │
│ ── 笔记 ──────────────────────────────────── │
│ 📄 线性代数笔记                              │
│ 📄 微积分总结                                │
│ 📄 概率论基础                                │
│                                              │
│ ── 或粘贴 URL ────────────────────────────── │
│ 直接粘贴 https://... 回车确认                │
└─────────────────────────────────────────────┘
```

**统一搜索栏**：一个输入框，同时支持：
- 输入关键词 → 搜索 Note 文件列表（模糊匹配标题）
- 粘贴 URL → 直接创建 Web 链接
- 未来扩展：搜索 Block（跨文档 block 搜索）

### 4.2 快捷键

| 快捷键 | 行为 |
|--------|------|
| Cmd+K | 选中文字时，打开链接输入面板（等同于点击 Link 按钮） |

---

## 五、点击行为

### 5.1 协议分发

```typescript
function handleLinkClick(href: string) {
  if (href.startsWith('krig://note/')) {
    const noteId = href.replace('krig://note/', '');
    pushHistory(currentNoteId);   // 记录当前位置
    openNote(noteId);             // 跳转
  } else if (href.startsWith('krig://block/')) {
    const [noteId, blockId] = href.replace('krig://block/', '').split('/');
    pushHistory(currentNoteId);
    openNote(noteId);
    scrollToBlock(blockId);       // 滚动到目标 block
  } else {
    shell.openExternal(href);     // 系统浏览器打开
  }
}
```

### 5.2 导航历史栈

维护一个 `noteId[]` 历史栈，支持后退：

```
history: [笔记A, 笔记B]
当前: 笔记C

← 后退 → 回到笔记B，history: [笔记A]，forward: [笔记C]
← 再后退 → 回到笔记A，history: []，forward: [笔记B, 笔记C]
→ 前进 → 回到笔记B
```

后退/前进按钮位置：编辑器 Toolbar 或键盘快捷键（Cmd+[ / Cmd+]）。

---

## 六、视觉样式

```css
/* 所有链接统一样式 */
a[href] {
  color: #8ab4f8;
  text-decoration: none;
  cursor: pointer;
}
a[href]:hover {
  text-decoration: underline;
}

/* Note 链接可选：无特殊区分，和 Web 链接一样显示为蓝色文字 */
/* 目标 Note 不存在时（可选）：红色 + 删除线 */
```

无 icon，显示文字由用户完全控制。

---

## 七、与知识图谱的关系

`krig://note/` 链接是知识图谱的**边**——NoteFile A 中的 link mark 指向 NoteFile B，构成文档间引用关系。GraphView 可以扫描所有文档中的 `krig://note/` 链接提取关系网络。

`krig://block/` 链接是更细粒度的引用——精确到 block 级别。

---

## 八、实现优先级

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | Floating Toolbar Link 按钮 + URL 输入 | Web 链接创建 |
| P0 | link 点击分发（krig:// vs https://） | 内链跳转 + 外链打开浏览器 |
| P0 | 导航历史栈 + 后退按钮 | 内链跳转后能返回 |
| P1 | Link 面板搜索 Note | 输入关键词搜索笔记列表 |
| P1 | Cmd+K 快捷键 | 快速添加链接 |
| P2 | Block 引用 | `krig://block/` 跨文档 block 引用 |
| P2 | 链接预览 | hover 链接时显示目标笔记预览 |

---

## 九、设计原则

1. **统一为 link mark** — 不新增节点类型，三种链接只是 href 协议不同
2. **显示文字用户控制** — 不强制和目标标题一致，不自动加 icon
3. **协议分发** — 点击时根据 href 协议决定行为（内链 / 外链 / block 引用）
4. **导航历史** — 内链跳转必须支持后退，类似浏览器体验
5. **统一搜索入口** — Link 面板同时支持搜索 Note 和输入 URL，不需要 `[[` 特殊语法
