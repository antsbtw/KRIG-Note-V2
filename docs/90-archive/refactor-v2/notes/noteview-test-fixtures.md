# NoteView 测试数据(2026-05-14)

> 用途:B/C/D/E 类逐项测试时,DevTools console 一行注入 fixture note。
> 路径:`window.electronAPI.noteCreate(initialDoc, folderId)`(preload 暴露的 IPC 直通通道)。
> 参考 [noteview-feature-inventory.md](noteview-feature-inventory.md)。

---

## B 类 fixture - 静态构造(B-static)

测试目标(13 项):
- B-2 Heading H1/H2/H3
- B-4/5/6/7 Bold/Italic/Strike/InlineCode
- B-8 Underline / B-9 TextColor / B-10 Highlight / B-11 Link
- B-12/13 无序列表 / 有序列表(含嵌套)
- B-14 任务列表
- B-15 Blockquote / B-16 CodeBlock + language / B-17 HorizontalRule / B-18 HardBreak

不覆盖(必须键入):
- B-1 段落输入 / B-3 Heading keymap / B-19 Undo / B-21 Selection emit / B-22 InputRules / B-23 Paste / B-24 Clipboard / B-20 Toolbar 高亮

### DevTools console 一行注入

复制下面整段到 DevTools console 执行:

```js
(async () => {
  const note = await window.electronAPI.noteCreate({
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: [
        // 标题段(派生 note title)
        { type: 'paragraph', attrs: { isTitle: true }, content: [{ type: 'text', text: 'B 类静态测试 note' }] },

        // B-2 Heading H1/H2/H3
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1 一级标题' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2 二级标题' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3 三级标题' }] },

        // B-4/5/6/7/8 marks(单 mark)
        { type: 'paragraph', content: [
          { type: 'text', text: '行内 marks:' },
          { type: 'text', text: ' 粗体', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' 斜体', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' 删除线', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' 行内代码', marks: [{ type: 'code' }] },
          { type: 'text', text: ' 下划线', marks: [{ type: 'underline' }] },
        ] },

        // B-9 TextColor / B-10 Highlight / B-11 Link
        // 色值字面对齐 ColorPickerPanel.tsx TEXT_COLORS / BG_COLORS(FreeForm 对齐),
        // 确保 picker active 高亮可命中
        { type: 'paragraph', content: [
          { type: 'text', text: '颜色:' },
          { type: 'text', text: ' 红色文字', marks: [{ type: 'textStyle', attrs: { color: '#e74c3c' } }] },
          { type: 'text', text: ' 蓝色文字', marks: [{ type: 'textStyle', attrs: { color: '#5cb8e8' } }] },
          { type: 'text', text: ' 黄底高亮', marks: [{ type: 'highlight', attrs: { color: '#d4b85a' } }] },
          { type: 'text', text: ' 粉底高亮', marks: [{ type: 'highlight', attrs: { color: '#e85a9a' } }] },
          { type: 'text', text: ' / 外链:' },
          { type: 'text', text: 'Anthropic', marks: [{ type: 'link', attrs: { href: 'https://anthropic.com' } }] },
        ] },

        // 组合 mark (bold + italic + color)
        { type: 'paragraph', content: [
          { type: 'text', text: '组合 mark:' },
          { type: 'text', text: ' 粗斜红', marks: [
            { type: 'bold' }, { type: 'italic' },
            { type: 'textStyle', attrs: { color: '#e74c3c' } },
          ] },
        ] },

        // B-12 无序列表(含嵌套)
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序一级 A' }] }] },
          { type: 'listItem', content: [
            { type: 'paragraph', content: [{ type: 'text', text: '无序一级 B' }] },
            { type: 'bulletList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套二级 b-1' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套二级 b-2' }] }] },
            ] },
          ] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序一级 C' }] }] },
        ] },

        // B-13 有序列表(含嵌套 a./i.)
        { type: 'orderedList', attrs: { start: 1 }, content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序一级 1' }] }] },
          { type: 'listItem', content: [
            { type: 'paragraph', content: [{ type: 'text', text: '有序一级 2' }] },
            { type: 'orderedList', attrs: { start: 1 }, content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二级 a.1' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二级 a.2' }] }] },
            ] },
          ] },
        ] },

        // B-14 任务列表
        { type: 'taskList', content: [
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '未完成 任务一' }] }] },
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成 任务二' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '未完成 任务三' }] }] },
        ] },

        // B-15 Blockquote
        { type: 'blockquote', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '这是 blockquote 引用块,灰色 italic 显示。' }] },
        ] },

        // B-16 CodeBlock + language
        { type: 'codeBlock', attrs: { language: 'typescript' }, content: [
          { type: 'text', text: "const greet = (name: string) => `Hello, ${name}!`;\nconsole.log(greet('KRIG'));" },
        ] },

        // B-17 HorizontalRule
        { type: 'horizontalRule' },

        // B-18 HardBreak(段内强制换行)
        { type: 'paragraph', content: [
          { type: 'text', text: '第一行后接 hard break' },
          { type: 'hardBreak' },
          { type: 'text', text: '第二行(同段)' },
        ] },
      ],
    },
  }, null);
  console.log('B-static fixture 注入:', note);
})();
```

---

## B 类 fixture - input rule(B-input)

让你**手动键入**测 input rule + keymap + paste,fixture 仅建一个空 note 占位。

```js
(async () => {
  const note = await window.electronAPI.noteCreate({
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { isTitle: true }, content: [{ type: 'text', text: 'B 类输入规则测试 note' }] },
        { type: 'paragraph' },
      ],
    },
  }, null);
  console.log('B-input fixture 注入:', note);
})();
```

input rule + keymap 手测步骤(在空段顺序键入,完后撤销重来):

| # | 输入序列 | 期望 |
|---|---|---|
| B-22a `# ` | `# 一级` | 转成 H1 |
| B-22b `## ` | `## 二级` | 转成 H2 |
| B-22c `### ` | `### 三级` | 转成 H3 |
| B-22d `**xx**` | 键入 `**粗**` | 转粗体 mark |
| B-22e `*xx*` | 键入 `*斜*` | 转斜体 |
| B-22f `~~xx~~` | 键入 `~~删~~` | 转删除线 |
| B-22g `` `xx` `` | 键入 `` `代码` `` | 转 inlineCode |
| B-22h `- ` | 行首键入 `- 项一`,回车,Tab,`- 嵌套` | bulletList + 嵌套 |
| B-22i `1. ` | 行首键入 `1. 一` | orderedList |
| B-22j `> ` | 行首键入 `> 引` | blockquote |
| B-22k ` ``` ` | 行首键入 ` ``` ` + 回车 | codeBlock |
| B-22l `---` | 行首键入 `---` | horizontalRule |
| B-3 keymap | 在任意段按 Cmd+Alt+1/2/3/0 | 切 H1/H2/H3/paragraph |
| B-19 undo | 上面任意操作 + Cmd+Z | 撤回上一步,Cmd+Shift+Z 重做 |
| B-20 toolbar | 选中 B-static note 任一带 mark 的文字 | toolbar B/I/S/U 对应按钮**高亮** |
| B-18 keymap | 段内按 Shift+Enter | 插 hardBreak 同段换行 |
| B-23 paste | 在浏览器外面复制一张图(截图)→ note 中 Cmd+V | 自动转 image(base64 / media://) |
| B-24 paste | 从其他 note 复制几段 → 新 note 粘贴 | 含 mark/block 结构保留 |

---

## C/D/E/F 类 fixture(待补)

按需追加。
