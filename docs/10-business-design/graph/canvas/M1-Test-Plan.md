# Canvas M1 验收测试

**测试日期填**:____________

**分支**:`feature/graph-canvas-m1`

**测试前置**:
1. 在仓库根目录运行 `npm start`,等 9 个 Vite dev server 全部就绪 + Electron 启动
2. 进入应用后,顶部 WorkspaceBar 应能看到一个 🎨 Graph 图标(第 5 顺位)
3. 切到 Graph workMode

---

## 验收范围

§2.1 共 17 项;M1.6 之前先验 **1-12 + 14-17**(第 13 "Edit Substance via API" 留 M1.6 完成后再验)。

| 项目 | 入口 | 状态 |
|---|---|---|
| 1 | NavSide "+ 新建画板" → 创建 + 自动打开 | M1.5b 应过 |
| 2 | 浏览 Library 工具栏 → 看到 22 shape + 5 substance | M1.4b 应过 |
| 3 | 点 shape 工具 → 画布点击 → 实例化 | M1.3c + M1.4b 应过 |
| 4 | 点 substance 工具 → 画布点击 → 实例化 | 同上 |
| 5 | 双击节点 → Inspector 显示 + 改属性 | M1.4c + M1.x UX 决策 |
| 6 | Inspector 改 fill/line/size → 视觉立即更新 | M1.4c |
| 7 | 拖动节点 → 节点跟随 + line 自动跟随 | M1.3a + M1.2c |
| 8 | 选中按 Delete → 节点 + 引用 line 一起删 | M1.3a |
| 9 | 滚轮 → 画板缩放(zoom-to-cursor) | M1.3b + Freeform 重构 |
| 10 | 拖动空白 → 画板平移 | M1.3b |
| 11 | 关闭 Canvas → 重打开 → 内容完整恢复 | M1.5b.6 |
| 12 | 多选 + Combine → 弹对话框 → 创建新 substance | M1.4d |
| 13 | 选中 substance → Edit Substance → right-slot 编辑 | M1.6 之后再验 ⏸ |
| 14 | shape 移动时,line 端点跟随 magnet 自动吸附 | M1.2c |
| 15 | 从 Picker 选 line → 鼠标在 magnet 内 mousedown → 拖到另一 magnet → 创建 line | M1.x.7 |
| 16 | 选中 line → 拖端点 handle → 重连到另一 magnet(rewire) | M1.x.7b |
| 17 | 旋转 shape → line 端点跟随旋转后的 magnet 位置 | M1.x.5 |

**M1.x 系列实现的额外能力**(超出原 spec 14 项):
- **resize handles + rotation handle**(M1.x.2/3) — 8 个 handle + 1 个旋转 handle
- **Cmd+Z / Cmd+Shift+Z 撤销/重做**(M1.x.6) — 50 步全量快照
- **OBB hit-test**(M1.x.4) — 旋转后节点能精确选中
- **历史脏数据防御**(M1.x.4) — deserialize 钳制异常 size/position

---

## 测试用例

### Test 1:NavSide "+ 新建画板"

**步骤**:
1. 切到 Graph workMode(WorkspaceBar 🎨 图标)
2. NavSide 顶部应看到 "画板目录" + 两个按钮 `+ 文件夹` `+ 画板`
3. 点 `+ 画板`

**预期**:
- 列表里立即出现一条新画板,默认名 `未命名画板`,自动进入重命名状态
- 输入新名字 + Enter → 列表项标题更新
- 单击列表项 → CanvasView 打开,toolbar 标题显示该画板名

**失败迹象**:
- ❌ 点击 `+ 画板` 列表无反应 → 检查 `'navside:action'` 事件
- ❌ 列表项创建了但单击没反应 → 检查 `graphOpenInView` IPC
- ❌ CanvasView 显示但 toolbar 标题还是 'Canvas' → loadGraph 没跑或没同步 graphTitle

---

### Test 2:Library Picker

**步骤**:
1. 在已打开的画板里,点 toolbar 的 `+ 添加` 按钮
2. 应弹出双栏 popover:左侧分类(Basic / Arrow / Flowchart / Line / Text + Substance 类目),右侧 3-col 网格

