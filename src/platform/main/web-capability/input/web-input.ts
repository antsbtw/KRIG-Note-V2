/**
 * `web.input` 对外接口 + 纯逻辑引擎(`01-contract.md` §10.3)
 *
 * ⭐ 与 `web.page` / `web.net` / `web.dom` 同构:**能力层是纯逻辑,零 Electron**。
 * 真正碰 `clipboard` / CDP 的地方只有 `wiring/electron-input.ts` 一个文件
 * —— 于是「往页面里塞了什么」这件事**有且只有一个地方**可查、可守。
 *
 * ── 「收编」的方式:搬移,不是包装 ──
 * `web-service-base/webview-input.ts` 直接 `import { clipboard, WebContents } from 'electron'`。
 * 若新层去**调用**它,electron 就被拖进能力层,当场撞上既有守卫
 * `page-boundary-guard.test.ts`「除 wiring/ 外零处 Electron」。
 * 故把**逻辑**搬进本层(纯字符串 + 纯编排),把**Electron 那一截**放进 wiring。
 * ⚠️ 旧文件**一个字都没改**,三家消费者照常跑。
 *
 * ── 本层不做的判断(§2 边界)──
 * 🚦 `tap` 不分等级、不设危险词表、**不拒绝任何目标**。
 * 发布闸门(§7.1)是**业务层**的事 —— 现有 `tests/x/reply-planner-guards.test.ts`
 * 守的就是那一层,不在这里重复实现。
 */

import { type Failed, type Ok, type Result, failed, ok } from '../result';
import type { PageId } from '../page/types';
import type {
  FeedInput,
  FocusInput,
  HoverInput,
  InputScope,
  LandingCheck,
  LandingReport,
  LandingVia,
  PressInput,
  ScopeResolution,
  TapInput,
  TapReport,
  TypeInput,
} from './types';
import {
  SCOPE_AMBIGUOUS,
  SCOPE_NOT_FOUND,
  buildAnchorExistsScript,
  buildContainsScript,
  buildDirectWriteScript,
  buildExactScript,
  buildFocusScript,
  buildHoverScript,
  buildPressScript,
  buildSyntheticPasteScript,
  buildTapScript,
  landingNeedle,
} from './input-scripts';

/** 等 settle 判据的默认超时。给到 4s —— 与现有模态开关判据用的 4000ms 一致 */
export const DEFAULT_SETTLE_MS = 4000;
/** 落地校验的默认超时(图片缩略图秒级)。视频转码由调用方传 `timeoutMs` 覆盖 */
export const DEFAULT_LANDING_MS = 10_000;
/** 合成 paste 后等框重渲染(DraftJS state update,实测 ~300ms 足够) */
export const PASTE_SETTLE_MS = 300;
/** OS Cmd+V 兜底后等 native paste 被消费 */
export const OS_PASTE_SETTLE_MS = 400;
/** JS 直写兜底后等框重渲染 */
export const DIRECT_WRITE_SETTLE_MS = 200;

/**
 * 宿主接缝 —— 能力层通过它做三件真实的事,**自己不认识任何 Electron 类型**。
 *
 * ⚠️ 命名刻意避开 `webContents` / `WebContents`:那两个词是既有守卫
 * `page-boundary-guard` 在本层的禁词(不变量 3:应用只见页面对象)。
 * 这不是绕过守卫 —— 恰恰相反,这个接口**就是**守卫要的那层隔断:
 * 能力层拿到的是「能执行脚本的东西」,不是「一个 webContents」。
 */
export interface InputHost {
  /** 在页面上下文里求值一段脚本。失败**必须抛**,不许返 undefined 假装成功 */
  evaluate(pageId: PageId, script: string): Promise<unknown>;
  /** OS 级粘贴兜底:把文本写进系统剪贴板并发 Cmd+V / Ctrl+V,用完还原剪贴板 */
  osPaste?(pageId: PageId, text: string): Promise<void>;
  /** 把磁盘文件喂进 `<input type=file>`(CDP `DOM.setFileInputFiles`) */
  setFileInputFiles?(pageId: PageId, selector: string, files: readonly string[]): Promise<void>;
  /** 可注入的时钟,便于单测跑轮询而不真等 */
  sleep?(ms: number): Promise<void>;
}

