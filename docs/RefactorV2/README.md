# RefactorV2 — V2 重构实施记录

> v1.0 · 2026-05-03

本目录记录 V2 重构的**阶段实施过程**——按时间序累积,不按 9 层组织。

---

## 0. 本目录的目的

V2 采用"自上而下分层构建,每层可测试 + 自我诊断"节奏(详见 [charter.md § 6](../00-architecture/charter.md))。每个 L 阶段(L0 ~ L5)完成时,在 `stages/` 内积累一份完成报告。

---

## 1. 与其他 docs/ 子目录的分工

```
docs/
├── 00-architecture/          ← 跨层纲领(charter / vision / directory-structure / 等)
├── 10-business-design/       ← V1 拷过来的业务设计(note / block / graph / web / 等),按业务领域
├── 99-archive-v1/            ← V1 历史归档(refactor / evaluation)
└── RefactorV2/               ← V2 实施记录(本目录,按时间序)
    ├── README.md             ← 本文件
    └── stages/
        ├── L0-platform-completion.md   (L0 完成时写)
        ├── L1-window-completion.md
        ├── L2-shell-completion.md
        ├── L3-workspace-completion.md
        ├── L4-slot-completion.md
        └── L5-noteview-completion.md
```

**层级 README + DESIGN(详细设计)放代码目录内**(`src/<层>/README.md` + `src/<层>/DESIGN.md`),不放本目录。

理由:文档与代码同位,改代码时强制同步。

---

## 2. 阶段完成报告内容要求

每个 `L<n>-<name>-completion.md` 至少包含:

### 2.1 完成判据核对(对应 charter § 6.3)
- [ ] npm start 跑得起来
- [ ] 用户操作能看到该层功能
- [ ] console 打印 "Lx alive" 诊断行
- [ ] 上一层"alive 行"也在(无回归)
- [ ] 健康检查 IPC 返回 `alive: true`

### 2.2 该层实施的具体内容
- 子目录创建清单
- 关键文件清单
- 引入的 npm 依赖(及理由)

### 2.3 自我诊断输出样本
- 启动时 console 截图 / 文本
- 健康检查 IPC 返回值样本

### 2.4 用户验证记录
- 验证步骤
- 看到的实际效果
- 是否通过

### 2.5 下一层(L<n+1>)的衔接条件
- 本层暴露给下一层的接口
- 下一层需要的前置条件是否就绪

### 2.6 遗留问题 / 待优化项
- 如有

---

## 3. 当前状态

- ⏳ L0 平台层实施中(对应 charter § 8 待拍板 1)
- ⏸️ L1~L5 待启动

---

## 4. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-03 | v1.0 | 初稿;定义本目录目的、与其他 docs/ 子目录分工、阶段报告内容要求 |
