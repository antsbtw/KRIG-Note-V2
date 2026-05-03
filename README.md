# KRIG-Note V2

> KRIG-Note 项目的 V2 重构版本——按"L0~L5 自上而下构建,每层可测试 + 自我诊断"原则从零搭建。

## 为什么有 V2

KRIG-Note (V1) 在 2026-05 进行了一周的"自下而上 + 三角架构 + 字节级合规"重构,但**最终用户感知 0**——所有改动都在"声明 + 临时引用 + 文件搬移",没消除任何运行时违规。决定换路径:

- **V1 旧策略**:契约先行 → 中间层 → L5 视图(自下而上,六波分波)
- **V2 新策略**:L0 平台 → L1 内核 → L2 主题 → L3 状态 → L4 框架 → L5 视图(自上而下,每层立即可见)

V1 (`/Users/wenwu/Documents/VPN-Server/KRIG-Note/`) 仍可运行,作回退兜底。

## 核心原则

1. **每层可独立运行 + 自我诊断**:启动时 console 报告"Lx alive",问题时直接定位坏在哪
2. **渲染层 vs 能力层彻底分离**:外部依赖(ProseMirror / Three.js / pdfjs / electron API)全部封装在 capability,视图层零直接 import
3. **L5 仅 NoteView 起步**:其他视图(Graph / EBook / Web)暂时失效可接受,先把 NoteView 跑通验证流程
4. **用户可感知验证为优先**:每一步必须能被用户操作验证,杜绝"理论合规但 0 用户感知"

## 目录结构

```
KRIG-Note-V2/
├─ README.md                          ← 本文件
├─ docs/                              ← 设计文档
│  ├─ 00-architecture/                ← V2 架构纲领(6 个核心文档,继承自 V1)
│  │  ├─ charter.md                  (V2 简化总纲,即将起草)
│  │  ├─ vision.md                   (项目愿景)
│  │  ├─ three-layer.md              (三层架构顶层规范)
│  │  ├─ view-hierarchy.md           (视图层级定义)
│  │  ├─ module-list.md              (系统模块清单)
│  │  ├─ assessment-2026-04-21.md    (V1 分层符合性评估)
│  │  └─ cross-view-toggle.md        (跨视图导航设计)
│  ├─ 10-business-design/             ← 业务设计(各视图 + 块系统)
│  │  ├─ note/        block/    ebook/   graph/    web/
│  │  ├─ thought/     math/     code/    ai/       navside/
│  │  └─ storage/     web-translate/  help/  agent/
│  └─ 99-archive-v1/                  ← V1 历史归档
│     ├─ refactor/                    (V1 refactor 全套:总纲 + 4 PROMPT + 14 stages + 15 archive)
│     └─ evaluation/                  (V1 历史评估报告)
├─ src/                               ← 代码实现(V2 从 0 开始,L0 起步)
└─ package.json                       ← 项目依赖(从 0 添加)
```

## 当前状态

- ✅ Phase 0: 文档迁移(完成)
- ⏳ Phase 1: V2 简化总纲起草
- ⏳ Phase 2: L0 起步——Electron 启动 + 主窗口 + 自我诊断
- ⏳ Phase 3+: L1~L5 自上而下逐层实现

## 与 V1 的关系

- V1 仓库:[KRIG-Note](https://github.com/antsbtw/KRIG-Note)(本地 `/Users/wenwu/Documents/VPN-Server/KRIG-Note/`)
- V2 仓库:[KRIG-Note-V2](https://github.com/antsbtw/KRIG-Note-V2)(本仓库)
- V2 NoteView 业务代码会从 V1 迁移(参考 `docs/10-business-design/note/`)
- V2 完成后,V1 仍保留作历史/参考