**预期**:
- 左侧分类总数:Basic 11 / Arrow 3 / Flowchart 4 / Line 3 / Text 1 / Library 2 / Family 3 = 27 条目
- 切到 Arrow 分类 → 右侧网格显示 3 个箭头缩略图
- 顶部搜索框输入 "rect" → 跨分类显示 roundRect / rect / 等
- ESC / 点外部 → popover 关闭

**失败迹象**:
- ❌ Picker 不打开 → handleAddShape 没传 anchorRect
- ❌ 分类列表为空 → ShapeRegistry.bootstrap 没跑
- ❌ 缩略图全是空白 / 全是占位 → preview-svg.ts 出错

---

### Test 3:实例化 Shape

**步骤**:
1. 点 toolbar `+ 添加` → 选 `Rounded Rectangle`
2. 光标应变 crosshair,toolbar 下方提示 "点击画布放置 · ESC 取消"
3. 在画布空白处单击

**预期**:
- 实例化一个 roundRect(默认 160×100,以点击位置为中心)
- 自动选中(显示蓝色矩形选区线框 + 8 resize handles + 1 rotation handle)
- 光标恢复正常,提示消失
- 数据持久化:1 秒后 graphSave 应已写盘(toolbar 标题尾的 `•` 脏标记应该出现然后消失)

**失败迹象**:
- ❌ 点画布无反应 → addMode 状态没正确进入
- ❌ 形状出现但选中未自动 → placeInstance 内 setSelection 漏了
- ❌ 标题永远 `•`(脏)不消 → flushSave 失败,看 console 错误

---

### Test 4:实例化 Substance

**步骤**:
1. 点 toolbar `+ 添加` → 左栏切到 `Family` 分类 → 选 `Family Person`
2. 在画布空白处单击

