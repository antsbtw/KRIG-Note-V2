# NoteView 菜单体系改造任务清单（2026-04-09）

## 背景
现有 Slash/Handle/Floating/Context 菜单注册分散在 `BlockDef.slashMenu`、`customActions` 等定义中，缺少统一契约与渲染分层，难以满足插件化、主题化和可访问性要求。

## 目标
- 统一菜单注册契约，支持多位置复用和懒加载渲染。
- 将注册层与渲染层解耦，避免框架依赖具体组件实现。
- 引入主题化与可访问性保障。

## 任务列表（按优先顺序）
1) 定义统一菜单 schema  
   - 字段：`id`、`label`、`icon`、`group`、`order`、`visibleWhen`、`role`、`shortcut`、`placement[]`（floating/handle/context/slash）、`component` 可选。  
   - 将 `SlashItemDef`、`ActionDef` 对齐或合并到该 schema。  

2) 分离注册层与渲染层  
   - 注册层（registry）仅存数据，提供查询 API；不 import React 组件。  
   - 渲染层（NoteEditor/FloatingMenu/SlashMenu 等）按 placement 读取注册表并渲染；支持懒加载组件工厂。  

3) 主题与样式配置  
   - 定义菜单主题 tokens（iconSize、radius、gap、padding、bg/hover/active/outline、shadow）。  
   - 将内联样式迁移到 tokens/CSS 变量或 `theme.ts`。  

4) 可访问性与可描述性  
   - 菜单项/按钮增加 `aria-label`、`role="menuitem"`，提供键盘导航（↑↓↵Esc）。  
   - Tooltip/快捷键信息，与截断 label 显示协同。  

5) 可见性/状态逻辑  
   - 设计 `visibleWhen` 条件（selection/block/type/flags），在渲染层统一评估。  
   - 支持 disable 与 hidden 区分，避免渲染层硬编码。  

6) 命令与 UI 解耦  
   - handler 签名 `(view, pos) => boolean`，禁止在 handler 内触发 UI 副作用；失败/结果通过返回值或事件上报。  
   - 渲染层统一处理反馈（toast/提示）。  

7) 文档与测试  
   - 契约文档：注册指南、字段说明、placement 行为、主题 token 表。  
   - Contract tests：注册去重、排序、可见性解析、schema 校验。  
   - Story/Playground：展示 slash/handle/floating/context 共用同一注册数据渲染。  

## 评估时间
- 2026-04-09  基于当前仓库代码与类型定义。
