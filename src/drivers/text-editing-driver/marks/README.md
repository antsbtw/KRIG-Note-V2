# marks — text-editing-driver 内建 mark 集合

每个 mark 一个文件,导出 `MarkSpec`。L5-B2 装 4 个:bold / italic / strike / code。

`index.ts` 收集成 `MARKS` 字典,由 `schema-builder.ts` 拼装到 PM Schema。

## 设计原则

- 每个 mark 文件包含且只包含 `MarkSpec`(parseDOM / toDOM)
- 不同 mark 互不依赖,删除单个 mark 文件 + 从 index.ts 移除应当不影响其他
- 用户级配置(哪些 mark 启用)L5-B2 不支持 — 全部启用;未来 L5-D+ 真有需求时改 ENABLED_MARKS 列表
