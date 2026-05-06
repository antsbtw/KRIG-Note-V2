# plugins — text-editing-driver 内建 PM 插件

每个插件单文件;`editor-view-builder.ts` 按规定顺序拼装。

| 插件 | 文件 | 来源 |
|---|---|---|
| history | build-history-plugin.ts | prosemirror-history(撤销重做 + Mod-z/Shift-z/y keymap) |
| input-rules | build-input-rules.ts | prosemirror-inputrules(headings + 4 marks markdown) |
| mark-keymap | build-mark-keymap.ts | prosemirror-commands.toggleMark(Mod-b/i/Shift-x/e) |
| heading-keymap | build-heading-keymap.ts | prosemirror-commands.setBlockType(Mod-Alt-0/1/2/3) |

**装配顺序**(editor-view-builder.ts):history 最前 → blockPlugins → input-rules → mark-keymap → heading-keymap → baseKeymap 兜底。