/**
 * 锚点解释器 —— adapter 的活(§14):把语义锚点名翻译成 selector。
 *
 * ⚠️ **底座不认识任何 selector**。解释不出来要 fail loud:
 * 返 undefined 会让「锚点名打错了」表现为「查了个空 selector,什么也没找到」——
 * 那是静默失聪的又一种形态。
 */
export interface AnchorResolver {
  /** 解释不出来返回 null(调用方据此 Failed),**不返回空串** */
  resolve(anchor: string): string | null;
}

/** `web.input` 六个动作(§10.3)*/
export interface WebInput {
  focus(pageId: PageId, input: FocusInput): Promise<Result<void>>;
  type(pageId: PageId, input: TypeInput): Promise<Result<LandingReport>>;
  feed(pageId: PageId, input: FeedInput): Promise<Result<LandingReport>>;
  tap(pageId: PageId, input: TapInput): Promise<Result<TapReport>>;
  press(pageId: PageId, input: PressInput): Promise<Result<void>>;
  hover(pageId: PageId, input: HoverInput): Promise<Result<void>>;
}

/** 没校验时的报告 —— ⚠️ `landed` 恒 false,`via` 恒 'unchecked' */
function uncheckedReport(attempts: number): LandingReport {
  return { checked: false, landed: false, via: 'unchecked', attempts };
}

export class InputEngine implements WebInput {
  constructor(
    private readonly host: InputHost,
    private readonly anchors: AnchorResolver,
  ) {}

