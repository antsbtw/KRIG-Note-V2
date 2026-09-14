# 交接 prompt · diglot mind v0 续做

> 交给**新对话**。分工:**用户 = 决策者;你 = 执行者(写代码)**。
>
> 前一轮对话上下文过长,在此交接。**骨架已完成并真机可用**,
> 本轮是往上接功能,不是重做。

---

## 0. 一句话:现在在哪儿

> mind v0 的**模型层 16/16 动作全部实现、14 条不变量全有断言**,
> 双向同步(note ⇄ 画布)真机跑通。
> ⚠️ **缺口全在 view 接线** —— 6 个动作模型能做但 UI 点不到。

分支:`feature/diglot-mind-v0`,HEAD = `7b95c98d`,工作树干净。

---

## 1. ⭐⭐ 先读这些(按顺序,别跳)

| 文件 | 为什么必读 |
|---|---|
| ⭐⭐ `docs/10-business-design/diglot/03-projection-map.md` **§5.9** | **完成度盘点** —— 哪些做了、哪些没做,跑代码查出来的 |
| ⭐⭐ 同文件 **§0.6** | **数据分区**:交集 + note/mermaid/graph 三专用。动任何字段前先在这查「谁读它」 |
| ⭐ 同文件 **§5.5 / §5.6** | 节点 = 标题 + 正文;S 层存 note doc(v1),mermaid 降为有损导入/导出 |
| ⭐ 同文件 **§6** | 债务台账(债 1/2/5/6/7/8) |
| `docs/10-business-design/diglot/01-mind-spec.md` §7 | 交互清单(规格全集,对照 §5.9 看缺口) |
| `docs/10-business-design/diglot/04-data-model-map.md` | 一份数据三个 view 各取所需的全貌 |
| `src/capabilities/diglot-model/` | 模型层(纯逻辑、可离线测) |
| `src/views/graph-canvas-view/MindCanvas.tsx` | 画布侧接线 |
| `src/views/graph-canvas-view/MindSemanticPane.tsx` | 语义面(note/mermaid 两 tab) |

---

## 2. ⭐ 已完成(别重复劳动)

```
双向同步 note ⇄ 画布      ELK 自动布局(mrtree)      折叠(两面同源、持久)
拖动:改父/改序 + Alt 钉住   富文本节点(公式/格式)      连接点操作点(+/− 含计数)
mermaid 导入/导出(有损)    v1 存储(S 层存 note doc)   分区模型(交集+三专用)
尺寸自适应(标题定宽/不折行/固定 10px 内缩)
```

---

## 3. ⭐ 待办(用户已排序,可直接开工)

### 3.1 建议顺序(按「能用度」,非工作量)

| # | 任务 | 难度 | 说明 |
|---|---|---|---|
| 1 | ⭐ `semantic.moveIndent` 大纲 Tab 升降级 | 小 | **模型现成**,只缺键盘接线。现在改层级只能手动改 hn |
| 2 | ⭐ 视口落库(债 7) | 小 | 画板缩放控件已就绪,mind 继承即可(见 §3.2) |
| 3 | `Cmd+L` 联系线 | 中 | 导图区别于大纲的核心;模型已完整(含确定性 edge id) |
| 4 | `graphic.deletePos` 单节点解钉 + `editColor` | 小 | 都是接线 |
| 5 | Span(边界/概要)/ markers / 撤销栈 | 大 | 建议**单独立项**,别混在本轮 |

### 3.2 ⭐ 视口落库(债 7)的现成条件

画板侧**已完成**(commit `7a360298`):
- `interaction/zoom-levels.ts` —— 上下限/档位/快捷键的单一真源
- `GraphCanvasZoomControl` —— 只依赖 `getZoom / zoomTo / fitToContent / subscribe`,
  ⭐ **不知道视口存在哪**,专为 mind 继承而设计
- `Host.getViewport()` 已加

mind 侧要做的:
1. 把视口存进 **G 层图级行**(形态未定,建议 `^^ view=x,y zoom=z`)
   ⚠️ `parseGLayer` 现在遇到非 `^` 开头会 fail loud,要加这一种行
   ⚠️ G 层**跨图种共用**(bpmn 将来也要存视口),语法要通用
2. 新建 mind **不读旧视口**(默认 100% + root 居中,`centeredOnRoot` 已实现)
3. 把控件挂进导图的 toolbar —— ⚠️ 导图下 `GraphCanvasToolbar` 的 `hostRef` **恒为 null**
   (走 MindCanvas 自己的 Host),所以要另传,不能照抄画板那条线

⚠️ **视口落库后每次滚轮都会触发写盘**,要与现有保存防抖合流。

---

## 4. ⚠️ 铁律(违反即返工)

- ⚠️⚠️ **`tests/x/` 512 必须全绿** —— 红了 = 改变了行为;**改测试让它绿 = 违规**
- ⚠️ 全仓存量失败 **7 文件 / 2 用例**(含 `slot-resource-guard`)**不要去修**,不是你弄坏的
- ⭐⭐ **每条测试都必须验证过能真的失败** —— 写完守卫**故意注入违规看它变红**
- ⚠️ **不要静默兜底**;fail loud / early
- ⚠️ **常驻 timer / 事件监听必须有停止调用**
- ⭐ **canvas-rendering 是共用 basic**:**增**功能可以,**改既有行为**要先问用户

