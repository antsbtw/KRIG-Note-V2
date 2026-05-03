# eBook Renderer / Bookshelf / Annotation 改进任务清单（2026-04-09）

## Renderer 工厂
- 引入注册表：`registerRenderer({ id, fileTypes, create })`，允许插件添加新格式或变体。 
- 错误分级：未知类型 → 统一 fallback（提示不支持）；加载失败 → 结构化错误码。 
- 配置支持：可通过 config/env 覆盖默认渲染参数（dpi、maxScale、默认字体）。

## Bookshelf
- 导入前校验：同路径/同名/不同模式冲突检测；文件存在性、类型校验，给出用户级错误。 
- 状态统一：将 lastPosition 与 Workspace/EBookView 状态对齐（单一真相源），避免重复存储。 
- 操作反馈：增删改返回状态码/消息；不存在文件时提示并自动清理记录。 
- 配置：存储目录/容量限制/清理策略可配置；managed/link 语义文档化。 

## Annotation
- 统一 schema：`{id, bookId, type(pdf|epub), locator(cfi|page+bbox), color, style, created_at}`；对 PDF/EPUB 一致接口。 
- 去重/并发保护：基于 locator+style 去重；写入加锁或使用事务。 
- 错误码与提示：创建/删除/加载返回明确状态，UI 可提示。 
- 模式提示：对不支持的模式（如 PDF 若尚未实现）返回明确“不支持标注”。

## 文档与测试
- 文档：字段/错误码/流程说明；renderer 注册指南；bookshelf/annotation API 使用示例。 
- 测试：
  - Renderer：未知类型 fallback、注册覆盖、加载失败路径。 
  - Bookshelf：重复导入、缺失文件、managed→link 切换、lastPosition 恢复。 
  - Annotation：并发写入、去重、跨模式读取、错误码覆盖。 
