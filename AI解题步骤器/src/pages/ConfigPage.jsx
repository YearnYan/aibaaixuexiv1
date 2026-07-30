import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const DEFAULT_FORM = {
  providerName: 'OpenAI 兼容服务',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  timeoutMs: 60000,
};

export default function ConfigPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [adminPassword, setAdminPassword] = useState(
    () => window.sessionStorage.getItem('configAdminPassword') || '',
  );
  const [authorized, setAuthorized] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState('load');
  const [notice, setNotice] = useState(null);

  async function loadConfig(password = adminPassword) {
    setBusy('load');
    setNotice(null);
    try {
      const config = await api.getConfig(password);
      setForm({
        providerName: config.providerName,
        baseUrl: config.baseUrl,
        apiKey: '',
        model: config.model,
        temperature: config.temperature,
        timeoutMs: config.timeoutMs,
      });
      setMeta(config);
      setAuthorized(true);
      setNeedsPassword(false);
      if (password) window.sessionStorage.setItem('configAdminPassword', password);
    } catch (error) {
      if (error.status === 401) {
        setNeedsPassword(true);
        setAuthorized(false);
      } else {
        setNotice({ type: 'error', text: error.message });
      }
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    loadConfig();
    // 配置页首次进入时只读取一次，密码提交由表单触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleTest() {
    setBusy('test');
    setNotice(null);
    try {
      const result = await api.testConfig(adminPassword, form);
      setNotice({
        type: 'success',
        text: `连接成功，模型响应耗时 ${result.latencyMs} ms。`,
      });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setBusy('save');
    setNotice(null);
    try {
      const result = await api.saveConfig(adminPassword, form);
      setMeta(result);
      setForm((current) => ({ ...current, apiKey: '' }));
      setNotice({ type: 'success', text: 'AI 配置已加密保存。' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  if (busy === 'load' && !needsPassword) {
    return (
      <main className="config-loading">
        <LoaderCircle className="spin" size={34} aria-hidden="true" />
        <span>正在读取配置...</span>
      </main>
    );
  }

  if (needsPassword && !authorized) {
    return (
      <main className="config-auth-page">
        <a className="back-link" href="/"><ArrowLeft size={20} aria-hidden="true" />返回解题工具</a>
        <form
          className="config-auth"
          onSubmit={(event) => {
            event.preventDefault();
            loadConfig(adminPassword);
          }}
        >
          <KeyRound size={46} strokeWidth={1.6} aria-hidden="true" />
          <h1>配置管理验证</h1>
          <p>输入部署时设置的管理密码。</p>
          <label htmlFor="admin-password">管理密码</label>
          <input
            id="admin-password"
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
          <button type="submit" disabled={!adminPassword || busy === 'load'}>
            {busy === 'load' && <LoaderCircle className="spin" size={20} aria-hidden="true" />}
            进入配置
          </button>
          {notice && <div className="config-notice is-error">{notice.text}</div>}
        </form>
      </main>
    );
  }

  return (
    <main className="config-page">
      <header className="config-header">
        <a className="back-link" href="/"><ArrowLeft size={20} aria-hidden="true" />返回解题工具</a>
        <div className="config-title-row">
          <div>
            <span>AI SERVICE</span>
            <h1>AI 服务配置</h1>
            <p>配置 OpenAI 兼容接口，密钥只在服务端加密保存。</p>
          </div>
          <div className={`large-config-state${meta?.configured ? ' is-ready' : ''}`}>
            {meta?.configured ? <ShieldCheck size={27} aria-hidden="true" /> : <PlugZap size={27} aria-hidden="true" />}
            <span>{meta?.configured ? '服务已配置' : '等待配置'}</span>
          </div>
        </div>
      </header>

      <form className="config-layout" onSubmit={handleSave}>
        <section className="config-fields">
          <h2>连接参数</h2>
          <div className="config-field-grid">
            <label>
              <span>服务名称</span>
              <input
                value={form.providerName}
                onChange={(event) => updateField('providerName', event.target.value)}
                required
                maxLength={40}
              />
            </label>
            <label>
              <span>模型名称</span>
              <input
                value={form.model}
                onChange={(event) => updateField('model', event.target.value)}
                required
                maxLength={100}
                placeholder="支持图片时请选择视觉模型"
              />
            </label>
          </div>

          <label>
            <span>接口根地址</span>
            <input
              type="url"
              value={form.baseUrl}
              onChange={(event) => updateField('baseUrl', event.target.value)}
              required
              placeholder="https://api.openai.com/v1"
            />
            <small>系统会自动请求 `/chat/completions`；也可直接填写完整地址。</small>
          </label>

          <label>
            <span>API 密钥 {meta?.apiKeyPreview && <em>当前：{meta.apiKeyPreview}</em>}</span>
            <div className="secret-input">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(event) => updateField('apiKey', event.target.value)}
                autoComplete="new-password"
                placeholder={meta?.configured ? '留空表示保持现有密钥' : '首次配置必须填写'}
                disabled={meta?.managedByEnvironment}
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowApiKey((value) => !value)}
                aria-label={showApiKey ? '隐藏密钥' : '显示密钥'}
                title={showApiKey ? '隐藏密钥' : '显示密钥'}
                disabled={meta?.managedByEnvironment}
              >
                {showApiKey ? <EyeOff size={21} aria-hidden="true" /> : <Eye size={21} aria-hidden="true" />}
              </button>
            </div>
            {meta?.managedByEnvironment && <small>密钥由环境变量 `AI_API_KEY` 管理。</small>}
          </label>

          <div className="config-field-grid compact-grid">
            <label>
              <span>生成温度 <strong>{Number(form.temperature).toFixed(1)}</strong></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={form.temperature}
                onChange={(event) => updateField('temperature', Number(event.target.value))}
              />
            </label>
            <label>
              <span>请求超时</span>
              <select
                value={form.timeoutMs}
                onChange={(event) => updateField('timeoutMs', Number(event.target.value))}
              >
                <option value={30000}>30 秒</option>
                <option value={60000}>60 秒</option>
                <option value={90000}>90 秒</option>
                <option value={120000}>120 秒</option>
              </select>
            </label>
          </div>
        </section>

        <aside className="config-actions">
          <div>
            <span className="section-index">01</span>
            <h2>先测试，再保存</h2>
            <p>连接测试会向当前模型发送一条最小请求，用来验证地址、密钥和模型名称是否有效。</p>
          </div>

          {notice && (
            <div className={`config-notice is-${notice.type}`} role="status">
              {notice.type === 'success' && <CheckCircle2 size={22} aria-hidden="true" />}
              <span>{notice.text}</span>
            </div>
          )}

          <div className="config-button-row">
            <button className="test-button" type="button" onClick={handleTest} disabled={Boolean(busy)}>
              {busy === 'test' ? <LoaderCircle className="spin" size={22} aria-hidden="true" /> : <PlugZap size={22} aria-hidden="true" />}
              测试连接
            </button>
            <button className="save-button" type="submit" disabled={Boolean(busy)}>
              {busy === 'save' ? <LoaderCircle className="spin" size={22} aria-hidden="true" /> : <Save size={22} aria-hidden="true" />}
              保存配置
            </button>
          </div>

          <dl className="config-facts">
            <div><dt>密钥存储</dt><dd>AES-256-GCM</dd></div>
            <div><dt>接口协议</dt><dd>Chat Completions</dd></div>
            <div><dt>文件上限</dt><dd>10 MB</dd></div>
          </dl>
        </aside>
      </form>
    </main>
  );
}
