# command-registry — 命令注册中心

按 charter § 1.2 注册原则:命令通过字符串引用,菜单项 / Toolbar 等通过 `command: 'xxx.yyy'` 引用,实际 handler 在此注册。

## API

```ts
commandRegistry.register('note.toggle-toc', () => { /* ... */ });
commandRegistry.execute('note.toggle-toc');
commandRegistry.has('note.toggle-toc');  // true
commandRegistry.unregister('note.toggle-toc');
```

## V1 → V2

V1:`src/renderer/ui-primitives/command-registry.ts` 38 行空骨架,无实际注册。
V2:真实施 + 集中在 src/slot/。
