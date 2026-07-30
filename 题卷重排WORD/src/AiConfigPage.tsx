import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  Wifi,
  XCircle,
} from "lucide-react";

type SessionState = "checking" | "anonymous" | "authenticated";
type NoticeTone = "info" | "success" | "warning" | "error";
type VerificationStatus = "idle" | "success" | "failure";

type Notice = {
  tone: NoticeTone;
  text: string;
};

type AiSettings = {
  configured: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  updatedAt: string;
  verifiedAt: string;
};

type AiSettingsResponse = {
  configured?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  hasApiKey?: unknown;
  updatedAt?: unknown;
  verifiedAt?: unknown;
};

type SettingsDraft = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type FieldErrors = Partial<Record<keyof SettingsDraft, string>>;

type VerificationResult = {
  status: VerificationStatus;
  message: string;
};

class SessionExpiredError extends Error {
  constructor() {
    super("管理员登录状态已失效，请重新登录。");
    this.name = "SessionExpiredError";
  }
}

class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const emptyDraft = (): SettingsDraft => ({
  baseUrl: "",
  apiKey: "",
  model: "",
});

export default function AiConfigPage() {
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [verification, setVerification] = useState<VerificationResult>({
    status: "idle",
    message: "",
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);

  const resetToLogin = useCallback((message: string) => {
    setSessionState("anonymous");
    setSettings(null);
    setDraft(emptyDraft());
    setFieldErrors({});
    setVerification({ status: "idle", message: "" });
    setPassword("");
    setNotice({ tone: "warning", text: message });
  }, []);

  const applySettings = useCallback((response: AiSettingsResponse) => {
    const nextSettings = normalizeSettings(response);
    setSettings(nextSettings);
    setDraft({
      baseUrl: nextSettings.baseUrl,
      apiKey: "",
      model: nextSettings.model,
    });
    setFieldErrors({});
    return nextSettings;
  }, []);

  const loadSettings = useCallback(async (): Promise<AiSettings | null> => {
    setIsLoadingSettings(true);
    try {
      const response = await requestJson<AiSettingsResponse>("/api/admin/ai-settings");
      return applySettings(response);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        resetToLogin(error.message);
        return null;
      }

      setNotice({ tone: "error", text: getErrorMessage(error, "读取 AI 配置失败。") });
      return null;
    } finally {
      setIsLoadingSettings(false);
    }
  }, [applySettings, resetToLogin]);

  useEffect(() => {
    let isCurrent = true;

    const checkSession = async () => {
      try {
        const response = await requestJson<{ authenticated?: unknown }>("/api/admin/session");
        if (!isCurrent) return;

        if (response.authenticated !== true) {
          setSessionState("anonymous");
          return;
        }

        setSessionState("authenticated");
        void loadSettings();
      } catch (error) {
        if (!isCurrent) return;

        if (error instanceof SessionExpiredError) {
          resetToLogin(error.message);
          return;
        }

        setSessionState("anonymous");
        setNotice({ tone: "error", text: getErrorMessage(error, "无法连接到管理服务。") });
      }
    };

    void checkSession();
    return () => {
      isCurrent = false;
    };
  }, [loadSettings, resetToLogin]);

  const hasSavedKey = Boolean(settings?.hasApiKey);
  const isFormBusy = isLoadingSettings || isSaving || isVerifying;
  const configurationLabel = useMemo(
    () => getConfigurationLabel(settings, verification),
    [settings, verification],
  );

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUsername = username.trim();

    if (!nextUsername || !password) {
      setLoginError("请输入管理员账号和密码。");
      return;
    }

    setIsAuthenticating(true);
    setLoginError("");
    setNotice(null);

    try {
      const response = await requestJson<{ authenticated?: unknown }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: nextUsername, password }),
      });

      if (response.authenticated !== true) {
        throw new ApiRequestError("账号或密码不正确。");
      }

      setPassword("");
      setSessionState("authenticated");
      await loadSettings();
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        setLoginError("管理员账号或密码不正确。");
        return;
      }

      setLoginError(getErrorMessage(error, "登录失败，请稍后重试。"));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      await requestJson<unknown>("/api/admin/logout", { method: "POST" });
      resetToLogin("已安全退出管理员会话。");
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        resetToLogin("管理员登录状态已失效，请重新登录。");
        return;
      }

      setNotice({ tone: "error", text: getErrorMessage(error, "退出失败，请稍后重试。") });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const updateDraft = (field: keyof SettingsDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateDraft(draft, hasSavedKey);

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setNotice({ tone: "warning", text: "请先修正标注的配置项。" });
      return;
    }

    setIsSaving(true);
    setNotice(null);
    setVerification({ status: "idle", message: "" });

    try {
      await requestJson<unknown>("/api/admin/ai-settings", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: draft.baseUrl.trim(),
          apiKey: draft.apiKey.trim(),
          model: draft.model.trim(),
        }),
      });

      const refreshedSettings = await loadSettings();
      if (!refreshedSettings) return;

      setNotice({
        tone: "success",
        text: "AI 接口配置已保存。保存后请执行一次连接验证。",
      });
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        resetToLogin(error.message);
        return;
      }

      setNotice({ tone: "error", text: getErrorMessage(error, "保存配置失败。") });
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!settings?.configured) {
      setNotice({ tone: "warning", text: "请先保存完整的接口配置，再执行连接验证。" });
      return;
    }

    setIsVerifying(true);
    setNotice(null);
    setVerification({ status: "idle", message: "" });

    try {
      const response = await requestJson<{ ok?: unknown; message?: unknown }>(
        "/api/admin/ai-settings/verify",
        { method: "POST" },
      );
      const message = readText(response.message) || (response.ok === true ? "连接验证通过。" : "连接验证未通过。");

      if (response.ok !== true) {
        setVerification({ status: "failure", message });
        setNotice({ tone: "error", text: message });
        return;
      }

      const refreshedSettings = await loadSettings();
      if (!refreshedSettings) return;

      setVerification({ status: "success", message });
      setNotice({ tone: "success", text: message });
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        resetToLogin(error.message);
        return;
      }

      const message = getErrorMessage(error, "连接验证失败，请检查接口地址、密钥与模型。");
      setVerification({ status: "failure", message });
      setNotice({ tone: "error", text: message });
    } finally {
      setIsVerifying(false);
    }
  };

  if (sessionState === "checking") {
    return <SessionLoading />;
  }

  if (sessionState === "anonymous") {
    return (
      <AdminLogin
        isAuthenticating={isAuthenticating}
        isPasswordVisible={isPasswordVisible}
        loginError={loginError}
        notice={notice}
        onPasswordVisibilityChange={() => setIsPasswordVisible((current) => !current)}
        onSubmit={handleLogin}
        password={password}
        setPassword={setPassword}
        setUsername={setUsername}
        username={username}
      />
    );
  }

  return (
    <div className="admin-app">
      <aside className="admin-rail" aria-label="管理员配置状态">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            <ServerCog size={20} strokeWidth={2.2} />
          </span>
          <div>
            <p>题卷重排 WORD</p>
            <strong>管理控制台</strong>
          </div>
        </div>

        <div className="admin-rail-section">
          <p className="admin-rail-label">当前模块</p>
          <div className="admin-rail-item" aria-current="page">
            <KeyRound size={17} aria-hidden="true" />
            <span>AI 接口配置</span>
          </div>
        </div>

        <div className="admin-rail-status" aria-live="polite">
          <p className="admin-rail-label">服务状态</p>
          <div className={`admin-status-indicator admin-status-${getStatusTone(settings, verification)}`}>
            <span className="admin-status-dot" aria-hidden="true" />
            <span>{configurationLabel}</span>
          </div>
          <p className="admin-rail-status-copy">
            {settings?.configured
              ? settings.verifiedAt
                ? `最近验证：${formatDateTime(settings.verifiedAt)}`
                : "配置已保存，尚未验证连接"
              : "尚未保存可用的 AI 配置"}
          </p>
        </div>

        <button
          className="admin-logout-button"
          type="button"
          onClick={() => void handleLogout()}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? <Loader2 className="admin-spin" size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
          <span>{isLoggingOut ? "正在退出" : "退出登录"}</span>
        </button>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-kicker">系统连接</p>
            <h1>AI 接口配置</h1>
          </div>
          <button
            className="admin-refresh-button"
            type="button"
            onClick={() => void loadSettings()}
            disabled={isFormBusy}
          >
            <RefreshCw className={isLoadingSettings ? "admin-spin" : undefined} size={17} aria-hidden="true" />
            <span>刷新状态</span>
          </button>
        </header>

        <section className="admin-intro" aria-labelledby="admin-config-heading">
          <div>
            <p className="admin-kicker">接口凭据</p>
            <h2 id="admin-config-heading">为题目识别服务指定模型连接</h2>
          </div>
          <p>配置保存到受保护的服务端。密钥不会回显，也不会存储在浏览器中。</p>
        </section>

        {notice ? <NoticeBanner notice={notice} /> : null}

        <section className="admin-workbench" aria-label="AI 接口配置表单" aria-busy={isFormBusy}>
          <form className="admin-form-pane" onSubmit={handleSave} noValidate>
            <div className="admin-form-heading">
              <div>
                <h2>连接参数</h2>
                <p>修改后需保存，验证会使用服务端最近一次保存的配置。</p>
              </div>
              {isLoadingSettings ? <Loader2 className="admin-spin" size={20} aria-label="正在读取配置" /> : null}
            </div>

            <div className="admin-fields">
              <label className="admin-field" htmlFor="ai-base-url">
                <span className="admin-field-label">接口地址</span>
                <span className="admin-field-help">需使用完整的 HTTP 或 HTTPS 地址。</span>
                <span className="admin-input-wrap">
                  <ServerCog size={18} aria-hidden="true" />
                  <input
                    id="ai-base-url"
                    name="baseUrl"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://api.example.com/v1"
                    value={draft.baseUrl}
                    onChange={(event) => updateDraft("baseUrl", event.target.value)}
                    aria-invalid={Boolean(fieldErrors.baseUrl)}
                    aria-describedby={fieldErrors.baseUrl ? "ai-base-url-error" : undefined}
                    disabled={isFormBusy}
                    required
                  />
                </span>
                {fieldErrors.baseUrl ? <span id="ai-base-url-error" className="admin-field-error">{fieldErrors.baseUrl}</span> : null}
              </label>

              <label className="admin-field" htmlFor="ai-api-key">
                <span className="admin-field-label">接口密钥</span>
                <span className="admin-field-help">
                  {hasSavedKey ? "当前密钥已安全保存。留空会保留现有密钥。" : "首次配置时必须填写。"}
                </span>
                <span className="admin-input-wrap admin-secret-wrap">
                  <KeyRound size={18} aria-hidden="true" />
                  <input
                    id="ai-api-key"
                    name="apiKey"
                    type={isApiKeyVisible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={hasSavedKey ? "输入新密钥以替换" : "输入接口密钥"}
                    value={draft.apiKey}
                    onChange={(event) => updateDraft("apiKey", event.target.value)}
                    aria-invalid={Boolean(fieldErrors.apiKey)}
                    aria-describedby={fieldErrors.apiKey ? "ai-api-key-error" : undefined}
                    disabled={isFormBusy}
                  />
                  <button
                    className="admin-icon-button"
                    type="button"
                    onClick={() => setIsApiKeyVisible((current) => !current)}
                    aria-label={isApiKeyVisible ? "隐藏接口密钥" : "显示接口密钥"}
                    aria-pressed={isApiKeyVisible}
                    data-tooltip={isApiKeyVisible ? "隐藏密钥" : "显示密钥"}
                    disabled={isFormBusy}
                  >
                    {isApiKeyVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </span>
                {fieldErrors.apiKey ? <span id="ai-api-key-error" className="admin-field-error">{fieldErrors.apiKey}</span> : null}
              </label>

              <label className="admin-field" htmlFor="ai-model">
                <span className="admin-field-label">模型名称</span>
                <span className="admin-field-help">填写接口服务商支持的模型标识。</span>
                <span className="admin-input-wrap">
                  <Wifi size={18} aria-hidden="true" />
                  <input
                    id="ai-model"
                    name="model"
                    type="text"
                    autoComplete="off"
                    placeholder="例如：gpt-4.1-mini"
                    value={draft.model}
                    onChange={(event) => updateDraft("model", event.target.value)}
                    aria-invalid={Boolean(fieldErrors.model)}
                    aria-describedby={fieldErrors.model ? "ai-model-error" : undefined}
                    disabled={isFormBusy}
                    required
                  />
                </span>
                {fieldErrors.model ? <span id="ai-model-error" className="admin-field-error">{fieldErrors.model}</span> : null}
              </label>
            </div>

            <div className="admin-form-actions">
              <button className="admin-save-button" type="submit" disabled={isFormBusy}>
                {isSaving ? <Loader2 className="admin-spin" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                <span>{isSaving ? "正在保存" : "保存配置"}</span>
              </button>
              <p>保存不会自动调用模型接口。</p>
            </div>
          </form>

          <aside className="admin-inspector" aria-label="配置状态与验证">
            <div className="admin-inspector-heading">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <h2>连接状态</h2>
                <p>验证使用已保存的服务端配置。</p>
              </div>
            </div>

            <dl className="admin-settings-list">
              <div>
                <dt>配置状态</dt>
                <dd>{settings?.configured ? "已保存" : "未配置"}</dd>
              </div>
              <div>
                <dt>接口地址</dt>
                <dd>{settings?.baseUrl || "尚未设置"}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{settings?.model || "尚未设置"}</dd>
              </div>
              <div>
                <dt>最后保存</dt>
                <dd>{settings?.updatedAt ? formatDateTime(settings.updatedAt) : "尚无记录"}</dd>
              </div>
              <div>
                <dt>最后验证</dt>
                <dd>{settings?.verifiedAt ? formatDateTime(settings.verifiedAt) : "尚未验证"}</dd>
              </div>
            </dl>

            <div className={`admin-verification admin-verification-${verification.status}`} aria-live="polite">
              {verification.status === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : null}
              {verification.status === "failure" ? <XCircle size={18} aria-hidden="true" /> : null}
              <p>{verification.message || "保存配置后，可手动检查模型连接是否可用。"}</p>
            </div>

            <button
              className="admin-verify-button"
              type="button"
              onClick={() => void handleVerify()}
              disabled={isFormBusy || !settings?.configured}
            >
              {isVerifying ? <Loader2 className="admin-spin" size={18} aria-hidden="true" /> : <Wifi size={18} aria-hidden="true" />}
              <span>{isVerifying ? "正在验证" : "验证当前连接"}</span>
            </button>

            <div className="admin-security-note">
              <KeyRound size={17} aria-hidden="true" />
              <p>密钥只会提交到受保护的管理接口。此页不保留浏览器本地副本。</p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

type AdminLoginProps = {
  username: string;
  password: string;
  loginError: string;
  notice: Notice | null;
  isAuthenticating: boolean;
  isPasswordVisible: boolean;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  onPasswordVisibilityChange: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AdminLogin({
  username,
  password,
  loginError,
  notice,
  isAuthenticating,
  isPasswordVisible,
  setUsername,
  setPassword,
  onPasswordVisibilityChange,
  onSubmit,
}: AdminLoginProps) {
  return (
    <main className="admin-login">
      <section className="admin-login-intro" aria-label="管理员入口说明">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            <ServerCog size={20} strokeWidth={2.2} />
          </span>
          <div>
            <p>题卷重排 WORD</p>
            <strong>管理控制台</strong>
          </div>
        </div>
        <div className="admin-login-copy">
          <p className="admin-kicker">受保护入口</p>
          <h1>AI 服务连接</h1>
          <p>登录后配置识别服务的接口地址、密钥与模型。普通工作台不会显示此入口。</p>
        </div>
        <div className="admin-login-policy">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>敏感配置只保存在服务端。</span>
        </div>
      </section>

      <section className="admin-login-main" aria-labelledby="admin-login-heading">
        <div className="admin-login-form-wrap">
          <p className="admin-kicker">管理员身份验证</p>
          <h2 id="admin-login-heading">登录配置中心</h2>
          <p className="admin-login-description">请输入管理员账号和密码继续。</p>

          {notice ? <NoticeBanner notice={notice} /> : null}

          <form className="admin-login-form" onSubmit={onSubmit} noValidate>
            <label className="admin-field" htmlFor="admin-username">
              <span className="admin-field-label">管理员账号</span>
              <span className="admin-input-wrap">
                <ShieldCheck size={18} aria-hidden="true" />
                <input
                  id="admin-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={isAuthenticating}
                  required
                  autoFocus
                />
              </span>
            </label>

            <label className="admin-field" htmlFor="admin-password">
              <span className="admin-field-label">登录密码</span>
              <span className="admin-input-wrap admin-secret-wrap">
                <KeyRound size={18} aria-hidden="true" />
                <input
                  id="admin-password"
                  name="password"
                  type={isPasswordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(loginError)}
                  aria-describedby={loginError ? "admin-login-error" : undefined}
                  disabled={isAuthenticating}
                  required
                />
                <button
                  className="admin-icon-button"
                  type="button"
                  onClick={onPasswordVisibilityChange}
                  aria-label={isPasswordVisible ? "隐藏登录密码" : "显示登录密码"}
                  aria-pressed={isPasswordVisible}
                  data-tooltip={isPasswordVisible ? "隐藏密码" : "显示密码"}
                  disabled={isAuthenticating}
                >
                  {isPasswordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </span>
            </label>

            {loginError ? <p className="admin-login-error" id="admin-login-error" role="alert"><AlertTriangle size={17} aria-hidden="true" />{loginError}</p> : null}

            <button className="admin-login-submit" type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? <Loader2 className="admin-spin" size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
              <span>{isAuthenticating ? "正在验证" : "进入配置中心"}</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function SessionLoading() {
  return (
    <main className="admin-loading-screen" aria-busy="true" aria-live="polite">
      <div className="admin-loading-mark" aria-hidden="true">
        <Loader2 className="admin-spin" size={24} />
      </div>
      <p>正在检查管理员会话</p>
    </main>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const Icon = notice.tone === "success"
    ? CheckCircle2
    : notice.tone === "error"
      ? XCircle
      : notice.tone === "warning"
        ? AlertTriangle
        : ShieldCheck;

  return (
    <div
      className={`admin-notice admin-notice-${notice.tone}`}
      role={notice.tone === "error" || notice.tone === "warning" ? "alert" : "status"}
      aria-live="polite"
    >
      <Icon size={18} aria-hidden="true" />
      <p>{notice.text}</p>
    </div>
  );
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiRequestError("无法连接到管理服务，请确认服务已启动。");
  }

  const payload = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    throw new ApiRequestError(readApiMessage(payload) || `请求失败（${response.status}）。`);
  }

  return payload as T;
}

function normalizeSettings(value: AiSettingsResponse): AiSettings {
  return {
    configured: value.configured === true,
    baseUrl: readText(value.baseUrl),
    model: readText(value.model),
    hasApiKey: value.hasApiKey === true,
    updatedAt: readText(value.updatedAt),
    verifiedAt: readText(value.verifiedAt),
  };
}

function validateDraft(draft: SettingsDraft, hasSavedKey: boolean): FieldErrors {
  const errors: FieldErrors = {};
  const baseUrl = draft.baseUrl.trim();

  if (!baseUrl) {
    errors.baseUrl = "请输入接口地址。";
  } else {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        errors.baseUrl = "接口地址必须以 http:// 或 https:// 开头。";
      }
    } catch {
      errors.baseUrl = "请输入有效的完整接口地址。";
    }
  }

  if (!draft.apiKey.trim() && !hasSavedKey) {
    errors.apiKey = "首次配置必须填写接口密钥。";
  }
  if (!draft.model.trim()) {
    errors.model = "请输入模型名称。";
  }

  return errors;
}

function getConfigurationLabel(settings: AiSettings | null, verification: VerificationResult) {
  if (!settings?.configured) return "尚未配置";
  if (verification.status === "failure") return "验证失败";
  if (verification.status === "success" || settings.verifiedAt) return "连接已验证";
  return "配置已保存";
}

function getStatusTone(settings: AiSettings | null, verification: VerificationResult) {
  if (!settings?.configured || verification.status === "failure") return "warning";
  if (verification.status === "success" || settings.verifiedAt) return "success";
  return "neutral";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function readApiMessage(value: unknown) {
  if (!isRecord(value)) return "";
  return readText(value.message) || readText(value.error);
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
