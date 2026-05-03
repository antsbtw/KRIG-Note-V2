# Note Blocks 评估（2026-04-09）

## 范围
- Block 定义/注册：`src/plugins/note/blocks/*`, `src/plugins/note/registry.ts`, `src/plugins/note/types.ts`
- 关注点：UI/命令分离、注册制、可替换性、主题化、命名/可描述性。

## 发现（按严重度排序）
1) **UI 与逻辑耦合：NodeView/toDOM 内联样式与行为混杂**  
   - 示例：`text-block.ts` 的 `textBlockToDOM` 内联 style（align、text-indent），NoteTitle NodeView 操作 DOM class；缺少主题变量或装饰层。  
   - 影响：视觉不可配置，渲染层难以替换/测试。  

2) **命令/交互未集中注册，ActionDef 信息不足**  
   - `ActionDef` 只有 handler/label/icon/showIn，无分组/优先级/可见条件；命令与 UI（Handle/Context）耦合度高，缺少命令层与展示层的解耦。  

3) **Block 能力声明不完整且不一致**  
   - `capabilities` 字段在各 Block 结构不一致（有的带 canColor，有的没有；turnInto 列表缺乏统一约束），未形成统一接口用于菜单/快捷键/权限判断。  

4) **注册制覆盖不全**  
   - `BlockDef.slashMenu` 自动变为 SlashItem，但 Handle/Floating/Context 菜单缺少统一注册入口；渲染层可能硬编码。  

5) **命名与可描述性**  
   - 部分 Block 缺少自描述 label/keywords（仅 slashMenu 有，非所有 Block 提供）；缺少统一文档枚举 Block 列表、能力、快捷键。  

## 改进建议
- 引入“Block 视图层”与“展示装饰层”分离：NodeView/toDOM 只生成结构，样式由主题/装饰（decorations/CSS 变量）负责。 
- 统一命令注册：为 Block 操作定义 Command registry（id/label/shortcut/role/visibility），UI 菜单仅消费注册数据。 
- 规范 `capabilities`：制定 schema（drag/delete/duplicate/color/turnInto/marks…），所有 Block 遵循，供菜单与权限检查复用。 
- 扩展菜单注册：为 Handle/Floating/Context 提供统一注册接口，与 Slash 同源数据，避免渲染层硬编码。 
- 文档化 Block 表：列出 Block 名、能力、快捷键、菜单入口、数据转换器，保持“命名即设计”。 

## 评估时间
- 2026-04-09  基于仓库当前代码快照（未展开 NoteEditor 细节）。
