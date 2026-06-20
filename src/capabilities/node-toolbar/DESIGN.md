# node-toolbar capability(L5-G5)

Graph 节点浮条 —— 选中画板节点 → 选中框正下方居中浮出 Freeform 风格 pill 工具条 →
按节点类型注册声明哪几个属性面板 → 改属性节点实时更新。

**权威设计**:[../../../docs/RefactorV2/stages/L5G5-node-floating-toolbar-design.md](../../../docs/RefactorV2/stages/L5G5-node-floating-toolbar-design.md) v0.3

## 是什么

view-agnostic 共享 capability。容器(NodeToolbar)**零硬编码 section 清单** ——
有哪几个 button 完全由 `nodeBindingRegistry` 按节点类型声明(数量无上限)。任何 Graph view
(canvas / family-tree / knowledge / mindmap)都能复用。

## 结构

```
types.ts        SectionDef / SectionContext / NodeSnapshot / NodeToolbarApi / ToolbarAnchor / TextNodeStyleCommand
registry.ts     sectionRegistry + nodeBindingRegistry(first-match-wins;数量无上限)
NodeToolbar.tsx 容器:锚定 + button 排布 + 面板互斥 + ESC(零硬编码 section)
sections/
  fill/  色板(读写 style_overrides.fill)
  line/  线型(5 dashType + pt + 色,读写 style_overrides.line)
  text/  B/I/U/对齐/列表/文字色(纯复用 note,走 runTextCommand)
  type/  字体族 + 自由字号(画板专属,走 patchInstance: text_font/text_size)
index.ts        双导出 + capabilityRegistry.register + 内置 4 section 注册 + 节点绑定 + alive
styles.css
```

## W5 严格态 A 边界

0 直接 import three / prosemirror / @drivers 运行时。改属性走 view 注入的回调:

- `patchStyle` / `patchInstance` → view 落地到 `canvas-rendering` host.updateInstance
- `runTextCommand` → view 落地到 `text-editing` runNodeStyleCommand

## view 接入(canvas 为首个消费者)

view 提供:
1. `getSelectedScreenAABB()` → ToolbarAnchor(容器内 CSS 像素)
2. `toSnapshot(instance)` → NodeSnapshot(view 解析语义 kind:shape/line/text)
3. onPatchStyle / onPatchInstance / onTextCommand 落地回调

## 扩展(其它 view / 插件)

`registerSection(def)` + `registerNodeBinding({ match, sections })`,容器零改动。
