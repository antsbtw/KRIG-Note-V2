# keymap-registry — view 全局快捷键注册中心(W4.1)

view 通过 `ViewDefinition.keymap` 字段声明全局快捷键,view-type-registry
在 `distributeToRegistries` 阶段把 keymap 拆到本 registry。

renderer 启动时调一次 `startKeymapListener()`(见 `platform/renderer/index.tsx`),
全局 keydown → 路由到当前活跃 view 的 binding → 通过 `commandRegistry.execute`
触发命令。

详见 [docs/RefactorV2/audit/wave4-design/W4.1-keymap-registrar.md](../../../docs/RefactorV2/audit/wave4-design/W4.1-keymap-registrar.md)。

## 注册示例(view 端)

```ts
registerView({
  id: 'note-view',
  install: [...],
  keymap: [
    { key: 'mod+k', command: 'note-view.popup-link',
      enabledWhen: ['has-text-selection', 'in-view-area'] },
    { key: 'mod+[', command: 'note-view.go-back',
      enabledWhen: ['in-view-area', 'not-in-input'] },
  ],
});
```

## 设计纪律

- **声明式过滤**:`enabledWhen` 是数组 AND,所有条件枚举值在 `keymap-types.ts` 集中定义
- **listener 无 baseline**:不在 listener 内偷偷过滤 input 元素等,所有规则通过枚举值显式表达
- **复杂条件加新枚举**,不允许 command handler 内做声明式条件检查
