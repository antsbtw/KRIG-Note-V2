/**
 * ⭐⭐ 资源锁对账(纯函数)—— 读 `[lock]` 日志行,判两件事:
 *   ① 同一个网页有没有两个人同时占着(不该发生)
 *   ② 有没有占了不放(超时收回 / 到现在还占着很久)
 * 格式由 `src/platform/main/flow/resource-lock.ts` 打出;改那边的格式要一起改这里
 * (tests/platform/main/lock-audit.test.ts 用真函数打出的行喂进来,格式漂了会红)。
 */

const RE = {
  acquire: /^\[lock\] 占住 (\S+)「(.*)」\((.*?)\) #(\S+)$/,
  release: /^\[lock\] 放掉 (\S+)「(.*)」\((.*?)\) 用了 (\d+) 秒 #(\S+)$/,
  refuse: /^\[lock\] 拒绝 (\S+)「(.*)」\((.*?)\):被「(.*)」\((.*?)\)占着 (\d+) 秒 #(\S+)$/,
  expire: /^\[lock\] ⚠️ 超时收回 (\S+)「(.*)」\((.*?)\)占了 (\d+) 秒没放.* #(\S+)$/,
  revoke: /^\[lock\] 收回 (\S+)「(.*)」\((.*?)\):(.*) #(\S+)$/,
  badRelease: /^\[lock\] release 没放任何东西:token (\S+) /,
};

/** 占着超过这么久还没放 → 提醒(查回关翻很多页也在这之内;锁本身的兜底超时是 1 小时) */
export const LONG_HOLD_SEC = 30 * 60;

/**
 * @param records 日志记录(按时间排好;需要 ts / msg / run)
 * @param nowTs 对账时刻(判「到现在还占着多久」)
 * @returns {{ problems: string[], notes: string[], spans: object[], refusals: object[], open: object[] }}
 */
export function auditLocks(records, nowTs) {
  const problems = [];
  const notes = [];
  const spans = [];
  const refusals = [];
  /** run → resource → { token, purpose, caller, at } */
  const held = new Map();
  const runOf = (r) => r.run ?? '?';
  const stateOf = (run) => { if (!held.has(run)) held.set(run, new Map()); return held.get(run); };
  let lastRun;

  for (const r of records) {
    const msg = String(r.msg ?? '').trim();
    if (!msg.startsWith('[lock]')) continue;
    const run = runOf(r);
    if (lastRun !== undefined && run !== lastRun) {
      for (const [res, h] of stateOf(lastRun)) notes.push(`app 重启前「${h.purpose}」还占着 ${res}(重启后锁自然清空,不算问题)`);
      held.delete(lastRun);
    }
    lastRun = run;
    const st = stateOf(run);
    let m;
    if ((m = RE.acquire.exec(msg))) {
      const [, res, purpose, caller, token] = m;
      const cur = st.get(res);
      if (cur) problems.push(`✗ 两个人同时占着 ${res}:「${cur.purpose}」(${cur.caller})还没放,「${purpose}」(${caller})又占住了`);
      st.set(res, { token, purpose, caller, at: r.ts });
    } else if ((m = RE.release.exec(msg))) {
      const [, res, purpose, caller, sec, token] = m;
      const cur = st.get(res);
      if (cur && cur.token === token) st.delete(res);
      else if (cur) problems.push(`✗ ${res} 放掉的「${purpose}」不是当前持有者「${cur.purpose}」`);
      else notes.push(`「${purpose}」在对账时间窗之前就占着 ${res},这里看到它放掉`);
      spans.push({ res, purpose, caller, from: cur?.token === token ? cur.at : undefined, to: r.ts, sec: Number(sec) });
    } else if ((m = RE.refuse.exec(msg))) {
      const [, res, purpose, caller, byPurpose, byCaller, sec] = m;
      refusals.push({ ts: r.ts, res, purpose, caller, byPurpose, byCaller, sec: Number(sec) });
    } else if ((m = RE.expire.exec(msg))) {
      const [, res, purpose, caller, sec] = m;
      st.delete(res);
      problems.push(`✗ 「${purpose}」(${caller})占着 ${res} ${sec} 秒没放,被超时收回 —— 有人漏了放锁`);
    } else if ((m = RE.revoke.exec(msg))) {
      const [, res, purpose, caller, why] = m;
      st.delete(res);
      notes.push(`收回 ${res}「${purpose}」(${caller}):${why}`);
    } else if ((m = RE.badRelease.exec(msg))) {
      problems.push(`✗ 有人拿着不是自己的(或已失效的)锁去放:${m[1]}`);
    }
  }

  const open = [];
  for (const [res, h] of lastRun === undefined ? [] : stateOf(lastRun)) {
    const sec = Math.round((nowTs - h.at) / 1000);
    open.push({ res, purpose: h.purpose, caller: h.caller, sec });
    if (sec > LONG_HOLD_SEC) problems.push(`✗ 「${h.purpose}」(${h.caller})已经占着 ${res} ${Math.round(sec / 60)} 分钟还没放`);
  }
  return { problems, notes, spans, refusals, open };
}
