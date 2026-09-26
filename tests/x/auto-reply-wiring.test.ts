/**
 * ⭐⭐ **自动回复开关接线** —— 用户 2026-09-26 的第 ⑥ 步。
 *
 * ⚠️ 闸门写好了但**没人调**，等于没做 —— 本仓踩过同形的坑
 * (`listPendingDrafts` 全仓零调用方，草稿落了库却没地方看)。
 * ⚠️ 开关在库里但**面板上点不到**，同样等于没做
 * (记忆 feedback-guard-must-pin-live-code:守卫钉在进不去的分支上全绿)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const HANDLERS = strip(read('src/platform/main/x/x-timeline-handlers.ts'));
const CAPS = read('src/platform/main/x/x-flow-capabilities.ts');
const VIEW = read('src/views/x-inbox/XInboxView.tsx');
const REPO = strip(read('src/platform/main/db/search-recipe-repo.ts'));

describe('⭐⭐ 闸门真的被调用了（不是写了没人用）', () => {
  it('⭐⭐ 拟回复时过闸门', () => {
    expect(HANDLERS, '闸门没人调 —— 开关打开也不会有任何效果')
      .toMatch(/canAutoReply\(/);
  });

  it('⭐⭐ 按**配方**判 —— recipeId 要真的传进去', () => {
    /**
     * ⭐ 这是「按配方而非全局」的接线证据:
     * 不传 recipeId 的话闸门会一律判 no_recipe，开关等于永远不生效。
     */
    const i = HANDLERS.indexOf('canAutoReply(');
    expect(i, '找不到闸门调用').toBeGreaterThan(0);
    const blk = HANDLERS.slice(i, i + 500);
    expect(blk, '没传 recipeId —— 闸门会一律判 no_recipe').toMatch(/recipeId:/);
    expect(
      HANDLERS,
      '没从推文行上取 search_recipe —— 不知道这条是哪个配方采的',
    ).toMatch(/search_recipe/);
  });

  it('⭐⭐ 校验用草稿正文里的真链接，不另拼一份', () => {
    /**
     * ⚠️ 拼法一旦漂了(ref 取值/lang/v 参数)，verifyGeneratedReply
     * 会把每条都判成 link_altered —— 现象是「开关打开了但一条都不自动」，
     * 而且毫无线索。
     */
    const i = HANDLERS.indexOf('canAutoReply(');
    const blk = HANDLERS.slice(i, i + 500);
    expect(blk, '另拼了链接 —— 拼法一漂，每条都会被判成链接被改写')
      .toMatch(/d\.text\.match\(/);
  });

  it('⚠️ 闸门出错不拦草稿返回（降级要局部）', () => {
    const i = HANDLERS.indexOf('canAutoReply(');
    const blk = HANDLERS.slice(i, i + 700);
    expect(blk, '闸门抛错会把整批草稿拖掉 —— 拟出来的照样该给人看')
      .toMatch(/\.catch\(/);
  });
});

describe('⭐⭐ 判定要报出来（「为什么没自动」不能靠猜）', () => {
  it('⭐⭐ 可自动条数 + **其余为什么不行** 两样都报', () => {
    const i = CAPS.indexOf('const autoList');
    expect(i, '编排没报闸门判定').toBeGreaterThan(0);
    const blk = strip(CAPS.slice(i, CAPS.indexOf('return {', i) + 600));
    expect(blk.length, 'slice 空转').toBeGreaterThan(200);
    expect(blk, '没统计可自动条数').toMatch(/a\.allowed/);
    expect(
      blk,
      '只报「N 条可自动」而不报其余为什么 —— 「我开了开关怎么不自动」只能靠猜',
    ).toMatch(/blocked/);
  });

  it('⭐ 逐条判定进 evidence（观察点）', () => {
    const i = CAPS.indexOf('const autoList');
    const blk = strip(CAPS.slice(i, CAPS.indexOf('elapsedMs', i)));
    expect(blk, '闸门判定没留痕 —— 回头查不到哪条为什么被挡')
      .toMatch(/evidence: \{ items: autoList \}/);
  });
});

describe('⭐⭐ 面板上点得到（库里有字段 ≠ 用户改得了）', () => {
  it('⭐⭐ 编辑表单里有这个开关', () => {
    const i = VIEW.indexOf("set('autoReply'");
    expect(i, '配方编辑表单里没有自动回复开关 —— 字段有了也点不到').toBeGreaterThan(0);
    /** ⚠️ 必须是 checked 绑定，不能只有 onChange（那样勾了不显示） */
    const blk = VIEW.slice(Math.max(0, i - 400), i);
    expect(blk, '开关没绑 checked —— 勾了不会显示成勾上').toMatch(/draft\.autoReply === true/);
  });

  it('⭐⭐ 措辞必须说清「不会替你发布」', () => {
    /**
     * ⚠️ 写含糊了人会以为它替自己发推 ——
     * 那是本仓最不能出的误解(红线:绝不程序点发布)。
     */
    const i = VIEW.indexOf("set('autoReply'");
    const blk = VIEW.slice(i, i + 900);
    expect(blk, '没说清不会自动发布').toMatch(/不会替你发布/);
    expect(blk, '没说清只对这一个配方生效').toMatch(/这一个配方/);
  });

  it('⭐ 列表上看得见哪些开着', () => {
    /** ⚠️ 会影响对外发言的设置，藏在编辑页里不合适 */
    expect(VIEW, '列表上看不出哪些配方开了自动 —— 只能逐个点进去查')
      .toMatch(/recipe\.autoReply === true/);
  });
});

describe('⭐⭐ 存取四处都登记（漏一处就静默丢失）', () => {
  it('⭐⭐ rowToRecipe / UPDATE / INSERT / 参数 都有', () => {
    expect(REPO, 'rowToRecipe 没读 —— 读出来永远是 undefined')
      .toMatch(/autoReply: row\.auto_reply === true/);
    /** ⚠️ 两个分支都要有:漏 INSERT 的话「新建时就打开」会静默丢失 */
    const upd = REPO.slice(REPO.indexOf('UPDATE search_recipes SET'), REPO.indexOf('} else {'));
    expect(upd.length, 'slice 空转').toBeGreaterThan(100);
    expect(upd, 'UPDATE 分支漏了 auto_reply').toMatch(/auto_reply = \$auto_reply/);
    const ins = REPO.slice(REPO.indexOf('INSERT INTO search_recipes'));
    expect(ins, 'INSERT 分支漏了 auto_reply —— 新建时打开会静默丢失')
      .toMatch(/auto_reply: \$auto_reply/);
    expect(REPO, '参数没绑值').toMatch(/auto_reply: recipe\.autoReply === true/);
  });

  it('⭐⭐ 默认关 —— 字段缺失绝不能变成开', () => {
    /** ⚠️ 存量配方没有这个字段，用 truthy 之外的写法会全部放行 */
    expect(REPO, '读的时候没归一成 false').toMatch(/row\.auto_reply === true/);
    expect(REPO, '写的时候没归一成 false').toMatch(/recipe\.autoReply === true/);
  });

  it('⚠️ 打开时间只在**从关变开**时写，重复保存不刷新', () => {
    const upd = REPO.slice(REPO.indexOf('UPDATE search_recipes SET'), REPO.indexOf('} else {'));
    expect(
      upd,
      '每次保存都刷新时间戳 —— 「开关什么时候打开的」就永远说不清',
    ).toMatch(/auto_reply != true/);
  });
});
