# eBook Renderer / Bookshelf / Annotation 评估（2026-04-09）

## 范围
- Renderer 工厂：`src/plugins/ebook/renderers/index.ts`（通过 `createRenderer(fileType)`）
- 书架存储：`src/main/ebook/bookshelf-store.ts`
- 标注存储：`src/main/ebook/annotation-store.ts`

## 发现（按严重度排序）
1) **Renderer 工厂扩展性/配置化不足**  
   - 仅按 fileType 分支选择 fixed/reflowable renderer，未暴露可扩展 hook（自定义渲染参数、字体/主题、渲染优先级）。  
   - 没有对未知/新类型的明确错误分类或 fallback（只会抛错或返回 null）。

2) **Bookshelf 存储缺少健壮性与一致性检查**  
   - 导入时未系统化处理“同名/同路径/不同存储模式(managed/link)”冲突；删除/移动缺少文件存在性校验的用户级反馈。  
   - lastPosition 等状态与 Workspace/renderer 恢复流程存在重复（EBookView 本地 state + store），容易不一致。 

3) **Annotation 存储覆盖面有限，错误处理薄弱**  
   - 主要针对 EPUB CFI，高亮/下划线；PDF 标注缺席或未统一接口。  
   - 标注增删未返回状态码/错误原因；并发/重复标注无去重逻辑。 

4) **命名与可描述性不足**  
   - 文件内缺少对字段含义的集中注释（如 managed vs link、lastPosition 结构、annotation schema）。  
   - 未提供对外文档列举字段和错误码。  

5) **配置与安全**  
   - Bookshelf 存储路径/策略未配置化（例如受限目录、体积限制）；Annotation 也未声明最大条目/版本策略。 

## 改进建议（概要）
- Renderer 工厂：支持注册制或插件表；为新格式/变体提供扩展点和错误分级。 
- Bookshelf：导入前做重复/存在性检查并提供用户级错误；lastPosition 与 Workspace 状态去重/统一；添加校验和异常提示。 
- Annotation：统一 schema（PDF/EPUB），提供状态码，加入去重/并发保护；缺失模式明确提示“不支持”。 
- 文档化：字段/错误码/行为说明；对存储策略（路径、大小、清理）给出配置。 
