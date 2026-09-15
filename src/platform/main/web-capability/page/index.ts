/**
 * `web.page` —— Web 能力层的「控制」能力(页面对象化 + 身份 + 查找 + 状态 + 动作)。
 *
 * 步 1 交付:纯逻辑核心,零 Electron 依赖,可完全单测。
 *
 * ⭐ 2026-09-14 补:`ready` / `scrollUntil` 上公开面(`01-contract.md` §15.1 第 3 条)。
 * 此前它们写完了、有测试,但 `control.ts` **压根没被本文件导出** ——
 * 能力建好了却不在包的公开面上,X 想调也调不到。这是 X 接线的物理前提。
 */
export * from './types';
export * from './web-page';
export { PageRegistry } from './page-registry';

/**
 * ⭐ 控制动作引擎(`ready` / `scrollUntil`)。
 *
 * ⚠️ **不用 `export *`** —— `control-types.ts` 会与上面两行撞名,撞法有两种:
 *  1. `ReadyCriterion`:`web-page.ts` 那份是不透明 brand 串,
 *     `control-types.ts` 那份是**四分支判别联合**(含 `anchorGone`)。**两份不等价。**
 *  2. `AnchorName` / `ScriptId`:真源在 `dom/types.ts`,`control-types.ts` 只是转出;
 *     从这里再转一次会变成同名双路径。
 *
 * ⚠️ 故 `ReadyCriterion` 在此**故意不转出**,避免「导出了哪一份」靠运气。
 * 要用判别联合那份,显式写 `import type { ReadyCriterion } from '.../page/control-types'`。
 *
 * ⚠️ **两个 `ready` 签名不一致这件事本身没有在这一步解决**
 * (`WebPage.ready` 返 `Result<PageFacts>` 且判据是串;`ControlEngine.ready` 返 `Result<void>`
 *  且判据是联合)。`WebPage` 目前**零实现者、零引用**,是一份未兑现的声明;
 * 真要合并,是**设计决定**(要么让接口降级成串、丢掉 `anchorGone`,
 * 要么改写这份没人用的接口)——按 §15.1 同款裁定「这是设计,不是接线」,
 * 留给接线时连同 `goto` / `prepare` 一起定,不在本步偷偷选一个。
 */
export {
  ControlEngine,
  DEFAULT_READY_TIMEOUT_MS,
  READY_POLL_MS,
  DEFAULT_STUCK_ROUNDS,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_SETTLE_MS,
  STEP_RATIO_MIN,
  STEP_RATIO_MAX,
} from './control';
export type { ControlHost, AnchorResolver, CustomScriptSource } from './control';
export type {
  ScrollStop,
  ScrollOptions,
  ScrollReport,
  RoundTrace,
  /**
   * ⭐ `goto` 的三件套(2026-09-15 落地)。
   *
   * ⚠️ 必须上公开面 —— `ready`/`scrollUntil` 当初正是写完了没导出,
   * 「能力建好了却调不到」躺了 5 天(§15.1 第 3 条)。同一个坑不踩第二次。
   *
   * ⚠️ `PageTarget` 用的是**契约 §9.3 那份判别联合**,
   * 与 `web-page.ts` 里那份 branded 串**不等价**(用户 2026-09-15 拍板用前者)。
   * 故此处从 `control-types` 转出;`web-page.ts` 那份已无引用。
   */
  PageTarget,
  PageResolver,
  GotoReport,
} from './control-types';