**预期**:
- 实例化一个 family.person substance(roundRect frame + 2 行 label)
- frame 默认浅蓝色(gender='M' 默认 #a8c7e8 — 但 v1 props 没接通,可能显示默认 #4A90E2)

**已知限制**:
- substance 的 visual_rules(gender → 颜色)v1 没接通(M1 范围内 substance 实例的 props 没有 UI 输入)

---

### Test 5:Inspector + 选中态视觉

**步骤**:
1. **单击**一个已存在的 shape 实例 → 显示蓝色选中边框 + 8 个 resize handles(白色小圆点)+ 1 个 rotation handle(顶部上方绿色圆点),**Inspector 不弹出**
2. **双击**该节点 → 右上角应浮出 Inspector 浮层,标题 "Format Shape"
3. 改 X 字段 → Tab/Enter → mesh 应跟着移动到新 X
4. 点 Fill Color 色块 → 弹系统颜色选择器 → 选个红色 → mesh 填充色变红
5. 点 Inspector header 上的 `×` → 浮层关闭(选中边框 + handles 仍显示)
6. 拖动 Inspector header → 浮层位置改变;刷新页面后位置记忆(localStorage)

**预期**:
- 单击节点不打开 Inspector(只显示选中边框 + handles)
- 双击节点打开 Inspector
- Inspector 打开期间,切换选中其他节点 → Inspector 跟随切换显示
- 数值字段 Enter / blur 才提交(打字不会高频重渲染)
- 色块改色立即生效
- Inspector 拖动到屏幕外被 clamp 在 viewport 内
- 改完任何属性后 toolbar 标题应短暂显示 `•`(脏)然后消失

**失败迹象**:
- ❌ 单击就弹 Inspector → UX 决策没落地
- ❌ 双击不开 Inspector → onDoubleClick 没接通
- ❌ 改色后 mesh 颜色没变 → NodeRenderer.update 没跑或 mesh 重建失败
- ❌ 改完不保存 → handleInstanceUpdate 没调 scheduleSave

---

### Test 5b:Resize handles 拖动(M1.x.3)

**步骤**:
1. 选中一个 shape
2. 拖**边 handle**(N/S/E/W 4 个边中点)→ 单边缩放(只改 W 或 H)
3. 拖**角 handle**(NW/NE/SE/SW 4 个角)→ 等比缩放(锁纵横比,沿对角线投影)
4. 拖 rotation handle(顶部上方绿色圆点)→ 节点旋转
5. 按住 Shift 拖 rotation → 角度吸附到 15° 倍数

**预期**:
- 边/角 handle 拖动期间 mesh 实时更新尺寸
- rotation 拖动 mesh 围绕 bbox 中心旋转(不是左上角)
- 旋转后再拖 resize handle → 缩放在节点本地坐标系内进行(不歪扭)
- mouseup 后 1 秒持久化

**失败迹象**:
- ❌ 角 handle 拖动尺寸瞬间爆炸 → 等比公式 bug(应已修)
- ❌ 旋转后 handle 不跟随旋转 → HandlesOverlay 的 group.rotation.z 没更新
- ❌ 旋转后选中变难 → OBB hit-test 没生效

---

### Test 5c:Cmd+Z / Cmd+Shift+Z(M1.x.6)

**步骤**:
1. 添加一个 shape → Cmd+Z → shape 应消失
2. Cmd+Shift+Z(redo)→ shape 应回来
3. 拖动 shape 移动位置 → Cmd+Z → shape 回到原位
4. resize / rotate 任意操作 → Cmd+Z → 还原
5. 删除节点 → Cmd+Z → 节点恢复
6. 连续多次操作 + Cmd+Z 多次 → 应能逐步还原(上限 50 步)

**预期**:
- 每个原子操作(add / delete / drag end / resize end / rotate end / rewire)各占一步
- redo 栈在新操作时清空(标准 undo/redo 行为)
- 撤销后 1 秒持久化(回放后状态写盘)

**失败迹象**:
- ❌ Cmd+Z 在画板内无反应 → container 没拿到 keyboard focus(需先点画板)
- ❌ Cmd+Z 触发其他视图的 undo → 容器 focus 已对,但 keydown 监听器位置错

---

### Test 6:拖动节点 + Line 自动跟随(§2.1 第 14 项)

**步骤**:
1. 在画板上添加两个 shape(A 在左,B 在右)
2. 通过 Test 15 的步骤创建一条 line 连 A→B
3. 单击 A,拖动它

**预期**:
- A 跟随鼠标
- 连接 A 的 line 实时跟随,端点保持在 A 的 magnet 位置
- 多选(Shift-click)A + B + 拖动 → 一起移动,line 跟随

**失败迹象**:
- ❌ 拖动节点 line 不跟随 → updateLinesFor 没在 mousemove 时调用
- ❌ Line 跟随但卡顿 → updateLineGeometry 应该是增量顶点更新,如果重建 mesh 会卡

---

### Test 7:Delete 删除

**步骤**:
1. 单击一个 shape 节点
2. 按 Delete 或 Backspace
3. 同样测一条 line(单击 line 选中 → Delete)

**预期**:
- 节点消失
- 引用该节点的 line 也消失(级联删除)
- 选区清空,Inspector 隐藏
- line 单独删 → 仅 line 消失,两端 shape 保留

**失败迹象**:
- ❌ 按 Del 无反应 → 容器没获得键盘焦点(检查 tabIndex)
- ❌ 节点消失但 line 还在 → NodeRenderer.remove 的 orphans 级联逻辑出错

---

### Test 8:滚轮 + 平移

**步骤**:
1. 在画布上滚轮向上 → 放大
2. 滚轮向下 → 缩小
3. 滚轮在某节点上 → 应以该节点为中心缩放(zoom-to-cursor)
4. 在画布空白处按住鼠标 + 拖动 → 平移

**预期**:
- toolbar 显示 zoom 百分比(基线 100%)
- zoom 在 50/0.05 倍上下界 clamp(滚到极限不再变)
- 平移流畅,松手不漂移

**失败迹象**:
- ❌ 滚轮触发浏览器历史导航(macOS 双指)→ wheel listener `passive: false` 没生效
- ❌ Zoom 中心不在光标 → handleWheel 内 zoom-to-cursor 数学错

---

### Test 9:重启恢复(§2.1 第 11 项核心)

**步骤**:
1. 创建一个新画板 + 添加 3 个 shape + 2 条 line(连接它们)+ 1 个 substance
2. 改其中一个 shape 的颜色
3. 旋转其中一个 shape 一定角度
4. 等 2 秒(让 1s 防抖 save 完)
5. 关闭整个应用(Cmd+Q)
6. 重新启动 → 切到 Graph workMode
7. NavSide 应仍能看到刚创建的画板
8. 单击它

**预期**:
- 画板内容完整恢复:所有节点位置 / 大小 / 颜色 / params / **rotation** 都对
- line endpoints 正确,两端绑回原 shape 的原 magnet
- 视口 / 缩放 / 平移状态恢复(view 序列化保存)
- toolbar 标题对应

**失败迹象**:
- ❌ 重启后画板不在列表 → graphCreate / graphStore 没真正写盘
- ❌ 画板在但内容空 → graphSave 没在 1s 防抖期写完(关应用太快),或 doc_content 序列化丢
- ❌ 内容部分恢复(比如 line 没跟随)→ user_substances 字段或 deserialize 有 bug
- ❌ 加载后画布"蓝屏"(整画布被一个巨大 mesh 覆盖) → 历史脏数据 size 异常,sanitize 阈值不够紧

**这是 M1 最关键的验收项**。

---

### Test 10:Combine to Substance(§2.1 第 12 项)

**步骤**:
1. 在画布上添加 3 个 shape(roundRect + diamond + ellipse)
2. Shift-click 它们多选(应都显示蓝色选区)
3. Toolbar 右侧应 inline 出现 `[⊟ Combine to Substance]` 按钮
4. 点击 → 弹模态对话框 "Create Substance"
5. 输入 Name = "测试 Substance",Category 用默认 user
6. 点 Create

**预期**:
- 对话框关闭
- 画布上原 3 个 shape **替换为一个 substance 实例**(放在原 bbox 中心)
- Library Picker 的 Substances → User 分类下应能看到 "测试 Substance"
- 1 秒后自动持久化(`•` 出现再消失)

**已知限制**:
- ⚠️ user substance 通过 `user_substances` 字段嵌入画板 doc_content(M1 范围)
- ⚠️ **跨画板共享 user substance v1 不支持**(其他画板的 LibraryPicker 看不到,需要重启应用 + 重打开同一画板)— 这是 M1 范围 trade-off,M2 之前应升级

---

### Test 11:NavSide 文件夹

**步骤**:
1. NavSide 点 `+ 文件夹` → 创建新文件夹,自动重命名
2. 输入 "Test Folder" + Enter
3. 拖一个画板到文件夹上 → 画板移入
4. 点击文件夹展开图标 → 看到画板
5. 右键文件夹 → "新建画板 / 在此新建文件夹 / 重命名 / 删除"
6. 删除文件夹 → 子画板回到根级(folder_id 置 null)

**预期**:
- 文件夹增删改 + 拖拽全部正常
- 右键菜单完整

---

### Test 15:创建 line 连接(M1.x.7,§2.1 第 15 项)

**步骤**:
1. 在画布添加两个 shape(A 在左,B 在右)
2. Toolbar `+ 添加` → 选 line 类目下任一 line(`Straight` / `Elbow` / `Curved`)
3. 光标变 crosshair,提示 "点击画布放置"
4. 鼠标 hover 进入 A → A 应显示 4 个蓝色 magnet 点(N/S/E/W)
5. 在 A 的某个 magnet 上 mousedown(必须在 16px 半径内)
6. 拖动鼠标 → 预览 line 跟随,所有候选 shape 显示 magnet 蓝点
7. mouseup 在 B 的某个 magnet 上 → 创建 line,自动选中

**预期**:
- 创建的 line 两端绑定 magnet,移动 A / B 时端点跟随
- 落空(没命中 magnet)→ line 不创建,addMode 退出(不留悬空 line)
- ESC 中途取消 → 不创建

**失败迹象**:
- ❌ hover 不显 magnet 蓝点 → magnet hint overlay 未触发
- ❌ mousedown 在 magnet 上不起手 → findClosestMagnet 半径计算错
- ❌ 创建后 line 端点不跟 shape 移动 → endpoints 字段没正确写入

---

### Test 16:Rewire — 拖端点重连(M1.x.7b,§2.1 第 16 项)

**步骤**:
1. 沿用 Test 15 创建的 line
2. 单击 line 选中 → line 高亮 + 两端各显示一个深蓝色端点 handle
3. 鼠标 hover 端点 → 端点能稳定点中(不被 shape 抢)
4. 在某端点 handle 上 mousedown,拖动鼠标
5. line 该端跟随鼠标实时移动(吸附附近 magnet)
6. mouseup 在另一 magnet 上 → 端点重新绑定

**预期**:
- 选中 line 时**不显** 8 resize handles 和 rotation handle(line 没这些语义)
- hover line 时 line 颜色变亮(`#4A90E2`),提示可点
- 端点 handle 拖动期间 line 实时跟随鼠标
- 落空(没命中 magnet)→ 端点还原到原 magnet(不留悬空)
- ESC 中途取消 → 还原

**失败迹象**:
- ❌ 选中 line 仍显 8 resize handles → CanvasView.onSelectionChange 没过滤 line
- ❌ hover 端点 cursor 仍是 grab(说明命中 shape 而非端点) → endpoint hit-test 优先级或半径错
- ❌ 拖端点 line 不跟手 → updateRewire 没正确改 line 几何 buffer

---

### Test 17:旋转 shape 后 line 端点跟随(M1.x.5,§2.1 第 17 项)

**步骤**:
1. 沿用前面创建的 A→B line
2. 单击 A,拖 rotation handle 转 30°
3. 观察 line 端点

**预期**:
- A 的 magnet 跟随旋转(N/S/E/W 4 点绕 bbox 中心转 30°)
- line 在 A 端的端点跟着 magnet 移动到旋转后的位置
- B 端不动(因为没转 B)

**失败迹象**:
- ❌ A 旋转后 magnet 仍在原位 → magnet-snap 的 magnetToWorld 没考虑 rotation
- ❌ line 端点不跟 magnet → updateLinesFor 没在 rotation 期间触发

---

## 已知 M1 范围限制

下列功能不在 M1,**测试时遇到不算 bug**:
- **right-slot 调用方式(canvasAPI)** — M1.6 完成后(暂跳过项 13)
- **substance props 编辑**(label / gender / birth / death)— v1.1
- **Inspector Arrow / dash / 透明度** — v1.1
- **跨画板共享 user substance** — M2 之前
- **框选(drag-select)** — v1.1
- **Cmd+C/V 复制粘贴** — v1.1
- **line 选中视觉高亮**(line 自身加粗 / 变色,目前只 hover 高亮)— v1.1
- **line 路径中段编辑**(elbow 中段拖动 / curved 控制点)— v1.1

## M1.x UX 决策(已落实到 spec)

- **Toolbar 添加按钮**:`+ Shape` / `◇ Substance` 合并为单一 `+ 添加`(SVG 图标),
  Picker 内 Shape/Substance 类目平铺;不再向用户暴露内部架构区分
- **撤销/重做没占位按钮**:Cmd+Z / Cmd+Shift+Z 快捷键直接接通,Toolbar 不预留
- **Inspector 默认隐藏**:单击节点只显示选中边框 + handles,**双击才打开 Inspector**
- **Resize/Rotation handles 完整接通**(对齐 macOS Freeform):8 resize + 1 rotation,
  角 handle 等比缩放、边 handle 单边缩放,Shift+rotation 吸附 15°
- **OBB hit-test**:旋转节点也能精确点中
- **line 端点视觉**:line 选中只显 2 端点 handle(非 8 resize),端点拖动 = rewire

---

## 测试报告(填写区)

| Test | 结果 | 备注 |
|---|---|---|
| 1 NavSide + 画板 | ⬜ | |
| 2 Library Picker | ⬜ | |
| 3 实例化 Shape | ⬜ | |
| 4 实例化 Substance | ⬜ | |
| 5 Inspector 改属性 | ⬜ | |
| 5b Resize/Rotate handles | ⬜ | |
| 5c Cmd+Z/Cmd+Shift+Z | ⬜ | |
| 6 拖动 + Line 跟随 | ⬜ | |
| 7 Delete | ⬜ | |
| 8 滚轮 + 平移 | ⬜ | |
| 9 重启恢复 | ⬜ | |
| 10 Combine | ⬜ | |
| 11 NavSide 文件夹 | ⬜ | |
| 15 创建 line 连接 | ⬜ | |
| 16 Rewire 拖端点重连 | ⬜ | |
| 17 旋转后 line 端点跟随 | ⬜ | |

**整体结论**:____________

**阻塞 M1 合并的 bug**(必修):
1.
2.

**可留 v1.x 的小问题**:
1.
2.
