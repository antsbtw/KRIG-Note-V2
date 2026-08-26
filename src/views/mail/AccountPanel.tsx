/**
 * 邮箱账号面板(navSide 内容,阶段 1)
 *
 * 职责:列出本 ws 的 IMAP 账号 + 新建/删除/测试连接/同步。
 * 阶段 1 刻意**不做完整收件箱** —— 只做「同步状态 + 已同步 N 封」,
 * 先验证协议层稳定性。真正的邮件列表 UI 是阶段 2。
 *
 * ## 密码只在表单里存活
 *
 * password 从输入框直接经 IPC 交给 main 侧 safeStorage 加密,提交后立即清空。
 * **不进任何 state 持久化、不打日志**。renderer 永远拿不回明文(main 侧只提供
 * 加解密,不暴露读接口)。
 *
 * ## 为什么账号在 navSide 而不是弹窗
 *
 * 与 ebook 的书架、note 的目录树同构 —— 都是「本 view 的资源清单」。
 * 放弹窗会让「看着账号列表点同步」这个高频动作每次都要开关一次弹窗。
 */

import { useCallback, useEffect, useState } from 'react';
import { useWsId } from '@workspace/workspace-context/ws-id-context';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MailServiceApi, MailAccount, MailSyncResult } from '@capabilities/mail-service';
import {
  MAIL_SERVICE_PROFILES,
  DEFAULT_MAIL_SERVICE,
  getMailServiceProfile,
  type MailServiceId,
} from '@shared/types/mail-service-types';
import './account-panel.css';

/** 每个账号的运行时状态(同步中 / 上次结果),不持久化 */
interface AccountRuntime {
  syncing?: boolean;
  lastResult?: MailSyncResult;
  testing?: boolean;
  testError?: string;
  mailboxes?: string[];
}

