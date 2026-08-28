/**
 * 邮箱账号面板(toolbar ⚙ 弹窗内容,阶段 1)
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
 * ## 为什么是弹窗(初版放 navSide,已改)
 *
 * 见 ./index.ts 的说明:200px 窄栏装不下表单,且账号配置是低频操作,
 * 不值得常驻占一栏 —— webview 类 view 的全宽更重要。
 *
 * ## 同步中不要关窗
 *
 * 同步是异步的,弹窗关掉后 setState 会打到已卸载组件上(React 会警告,
 * 且用户看不到结果)。故同步/测试进行中时禁用关闭按钮,并在标题提示。
 */

import { useCallback, useEffect, useState } from 'react';
import { useWsId } from '@workspace/workspace-context/ws-id-context';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MailServiceApi, MailAccount, MailSyncResult } from '@capabilities/mail-service';
import { MAIL_SYNC_BATCH_LIMIT } from '@shared/types/mail-types';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
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
  /** 正在改密码(展开输入框) */
  editingPassword?: boolean;
  passwordSaved?: boolean;
}

export function AccountPanel({ onClose }: PopupCloseProps) {
  // wsId 走 context 订阅 —— 弹窗渲染在全局 PopupFrame,但 context 仍然贯通。
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

  /**
   * ⚠️ 每个动作都要清掉**其它动作**的残留结果。
   *
   * 这几个结果块(同步结果 / 测试结果 / 密码已更新)是并列渲染的兄弟节点,
   * 谁都不互斥。只清自己那一格的话,上一个动作的提示会一直挂在面板上 ——
   * 用户点了「同步」,屏幕上却还是上一次测试连接留下的「连接正常,共 N 个文件夹」,
   * 看起来就像「同步没反应」(2026-08-28 实际踩到)。
   *
   * 同族坑见 memory「EPUB菜单两分支互斥」:并列的分支必须显式互斥,
   * 别指望渲染顺序替你兜底。
   */
  const handleSync = useCallback(
    async (account: MailAccount) => {
      patchRuntime(account.id, {
        syncing: true,
        lastResult: undefined,
        testError: undefined,
        mailboxes: undefined,
        passwordSaved: false,
      });
      const result = await mail.sync(account.id);
      patchRuntime(account.id, { syncing: false, lastResult: result });
    },
    [mail, patchRuntime],
  );

  const handleTest = useCallback(
    async (account: MailAccount) => {
      patchRuntime(account.id, {
        testing: true,
        testError: undefined,
        mailboxes: undefined,
        lastResult: undefined,
        passwordSaved: false,
      });
      const result = await mail.testAccount(account.id);
      patchRuntime(account.id, {
        testing: false,
        testError: result.success ? undefined : result.error,
        mailboxes: result.mailboxes,
      });
    },
    [mail, patchRuntime],
  );

  const handleSetPassword = useCallback(
    async (account: MailAccount, newPassword: string) => {
      const result = await mail.setAccountPassword(account.id, newPassword);
      if (!result.success) {
        patchRuntime(account.id, { testError: result.error ?? '改密码失败' });
        return;
      }
      // 改完顺手测一次 —— 用户改密码就是因为连不上,不测等于让他再点一次
      patchRuntime(account.id, {
        editingPassword: false,
        passwordSaved: true,
        testError: undefined,
        testing: true,
      });
      const test = await mail.testAccount(account.id);
      patchRuntime(account.id, {
        testing: false,
        testError: test.success ? undefined : test.error,
        mailboxes: test.mailboxes,
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

  // 有任何账号正在同步/测试 → 禁止关窗(异步结果会打到已卸载组件上)
  const busy = Object.values(runtime).some((r) => r.syncing || r.testing);

  return (
    <div className="krig-mail-panel">
      <div className="krig-mail-panel__titlebar">
        <span className="krig-mail-panel__title">邮箱账号</span>
        <button
          type="button"
          className="krig-mail-panel__close"
          onClick={onClose}
          disabled={busy}
          title={busy ? '同步进行中,请等待完成' : '关闭'}
        >
          ✕
        </button>
      </div>

      {loading && <div className="krig-mail-panel__hint">加载中…</div>}

      {!loading && accounts.length === 0 && !showForm && (
        <div className="krig-mail-panel__empty">
          {/*
            这段文案回答的是「我网页版都登录了,为什么还要配一次」——
            实测用户第一反应就是这个疑问,不答掉就像是要求重复登录。
            答案:webview 登的是 Google 网页 session(cookie),IMAP 是独立协议
            (993 端口直连),两者互不通用。任何邮件客户端都是这样。
          */}
          <p className="krig-mail-panel__empty-title">这里配置的不是网页登录</p>
          <p className="krig-mail-panel__empty-sub">
            左边的网页版邮箱已经登录了,看信、发信、右键提取到笔记都能用,
            <strong>不配这里也不影响</strong>。
          </p>
          <p className="krig-mail-panel__empty-sub">
            IMAP 是独立的邮件协议,和浏览器登录互不通用(就像 Apple Mail
            也要单独配一次)。配好后邮件会同步到本地,才能做:
          </p>
          <ul className="krig-mail-panel__empty-list">
            <li>本地全文搜索、离线阅读</li>
            <li>批量归档到笔记</li>
            <li>交给 AI 自动分类、提取待办、起草回复</li>
          </ul>
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
                onClick={() =>
                  patchRuntime(acct.id, {
                    editingPassword: !rt.editingPassword,
                    passwordSaved: false,
                  })
                }
                title="重新填写应用专用密码(不影响已同步的邮件)"
              >
                改密码
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

            {rt.editingPassword && (
              <PasswordEditor
                onSave={(pw) => void handleSetPassword(acct, pw)}
                onCancel={() => patchRuntime(acct.id, { editingPassword: false })}
              />
            )}
            {rt.passwordSaved && !rt.testError && !rt.testing && (
              <div className="krig-mail-panel__result">密码已更新</div>
            )}

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
                    {typeof rt.lastResult.serverTotal === 'number' && (
                      <> / 服务端 {rt.lastResult.serverTotal} 封</>
                    )}
                    {/*
                      对账没平就明说「还差多少、要继续点」——
                      单次同步有上限,一次点不完是常态。不提示的话用户会以为
                      「同步完了就这些」(真机上就是这么误判的)。
                    */}
                    {rt.lastResult.total > 0 &&
                      typeof rt.lastResult.serverTotal === 'number' &&
                      rt.lastResult.total < rt.lastResult.serverTotal && (
                        <div className="krig-mail-panel__warn">
                          还有 {rt.lastResult.serverTotal - rt.lastResult.total} 封未同步 ——
                          单次上限 {MAIL_SYNC_BATCH_LIMIT} 封,再点几次「同步」继续。
                        </div>
                      )}
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
//  改密码(内联小表单)
// ═══════════════════════════════════════════════════════

/**
 * 只改密码,不动账号记录与已同步邮件。
 *
 * 为什么需要:应用专用密码可能被吊销/重新生成,或首次就填错了
 * (最常见的是**复制时带了 Google 显示的空格**)。没有这个入口的话
 * 用户只能删账号重建 —— 那会连带删掉已同步的全部邮件,代价过大。
 */
function PasswordEditor({
  onSave,
  onCancel,
}: {
  onSave: (password: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState('');
  return (
    <div className="krig-mail-panel__pw-editor">
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="新的应用专用密码"
        autoComplete="new-password"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pw) onSave(pw);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button type="button" onClick={() => pw && onSave(pw)} disabled={!pw}>
        保存并测试
      </button>
      <button type="button" onClick={onCancel}>
        取消
      </button>
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
        // ⚠️ 去掉所有空白:Google 把应用专用密码显示成 `abcd efgh ijkl mnop`
        // (四组四位带空格),用户复制时几乎必然连空格一起带上,而 IMAP 认证
        // 要的是 16 位连续字符 —— 带空格必然 AUTHENTICATIONFAILED(实测踩到)。
        // QQ/163 的授权码同理。所有正经邮件客户端都做这一步。
        password: password.replace(/\s+/g, ''),
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
          placeholder="16 位,空格可直接粘贴"
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
