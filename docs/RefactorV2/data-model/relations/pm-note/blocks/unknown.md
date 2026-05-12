# unknown

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/unknown/spec.ts`

---

## 1. 语义边界

`unknown` 是**转换器 fallback 占位节点** —— 当外部输入（如 md-to-pm 转换器）遇到 V2 schema 暂未实现的节点名时，包装为 `unknown` 节点，降级显示"暂未支持"占位卡片。

### 1.1 用途

- **不偷偷丢内容**：未识别节点不简单丢弃，而是保留原始数据 + 标记 missing。
- **反向驱动 schema 补齐**：unknown 节点是"暂未实现"的可见信号，提醒后续 sub-stage 补齐对应节点。
- **schema 补齐后自动消失**：例如新增 image block 后，md-to-pm 输出 `{ type: 'image' }` 而不再 `{ type: 'unknown', attrs.originalType: 'image' }`。

### 1.2 unknown vs 完整节点

| 场景 | 节点 |
|---|---|
| V2 schema 已实现的节点 | 直接用对应 type（如 paragraph / heading / image） |
| V2 schema 未实现的节点（转换器遇到） | `unknown`（保留 originalType 供未来手动 / 自动迁移） |

---

## 2. type 字段值

```ts
type: 'unknown'
```

KRIG 自定义命名。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `originalType` | `string` | `''` | 原本应该的节点 type（如 `'image'` / `'mathBlock'`） | KRIG 自定义 |
| `missing` | `boolean` | `true` | 固定 true，标识"原本应该是其他节点" | KRIG 自定义 |
| `raw` | `string` | `''` | 原始文本 / 序列化（便于调试 + 未来手动迁移） | KRIG 自定义 |
| `error` | `string` | `''` | 可选错误信息（如 mediaPutBase64 失败原因） | KRIG 自定义 |

### 3.2 形态特征

- **block 节点**（`group: 'block'`）+ **atom**（`atom: true`）—— 叶子，光标不能进入。
- **selectable: true** —— 可整体选中（删除 / 移动）。

### 3.3 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: undefined  // 叶子节点
atom: true
group: 'block'
```

`unknown` 是 block atom 叶子，**不接受任何子节点**。

### 4.1 嵌套约束

- 不能包含任何子节点（叶子）。
- 可作为以下父容器的子节点：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'unknown',
  attrs: {
    originalType: 'image',
    missing: true,
    raw: '![alt](http://...)',
    error: '',
    indent: 0,
  }
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'div[data-krig-unknown="1"]',
    getAttrs(node) {
      const el = node as HTMLElement;
      return {
        originalType: el.getAttribute('data-original-type') || '',
        missing: true,
        raw: el.getAttribute('data-raw') || '',
        error: el.getAttribute('data-error') || '',
      };
    },
  },
]
toDOM(node) {
  // 占位卡片 UI：显示 "暂未支持 <originalType>" + raw 摘要 + 可选 error
  // 完整 toDOM 实现详见 spec.ts
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → unknown | md-to-pm 转换器遇到不支持的节点时输出 unknown |
| unknown → MD | 输出 raw 字段（保留原始 Markdown 文本） |

### 5.4 可逆性

unknown 设计上**保证原始数据可逆**（raw 字段无损保留）—— 未来 schema 补齐后可通过升级路径恢复为正确节点。

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 没有 `unknown` 节点（V1 转换器遇到不支持节点会丢弃或报错）。

### 6.2 V2 处置

**V2 新增节点**（V1 没有），属于 V2 转换器设计的健壮性增强。

### 6.3 V1 数据迁移

无须迁移（V1 不存在该节点）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-UK-1 | unknown 节点是否可被用户手动编辑（如修改 raw 字段）？ | **不可编辑**（atom 叶子，原始数据保护） | 设计已定 |
| P-UK-2 | 当用户加载含 unknown 的 doc 时，是否主动提示"有 N 个节点未识别"？ | **由 capability 决定** UI 提示策略，schema 层不负责 | 实施时由 capability.text-editing 决定 |
| P-UK-3 | unknown 节点是否在 Markdown 导出时输出 `<!-- unknown: ... -->` HTML 注释保留信息？ | **暂仅输出 raw**（按 §5.3 transform 契约），HTML 注释扩展视需要 | Phase 2c+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/unknown/spec.ts`
- md-to-pm 转换器（V2 转换层 fallback 设计参考）
- L5-B4.3.1 文档（V2 转换器设计阶段）