### 4.1 ⭐⭐ 注入验红的三条真实教训(都踩过)

1. 断言写 `toContain('mesh.scale.y = -1')`,而**注释里也有这句** → 删掉真代码照样绿。
   **守卫必须只看会执行的代码**(剥掉注释行再比)。
2. 守卫**照抄实现的公式** → 只能验证「实现和自己一致」,**验不出漏项**。
   要按**真正要的效果**列全条件(踩过:高度守卫漏了 insetY,与被测代码犯同一个疏忽)。
3. ⚠️ 注入没红时**先分清**:是守卫失效,还是**注入没造出目标场景**?
   (踩过:正则没匹配上、或场景走了别的分支 —— 那不算守卫失效)

### 4.2 ⚠️ 排查纪律(血的教训)

- ⭐⭐ **别拿截图像素反推尺寸** —— 没算画布缩放,把 103 当成 280,
  据此提的三个方案全是治症状,**白费两轮**。
- ⭐ **每层都对但结果不对 → 查数据经过的格式**(踩过:正文存盘即丢,
  逐层验渲染链路全对,真凶是 mermaid 装不下)。
- ⭐ **加诊断日志 / 写离线探针 / 直接查库**,别读代码脑补。
  查库姿势(app 跑着时):
  ```bash
  CRED="$HOME/Library/Application Support/KRIG Note V2/.db-credentials"
  U=$(python3 -c "import json;print(json.load(open('$CRED'))['username'])")
  P=$(python3 -c "import json;print(json.load(open('$CRED'))['password'])")
  curl -s -X POST "http://127.0.0.1:8533/sql" -H "Accept: application/json" \
    -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" -u "$U:$P" \
    -d "SELECT title, semantic FROM mind_doc;"
  ```

### 4.3 ⚠️ 环境坑

```bash
env -u ELECTRON_RUN_AS_NODE npx electron-forge start
```
否则 `require('electron')` 命中 npm launcher 包,报 `Cannot find module 'electron'`
—— 与「Electron 装坏了」一模一样,极易误判。

⚠️ **5173 可能被用户既有实例占用** → forge 会直接退出。
**不要 kill 用户的进程**,问他。

**做实验改文件时用 `cp` 备份还原,绝不用 `git checkout`**(会丢未提交的工作)。

### 4.4 ⚠️ grep 可能"看不见"某些文件

仓库里有几个源码文件含**裸 NUL 字节**,`grep` **静默跳过整个文件**
(exit 1、零输出,与「真没有」无法区分)。
判据 `file x.ts` 报 `data`;解法 `grep -a`。
⭐ **搜不到时先验搜索工具本身是否生效**,别直接断言「功能不存在」。

---

## 5. ⚠️ 欠用户的两件事(本轮开工前先问)

1. **画板缩放控件的真机验证没做** —— 5173 被占,forge 退出。
   jsdom 挂载测试覆盖了逻辑,但**验不了**:下拉会不会被画布裁切、
   toolbar 布局挤不挤、滚轮联动手感。⭐ 请用户重启确认。
2. **magnet-actions 的画板手势回归也没做**(更早的一轮) ——
   resize / rotate / rewire / 画线 / 框选,共用层改过之后没逐个过。

---

## 6. 和用户协作的方式(顺着来效率高得多)

- **他会盯着数据要证据**。说「我觉得有问题」时**通常是对的**,先查再答
- ⭐⭐ **他会推翻你的结论,而且往往对**。被纠正时**先查证再认**,别急着道歉也别硬撑
  (前一轮有多条规则是被他推翻后重写的:同层同宽→各自按 hn、
  视口不持久→要落库、派生物不落库→用户意图必须落库)
- ⚠️ **他明确讨厌的**:拿一个指标否定它没测的能力;把「库里没有」当「拿不到」;
  **用注释里的说明骗过守卫**
- ⭐ **先查既有实现再动手** —— 这个仓库里「你以为要做的事」常常已经做了一半
- ⭐ **规则被推翻时,测试要按新规则重写并注明推翻理由** ——
  那是规则变了,不是改测试迁就实现;两者必须在 commit 里说清

---

## 7. 开场建议

别一上来就写代码。建议:

> 「我先读 `03-projection-map.md` 的 §5.9(完成度盘点)和 §0.6(数据分区),
>  确认理解现状。盘点说**模型层 16/16 已实现,缺口全在 view 接线**,
>  待办第 1 项是 `semantic.moveIndent`(大纲 Tab 升降级,模型现成只缺键盘接线)。
>  ⚠️ 另外前一轮欠了两次真机验证(画板缩放控件、magnet-actions 手势回归),
>  要不要先确认那两项?
>  我打算**先把断言写出来**再动手。这个顺序你认吗?」