  private sleep(ms: number): Promise<void> {
    if (this.host.sleep) return this.host.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 解析作用域 → 容器 selector。
   *
   * `main` → 空串(脚本里退成 `document`)。
   * `frame` → ⚠️ **本轮不实现**,明确 Failed(§10.5)—— 不静默当成 main,
   * 否则「往 iframe 里填」会悄悄填到主文档去。
   */
  private resolveScope(scope: InputScope | undefined): Ok<string> | Failed {
    if (!scope || scope.kind === 'main') return ok('');
    if (scope.kind === 'frame') {
      return failed(
        `web.input 本轮不支持 frame 作用域(frameId=${scope.frameId});` +
          `需先给 web.page 补 frames()。见 01-contract.md §10.5`,
        false,
      );
    }
    const sel = this.anchors.resolve(scope.container);
    if (!sel) {
      return failed(`容器锚点 ${scope.container} 无法解释成 selector(adapter 没登记?)`, false);
    }
    return ok(sel);
  }

  private resolveAnchor(anchor: string): Ok<string> | Failed {
    const sel = this.anchors.resolve(anchor);
    if (!sel) return failed(`锚点 ${anchor} 无法解释成 selector(adapter 没登记?)`, false);
    return ok(sel);
  }

  /**
   * 跑一段脚本,并把作用域失败标记翻成 `ScopeResolution`。
   *
   * ⚠️ 这是 `ambiguous` **不被静默吞掉**的收口处:脚本返回标记串,
   * 这里翻成明确失败,绝不当成「没找到 → 返回 false」混过去。
   */
  private async evalScoped(
    pageId: PageId,
    script: string,
    scopeDesc: string,
  ): Promise<Ok<unknown> | Failed> {
    let raw: unknown;
    try {
      raw = await this.host.evaluate(pageId, script);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failed(`脚本执行失败: ${message}`, true);
    }
    if (raw === SCOPE_AMBIGUOUS) {
      const res: ScopeResolution = {
        ok: false,
        reason: 'ambiguous',
        detail: `作用域容器 ${scopeDesc} 命中多个元素`,
      };
      // ⭐ 不挑第一个 —— 与 web.page 的 find 同源(§10.1)
      return failed(`${res.detail};底座不替调用方挑,请把容器锚点收窄`, false);
    }
    if (raw === SCOPE_NOT_FOUND) {
      return failed(`作用域容器 ${scopeDesc} 在页面上不存在`, true);
    }
    return ok(raw);
  }

  async focus(pageId: PageId, input: FocusInput): Promise<Result<void>> {
    const scope = this.resolveScope(input.scope);
    if (scope.status !== 'ok') return scope;
    const anchor = this.resolveAnchor(input.anchor);
    if (anchor.status !== 'ok') return anchor;

    const r = await this.evalScoped(
      pageId,
      buildFocusScript(anchor.value, scope.value),
      describeScope(input.scope),
    );
    if (r.status !== 'ok') return r;
    if (r.value !== true) return failed(`输入框 ${input.anchor} 未找到,无法 focus`, true);
    return ok(undefined);
  }

  /**
   * 把文本**真的**放进框里,并按 `check` 确认落地。
   *
   * 三级路径(收编现有实现,顺序不变):
   *   1. 合成 paste(主路径,穿透 webview 焦点隔离 + DraftJS 认它)
   *   2. OS 级 Cmd+V(普通 input 焦点态下才需要)
   *   3. JS 直写(execCommand / native value setter)
   *
   * ⭐ 每级之后都校验;**`via` 如实记录成功的是哪一级**,
   * `attempts` 记试了几级 —— 主路径失效是站点改版的早期信号(§10.2)。
   */
  async type(pageId: PageId, input: TypeInput): Promise<Result<LandingReport>> {
    const scope = this.resolveScope(input.scope);
    if (scope.status !== 'ok') return scope;
    const anchor = this.resolveAnchor(input.anchor);
    if (anchor.status !== 'ok') return anchor;
    const scopeDesc = describeScope(input.scope);

    // 先 focus —— 三条路径都要求焦点在框上。
    // ⚠️ 只转述失败原因,不把 focus 的结果整个透传:两者的值类型不同,
    //    硬透传会逼 LandingReport 接一个 void 值,那是类型层面的谎。
    const focused = await this.focus(pageId, { anchor: input.anchor, scope: input.scope });
    if (focused.status === 'failed') return focused;

    let attempts = 0;

    // ── 路径 1:合成 paste(主路径)──
    attempts += 1;
    const pasted = await this.evalScoped(
      pageId,
      buildSyntheticPasteScript(anchor.value, input.text, input.html ?? '', scope.value),
      scopeDesc,
    );
    if (pasted.status !== 'ok') return pasted;

    // ⚠️ check:none 时**到此为止**,如实报「没校验」——
    //    不许继续兜底(兜底的判据就是校验,没有校验就无从知道要不要兜),
    //    更不许把「没看」说成「成了」。
    if (input.check.kind === 'none') {
      return ok(uncheckedReport(attempts));
    }

    await this.sleep(PASTE_SETTLE_MS);
    const landed1 = await this.verify(pageId, input.check, anchor.value, input.text, scope.value, scopeDesc, 0);
    if (landed1.status !== 'ok') return landed1;
    if (landed1.value) return ok({ checked: true, landed: true, via: 'synthetic-paste', attempts });

    // ── 路径 2:OS 级 Cmd+V ──
    if (this.host.osPaste) {
      attempts += 1;
      try {
        await this.host.osPaste(pageId, input.text);
      } catch (err) {
        return failed(`OS 粘贴兜底失败: ${err instanceof Error ? err.message : String(err)}`, true);
      }
      await this.sleep(OS_PASTE_SETTLE_MS);
      const landed2 = await this.verify(pageId, input.check, anchor.value, input.text, scope.value, scopeDesc, 0);
      if (landed2.status !== 'ok') return landed2;
      if (landed2.value) return ok({ checked: true, landed: true, via: 'os-paste', attempts });
    }

    // ── 路径 3:JS 直写 ──
    attempts += 1;
    const direct = await this.evalScoped(
      pageId,
      buildDirectWriteScript(anchor.value, input.text, scope.value),
      scopeDesc,
    );
    if (direct.status !== 'ok') return direct;
    // ⭐ 脚本返回走的是哪一支 —— via 据此如实标注,不猜
    const via: LandingVia = direct.value === 'native-setter' ? 'native-setter' : 'exec-command';
    if (direct.value !== 'native-setter' && direct.value !== 'exec-command') {
      return failed(`输入框 ${input.anchor} 既非 input/textarea 也非 contenteditable,无法写入`, false);
    }
    await this.sleep(DIRECT_WRITE_SETTLE_MS);
    const landed3 = await this.verify(pageId, input.check, anchor.value, input.text, scope.value, scopeDesc, 0);
    if (landed3.status !== 'ok') return landed3;
    if (landed3.value) return ok({ checked: true, landed: true, via, attempts });

    // ⚠️ 三级路径都没落地 —— **明确 Failed**,绝不返回「Ok 但 landed:false」。
    //    「填了没进去」在业务上就是失败,当 Ok 会让调用方继续往下走(点发布/标已回复)。
    return failed(
      `内容未落进 ${input.anchor}(三级路径全试过,共 ${attempts} 次)`,
      true,
    );
  }

  /**
   * 把真实磁盘文件喂给上传控件,并按 `check` 确认「对方真接住了」。
   *
   * ⚠️ 图和视频的判据不同:图是「缩略图出现」(秒级),视频是「转码完成」(60s+)。
   * 同一个 `check:{kind:'anchorAppears'}` 表达,**由调用方给不同锚点和 timeoutMs**
   * —— 底座不内置这个差别(§10.3)。
   */
  async feed(pageId: PageId, input: FeedInput): Promise<Result<LandingReport>> {
    if (input.files.length === 0) {
      // fail loud:喂零个文件不是「成功地什么也没喂」,是调用方算错了
      return failed('feed 收到空文件列表', false);
    }
    if (!this.host.setFileInputFiles) {
      return failed('当前宿主不支持喂文件(未接 CDP DOM.setFileInputFiles)', false);
    }
    const scope = this.resolveScope(input.scope);
    if (scope.status !== 'ok') return scope;
    const anchor = this.resolveAnchor(input.anchor);
    if (anchor.status !== 'ok') return anchor;
    const scopeDesc = describeScope(input.scope);

    // 1. 先确认上传控件在场 —— 找不到就别喂(现有实现同款前置检查)
    const present = await this.evalScoped(
      pageId,
      buildAnchorExistsScript(anchor.value, scope.value),
      scopeDesc,
    );
    if (present.status !== 'ok') return present;
    if (present.value !== true) {
      return failed(`未能定位文件上传控件 ${input.anchor}(站点改版 / 锚点失效?)`, true);
    }

    // 2. 喂文件
    try {
      await this.host.setFileInputFiles(pageId, anchor.value, input.files);
    } catch (err) {
      return failed(`喂文件失败: ${err instanceof Error ? err.message : String(err)}`, true);
    }

    if (input.check.kind === 'none') {
      return ok(uncheckedReport(1));
    }

    // 3. 校验「真接住了」。poll 到 timeout —— 视频转码要等很久,故超时由调用方给
    const landed = await this.verify(
      pageId,
      input.check,
      anchor.value,
      '',
      scope.value,
      scopeDesc,
      input.timeoutMs ?? DEFAULT_LANDING_MS,
    );
    if (landed.status !== 'ok') return landed;
    if (!landed.value) {
      return failed(
        // ⚠️ 只说事实,不猜原因,更不写站点语义(「转码超时」是 X 的知识,不是底座的)。
        // 那次转义事故烧一整天,一半原因就是 catch 里写着「多半撞上导航」——
        // **一句猜测被当成了结论**。
        `喂了 ${input.files.length} 个文件,但落地判据在 ${input.timeoutMs ?? DEFAULT_LANDING_MS}ms 内未满足`,
        true,
      );
    }
    // 文件路径走 CDP 设进去,不经 paste —— via 记 'native-setter'(直接设值那一类)
    return ok({ checked: true, landed: true, via: 'native-setter', attempts: 1 });
  }

  /**
   * 🚦 点一下。**中立原语 —— 不拒绝任何目标**(§10.3)。
   *
   * ⭐ `settle` 把「点完等什么」放进模型:某 step 中途失败(模态没关)→
   * 下一 step 在脏态上启动 → 连环失败。给了 settle 才可能 `settled:true`。
   */
  async tap(pageId: PageId, input: TapInput): Promise<Result<TapReport>> {
    const scope = this.resolveScope(input.scope);
    if (scope.status !== 'ok') return scope;
    const anchor = this.resolveAnchor(input.anchor);
    if (anchor.status !== 'ok') return anchor;
    const scopeDesc = describeScope(input.scope);

    const clicked = await this.evalScoped(
      pageId,
      buildTapScript(anchor.value, scope.value),
      scopeDesc,
    );
    if (clicked.status !== 'ok') return clicked;
    if (clicked.value !== true) return failed(`未找到可点的 ${input.anchor}`, true);

    if (!input.settle) {
      // 没给 settle → 如实说「没等」,不谎称 settled
      return ok({ settled: false, waited: false });
    }

    const settled = await this.waitSettle(pageId, input.settle, scope.value, scopeDesc);
    if (settled.status !== 'ok') return settled;
    if (!settled.value) {
      // ⚠️ 点到了但 settle 没满足 —— 这是**部分成功**,当 Ok 会让下一步在脏态上启动。
      //    用 Degraded 如实说:点是点了,但等的那件事没发生。
      return {
        status: 'degraded',
        value: { settled: false, waited: true },
        missing: [describeSettle(input.settle)],
      };
    }
    return ok({ settled: true, waited: true });
  }

  async press(pageId: PageId, input: PressInput): Promise<Result<void>> {
    const scope = this.resolveScope(input.scope);
    if (scope.status !== 'ok') return scope;
    const r = await this.evalScoped(
      pageId,
      buildPressScript(input.key, scope.value),
      describeScope(input.scope),
    );
    if (r.status !== 'ok') return r;
    if (r.value !== true) return failed(`按键 ${input.key} 未能派发(没有可接收的目标)`, true);
    return ok(undefined);
  }

  async hover(pageId: PageId, input: HoverInput): Promise<Result<void>> {
    const scope = this.resolveScope(input.scope);
    if (scope.status !== 'ok') return scope;
    const anchor = this.resolveAnchor(input.anchor);
    if (anchor.status !== 'ok') return anchor;
    const r = await this.evalScoped(
      pageId,
      buildHoverScript(anchor.value, scope.value),
      describeScope(input.scope),
    );
    if (r.status !== 'ok') return r;
    if (r.value !== true) return failed(`未找到可 hover 的 ${input.anchor}`, true);
    return ok(undefined);
  }

  /**
   * 跑一次落地校验。`timeoutMs > 0` 时 poll 到超时(喂文件用);0 表示只查一次。
   *
   * ⚠️ 返回的是 `Result<boolean>`:**「校验没跑成」和「跑了没落地」是两回事** ——
   * 前者是 Failed(脚本炸了/容器 ambiguous),后者是 ok(false)。
   * 混成一个 false 就分不清「站点改版」和「内容没进去」。
   */
  private async verify(
    pageId: PageId,
    check: LandingCheck,
    anchorSelector: string,
    text: string,
    containerSelector: string,
    scopeDesc: string,
    timeoutMs: number,
  ): Promise<Ok<boolean> | Failed> {
    const script = this.buildCheckScript(check, anchorSelector, text, containerSelector);
    if (script.status !== 'ok') return script;

    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
    for (;;) {
      const r = await this.evalScoped(pageId, script.value, scopeDesc);
      if (r.status !== 'ok') return r;
      if (r.value === true) return ok(true);
      if (deadline === 0 || Date.now() >= deadline) return ok(false);
      await this.sleep(250);
    }
  }

  private buildCheckScript(
    check: LandingCheck,
    anchorSelector: string,
    text: string,
    containerSelector: string,
  ): Ok<string> | Failed {
    switch (check.kind) {
      case 'none':
        // 调用方已在上游分流;走到这里说明编排错了,fail loud 而不是返个恒真脚本
        return failed('check:none 不该走到校验(调用路径错了)', false);
      case 'contains':
        return ok(buildContainsScript(anchorSelector, check.fragment, containerSelector));
      case 'exact':
        return ok(buildExactScript(anchorSelector, text, containerSelector));
      case 'anchorAppears': {
        const sel = this.anchors.resolve(check.anchor);
        if (!sel) return failed(`落地判据锚点 ${check.anchor} 无法解释成 selector`, false);
        return ok(buildAnchorExistsScript(sel, containerSelector));
      }
      case 'custom':
        // 预注册脚本走 web.dom 的注册表;本层不接受脚本字符串,也不自己维护一份注册表。
        // 接线时由 wiring 把它转成 domRunner.run(scriptId) —— 本轮无消费者,明确未实现。
        return failed(
          `check:custom(${check.script})本轮未实现:预注册脚本执行属 web.dom,` +
            `需接线层把 ScriptId 转给 domRunner。见 01-contract.md §11`,
          false,
        );
    }
  }

  /** 等 settle 判据。`anchorGone` / `anchorAppears` 都给了就要**都满足** */
  private async waitSettle(
    pageId: PageId,
    settle: NonNullable<TapInput['settle']>,
    containerSelector: string,
    scopeDesc: string,
  ): Promise<Ok<boolean> | Failed> {
    if (settle.anchorGone === undefined && settle.anchorAppears === undefined) {
      // fail loud:给了空 settle 对象等于什么也没说,却会让 settled 恒 false 让人困惑
      return failed('settle 必须至少给 anchorGone 或 anchorAppears 之一', false);
    }
    const goneSel = settle.anchorGone ? this.anchors.resolve(settle.anchorGone) : null;
    if (settle.anchorGone && !goneSel) {
      return failed(`settle 锚点 ${settle.anchorGone} 无法解释成 selector`, false);
    }
    const appearSel = settle.anchorAppears ? this.anchors.resolve(settle.anchorAppears) : null;
    if (settle.anchorAppears && !appearSel) {
      return failed(`settle 锚点 ${settle.anchorAppears} 无法解释成 selector`, false);
    }

    const deadline = Date.now() + (settle.timeoutMs ?? DEFAULT_SETTLE_MS);
    for (;;) {
      let allMet = true;
      if (goneSel) {
        const r = await this.evalScoped(pageId, buildAnchorExistsScript(goneSel, containerSelector), scopeDesc);
        if (r.status !== 'ok') return r;
        if (r.value === true) allMet = false;
      }
      if (allMet && appearSel) {
        const r = await this.evalScoped(pageId, buildAnchorExistsScript(appearSel, containerSelector), scopeDesc);
        if (r.status !== 'ok') return r;
        if (r.value !== true) allMet = false;
      }
      if (allMet) return ok(true);
      if (Date.now() >= deadline) return ok(false);
      await this.sleep(250);
    }
  }
}

function describeScope(scope: InputScope | undefined): string {
  if (!scope || scope.kind === 'main') return 'main';
  if (scope.kind === 'frame') return `frame:${scope.frameId}`;
  return `within:${scope.container}`;
}

function describeSettle(settle: NonNullable<TapInput['settle']>): string {
  const parts: string[] = [];
  if (settle.anchorGone) parts.push(`anchorGone:${settle.anchorGone}`);
  if (settle.anchorAppears) parts.push(`anchorAppears:${settle.anchorAppears}`);
  return parts.join(' + ');
}
