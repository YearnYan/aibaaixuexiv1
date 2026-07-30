import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Save,
  Server,
  SlidersHorizontal,
  TestTube2,
} from "lucide-react";
import { Header } from "../components/Header";
import { getConfigStatus, saveAiConfig, testAiConfig } from "../lib/api";
import type { ConfigFormData, ConfigStatus } from "../types";

const initialForm: ConfigFormData = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  temperature: 0.2,
  maxTokens: 2400,
  customInstructions: "",
};

type Notice = { type: "success" | "error"; text: string } | null;

export function ConfigPage() {
  const [form, setForm] = useState<ConfigFormData>(initialForm);
  const [password, setPassword] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"save" | "test" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    getConfigStatus()
      .then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setForm({
          baseUrl: nextStatus.baseUrl || initialForm.baseUrl,
          apiKey: "",
          model: nextStatus.model || initialForm.model,
          temperature: nextStatus.temperature,
          maxTokens: nextStatus.maxTokens,
          customInstructions: nextStatus.customInstructions,
        });
      })
      .catch((error: Error) => {
        if (active) setNotice({ type: "error", text: error.message });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateField = <Key extends keyof ConfigFormData>(key: Key, value: ConfigFormData[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleAction = async (nextAction: "save" | "test") => {
    setAction(nextAction);
    setNotice(null);
    try {
      if (nextAction === "test") {
        const result = await testAiConfig(form, password);
        setNotice({ type: "success", text: result.message });
      } else {
        const nextStatus = await saveAiConfig(form, password);
        setStatus(nextStatus);
        setForm((current) => ({ ...current, apiKey: "" }));
        setNotice({ type: "success", text: "AI 配置已保存并生效" });
      }
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "操作失败" });
    } finally {
      setAction(null);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void handleAction("save");
  };

  return (
    <div className="app-shell config-shell">
      <Header configPage />
      <main className="config-page">
        <section className="config-panel">
          <div className="config-title-row">
            <div>
              <span className="config-eyebrow">模型连接</span>
              <h2>AI 服务配置</h2>
              <p>配置保存在服务端，审题页面无法读取 API 密钥。</p>
            </div>
            <div className={`config-status${status?.configured ? " is-ready" : ""}`}>
              {loading ? <LoaderCircle className="spinning" size={18} /> : <CheckCircle2 size={18} />}
              {loading ? "正在检查" : status?.configured ? "已配置" : "未配置"}
            </div>
          </div>

          {status?.source === "environment" ? (
            <div className="environment-notice">当前由服务器环境变量接管配置，页面保存的内容不会覆盖环境变量。</div>
          ) : null}

          <form className="config-form" onSubmit={handleSubmit}>
            <div className="form-section-heading">
              <Server size={21} aria-hidden="true" />
              <div>
                <h3>接口与模型</h3>
                <p>支持 OpenAI Chat Completions 格式的兼容接口。</p>
              </div>
            </div>

            <div className="config-grid">
              <label className="config-field wide-field">
                <span>接口地址</span>
                <input
                  type="url"
                  required
                  value={form.baseUrl}
                  onChange={(event) => updateField("baseUrl", event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="config-field">
                <span>模型名称</span>
                <input
                  type="text"
                  required
                  value={form.model}
                  onChange={(event) => updateField("model", event.target.value)}
                  placeholder="gpt-4.1-mini"
                />
              </label>
              <label className="config-field api-key-field">
                <span>API 密钥</span>
                <div className="secret-input">
                  <KeyRound size={19} aria-hidden="true" />
                  <input
                    type={showKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={(event) => updateField("apiKey", event.target.value)}
                    placeholder={status?.hasApiKey ? "已保存，留空表示不修改" : "请输入 API 密钥"}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowKey((current) => !current)} aria-label={showKey ? "隐藏密钥" : "显示密钥"}>
                    {showKey ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </label>
            </div>

            <div className="form-section-heading secondary-heading">
              <SlidersHorizontal size={21} aria-hidden="true" />
              <div>
                <h3>生成参数</h3>
                <p>低温度更适合稳定、可复核的审题结果。</p>
              </div>
            </div>

            <div className="config-grid parameter-grid">
              <label className="config-field">
                <span>温度：{form.temperature.toFixed(1)}</span>
                <input
                  className="range-input"
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.1"
                  value={form.temperature}
                  onChange={(event) => updateField("temperature", Number(event.target.value))}
                />
              </label>
              <label className="config-field">
                <span>最大输出 Token</span>
                <input
                  type="number"
                  min="400"
                  max="8000"
                  step="100"
                  value={form.maxTokens}
                  onChange={(event) => updateField("maxTokens", Number(event.target.value))}
                />
              </label>
              <label className="config-field wide-field">
                <span>补充审题指令（可选）</span>
                <textarea
                  maxLength={1000}
                  value={form.customInstructions}
                  onChange={(event) => updateField("customInstructions", event.target.value)}
                  placeholder="例如：优先识别数量范围、单位和否定词。"
                />
                <small>{form.customInstructions.length} / 1000</small>
              </label>
            </div>

            <div className="config-security-row">
              <LockKeyhole size={20} aria-hidden="true" />
              <label>
                <span>管理密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="本地开发可留空，生产环境必填"
                  autoComplete="current-password"
                />
              </label>
            </div>

            {notice ? <div className={`config-notice is-${notice.type}`}>{notice.text}</div> : null}

            <div className="config-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={action !== null || loading}
                onClick={() => void handleAction("test")}
              >
                {action === "test" ? <LoaderCircle className="spinning" size={20} /> : <TestTube2 size={20} />}
                测试连接
              </button>
              <button className="primary-button" type="submit" disabled={action !== null || loading}>
                {action === "save" ? <LoaderCircle className="spinning" size={20} /> : <Save size={20} />}
                保存配置
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