export function AccountPanel() {
  // wsId 走 context 订阅(照 ebook 的 BookshelfPanel)—— 切 ws 时面板跟着换,
  // 不能由 contentRenderer 现读传入(那是快照,切 ws 后不更新)。
  const workspaceId = useWsId();
  const mail = requireCapabilityApi<MailServiceApi>('mail-service');
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [runtime, setRuntime] = useState<Record<string, AccountRuntime>>({});
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await mail.listAccounts(workspaceId));
    } finally {
      setLoading(false);
    }
  }, [mail, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patchRuntime = useCallback((id: string, patch: AccountRuntime) => {
    setRuntime((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const handleSync = useCallback(
    async (account: MailAccount) => {
      patchRuntime(account.id, { syncing: true, lastResult: undefined });
      const result = await mail.sync(account.id);
      patchRuntime(account.id, { syncing: false, lastResult: result });
    },
    [mail, patchRuntime],
  );

  const handleTest = useCallback(
    async (account: MailAccount) => {
      patchRuntime(account.id, { testing: true, testError: undefined, mailboxes: undefined });
      const result = await mail.testAccount(account.id);
      patchRuntime(account.id, {
        testing: false,
        testError: result.success ? undefined : result.error,
        mailboxes: result.mailboxes,
      });
    },
    [mail, patchRuntime],
  );

  const handleDelete = useCallback(
    async (account: MailAccount) => {
      // 删账号会连带清掉已同步的邮件 —— 必须确认,这是不可逆的
      const ok = window.confirm(
        `删除账号 ${account.email}?\n\n` +
          `会一并删除:已保存的密码、已同步的全部邮件、同步进度。\n` +
          `此操作不可撤销(邮件在服务器上仍然存在,可重新同步)。`,
      );
      if (!ok) return;
      const result = await mail.deleteAccount(account.id);
      if (!result.success) {
        window.alert(`删除失败:${result.error ?? '未知错误'}`);
        return;
      }
      await reload();
    },
    [mail, reload],
  );

  return (
    <div className="krig-mail-panel">
      {loading && <div className="krig-mail-panel__hint">加载中…</div>}

      {!loading && accounts.length === 0 && !showForm && (
        <div className="krig-mail-panel__empty">
          <p>还没有配置邮箱账号。</p>
          <p className="krig-mail-panel__empty-sub">
            配置后可把邮件同步到本地,供搜索、归档到笔记、以及将来交给 AI 处理。
          </p>
        </div>
      )}

      {accounts.map((acct) => {
        const rt = runtime[acct.id] ?? {};
        return (
          <div key={acct.id} className="krig-mail-panel__account">
            <div className="krig-mail-panel__account-head">
              <span className="krig-mail-panel__account-icon">
                {getMailServiceProfile(acct.serviceId).icon}
              </span>
              <span className="krig-mail-panel__account-email" title={acct.email}>
                {acct.email}
              </span>
            </div>
            <div className="krig-mail-panel__account-meta">
              {acct.imapHost}:{acct.imapPort}
            </div>

            <div className="krig-mail-panel__account-actions">
              <button
                type="button"
                onClick={() => void handleSync(acct)}
                disabled={rt.syncing}
                title="从服务器增量拉取新邮件"
              >
                {rt.syncing ? '同步中…' : '⟳ 同步'}
              </button>
              <button
                type="button"
                onClick={() => void handleTest(acct)}
                disabled={rt.testing}
                title="测试 IMAP 连接并列出文件夹"
              >
                {rt.testing ? '测试中…' : '测试连接'}
              </button>
              <button
                type="button"
                className="krig-mail-panel__danger"
                onClick={() => void handleDelete(acct)}
                title="删除账号及其本地邮件"
              >
                删除
              </button>
            </div>

            {/* 同步结果 —— 成功/失败都要显式呈现(fail loud) */}
            {rt.lastResult && (
              <div
                className={`krig-mail-panel__result${
                  rt.lastResult.success ? '' : ' krig-mail-panel__result--error'
                }`}
              >
                {rt.lastResult.success ? (
                  <>
                    {rt.lastResult.resynced && (
                      <div className="krig-mail-panel__warn">
                        ⚠️ 服务器文件夹已重建(UIDVALIDITY 变化),已丢弃本地数据全量重新同步。
                      </div>
                    )}
                    本次新增 {rt.lastResult.fetched} 封 · 本地共 {rt.lastResult.total} 封
                    {rt.lastResult.fetched === 0 && rt.lastResult.total === 0 && (
                      <div className="krig-mail-panel__warn">
                        收件箱为空,或该文件夹没有邮件。
                      </div>
                    )}
                  </>
                ) : (
                  <>同步失败:{rt.lastResult.error}</>
                )}
              </div>
            )}

            {rt.testError && (
              <div className="krig-mail-panel__result krig-mail-panel__result--error">
                {rt.testError}
              </div>
            )}
            {rt.mailboxes && (
              <div className="krig-mail-panel__result">
                连接正常,共 {rt.mailboxes.length} 个文件夹
              </div>
            )}
          </div>
        );
      })}

      {showForm ? (
        <AccountForm
          workspaceId={workspaceId}
          onDone={async () => {
            setShowForm(false);
            await reload();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          className="krig-mail-panel__add"
          onClick={() => setShowForm(true)}
        >
          + 添加邮箱账号
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  新建账号表单
// ═══════════════════════════════════════════════════════

interface AccountFormProps {
  workspaceId: string;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}

function AccountForm({ workspaceId, onDone, onCancel }: AccountFormProps) {
  const mail = requireCapabilityApi<MailServiceApi>('mail-service');
  const [serviceId, setServiceId] = useState<MailServiceId>(DEFAULT_MAIL_SERVICE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = getMailServiceProfile(serviceId);
  const defaults = profile.imapDefaults;

  // 服务器地址允许覆盖(企业自建域名),但默认用 profile 里的公开常量
  const [imapHost, setImapHost] = useState(defaults?.imapHost ?? '');
  const [imapPort, setImapPort] = useState(String(defaults?.imapPort ?? 993));

  const handleServiceChange = useCallback((id: MailServiceId) => {
    setServiceId(id);
    const d = getMailServiceProfile(id).imapDefaults;
    setImapHost(d?.imapHost ?? '');
    setImapPort(String(d?.imapPort ?? 993));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('邮箱地址和密码都要填');
      return;
    }
    if (!imapHost.trim()) {
      setError('IMAP 服务器地址不能为空');
      return;
    }
    const port = Number(imapPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setError('端口号不合法');
      return;
    }

    setSubmitting(true);
    try {
      const result = await mail.createAccount({
        wsId: workspaceId,
        serviceId,
        email: email.trim(),
        imapHost: imapHost.trim(),
        imapPort: port,
        imapSecure: port === 993,
        smtpHost: defaults?.smtpHost,
        smtpPort: defaults?.smtpPort,
        password,
      });
      if (!result.success) {
        setError(result.error ?? '创建失败');
        return;
      }
      setPassword(''); // 立即清空,不留在内存里
      await onDone();
    } finally {
      setSubmitting(false);
    }
  }, [mail, workspaceId, serviceId, email, password, imapHost, imapPort, defaults, onDone]);

  return (
    <div className="krig-mail-form">
      <div className="krig-mail-form__title">添加邮箱账号</div>

      <label className="krig-mail-form__field">
        <span>服务商</span>
        <select
          value={serviceId}
          onChange={(e) => handleServiceChange(e.target.value as MailServiceId)}
        >
          {MAIL_SERVICE_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="krig-mail-form__field">
        <span>邮箱地址</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="off"
        />
      </label>

      <label className="krig-mail-form__field">
        <span>应用专用密码</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="不是账号密码"
          autoComplete="new-password"
        />
      </label>

      {/*
        这段提示不是客套 —— 「为什么我的密码不对」是这类功能最高频的求助,
        而答案几乎总是「填了账号密码」。把申请入口直接放在输入框下面。
      */}
      <div className="krig-mail-form__hint">
        {profile.name} 不接受账号密码,需要单独生成一串应用专用密码
        {serviceId === 'qq' || serviceId === 'netease163' ? '(叫「授权码」)' : ''}。
        {defaults?.appPasswordUrl && (
          <>
            {' '}
            <a href={defaults.appPasswordUrl} target="_blank" rel="noreferrer">
              前往生成 ↗
            </a>
          </>
        )}
      </div>

      <details className="krig-mail-form__advanced">
        <summary>服务器设置(企业自建邮箱才需要改)</summary>
        <label className="krig-mail-form__field">
          <span>IMAP 服务器</span>
          <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
        </label>
        <label className="krig-mail-form__field">
          <span>端口</span>
          <input value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
        </label>
      </details>

      {error && <div className="krig-mail-form__error">{error}</div>}

      <div className="krig-mail-form__actions">
        <button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          取消
        </button>
      </div>
    </div>
  );
}
