/**
 * LoginScreen — 全屏登录 / 注册表单(邮箱方式)
 *
 * 两个 tab:登录(老用户 email+password)/ 注册(email+password+6 位 code,
 * 先点「发送验证码」拿码)。提交走 authStore,成功后 main 广播 AUTH_CHANGED →
 * AuthGate 自动切走(本组件不需自己跳转)。
 *
 * 红线 2(fail loud):任何失败(发码失败 / 注册失败 / 登录失败 / 网络错)都把
 * main 归一的 error 明确显示,不静默吞、不假装成功。
 */

import { useState } from 'react';
import { authStore } from './index';
import './auth.css';

type Mode = 'login' | 'register';

export function LoginScreen(): React.ReactElement {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  function switchMode(next: Mode): void {
    setMode(next);
    setError(null);
    setHint(null);
  }

  async function handleSendCode(): Promise<void> {
    setError(null);
    setHint(null);
    if (!email) {
      setError('请先填写邮箱');
      return;
    }
    setBusy(true);
    try {
      const res = await authStore.sendCode({ email, purpose: 'register' });
      if (res.ok) {
        setCodeSent(true);
        setHint('验证码已发送,请查收邮箱');
      } else {
        setError(res.error ?? '验证码发送失败');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setHint(null);

    if (!email) {
      setError('请填写邮箱');
      return;
    }
    if (!password) {
      setError('请填写密码');
      return;
    }
    if (mode === 'register') {
      if (password.length < 8) {
        setError('密码至少 8 位');
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setError('请填写 6 位验证码');
        return;
      }
    }

    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await authStore.login({ email, password })
          : await authStore.register({ email, password, code });
      // 成功:main 广播 AUTH_CHANGED,AuthGate 自动切走。失败:fail loud。
      if (!res.ok) {
        setError(res.error ?? (mode === 'login' ? '登录失败' : '注册失败'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="krig-auth-card">
      <h1 className="krig-auth-card__title">KRIG Note</h1>
      <p className="krig-auth-card__subtitle">登录或注册以继续</p>

      <div className="krig-auth-card__tabs">
        <button
          type="button"
          className={
            'krig-auth-card__tab' + (mode === 'login' ? ' krig-auth-card__tab--active' : '')
          }
          onClick={() => switchMode('login')}
        >
          登录
        </button>
        <button
          type="button"
          className={
            'krig-auth-card__tab' + (mode === 'register' ? ' krig-auth-card__tab--active' : '')
          }
          onClick={() => switchMode('register')}
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="krig-auth-card__field">
          <label className="krig-auth-card__label">邮箱</label>
          <input
            className="krig-auth-card__input"
            type="email"
            value={email}
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="krig-auth-card__field">
          <label className="krig-auth-card__label">密码{mode === 'register' ? '(至少 8 位)' : ''}</label>
          <input
            className="krig-auth-card__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {mode === 'register' && (
          <div className="krig-auth-card__field">
            <label className="krig-auth-card__label">验证码(6 位)</label>
            <div className="krig-auth-card__code-row">
              <input
                className="krig-auth-card__input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
              />
              <button
                type="button"
                className="krig-auth-card__send-code"
                onClick={handleSendCode}
                disabled={busy || !email}
              >
                {codeSent ? '重新发送' : '发送验证码'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="krig-auth-card__error">{error}</p>}
        {hint && <p className="krig-auth-card__hint">{hint}</p>}

        <button type="submit" className="krig-auth-card__submit" disabled={busy}>
          {busy ? '处理中…' : mode === 'login' ? '登录' : '注册'}
        </button>
      </form>
    </div>
  );
}
