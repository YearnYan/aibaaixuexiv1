import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { configInputSchema, type AiConfig, type ConfigInput } from "./schemas.js";

const DEFAULT_CONFIG: AiConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  temperature: 0.2,
  maxTokens: 2400,
  customInstructions: "",
};

export type ConfigSource = "environment" | "file" | "none";

export interface EffectiveConfig {
  config: AiConfig;
  source: ConfigSource;
}

function dataDirectory() {
  return path.resolve(process.cwd(), process.env.DATA_DIR || ".data");
}

function configPath() {
  return path.join(dataDirectory(), "ai-config.json");
}

async function readStoredConfig(): Promise<AiConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return configInputSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error("AI 配置文件损坏，请重新保存配置", { cause: error });
  }
}

export async function loadEffectiveConfig(): Promise<EffectiveConfig> {
  if (process.env.AI_API_KEY?.trim()) {
    const config = configInputSchema.parse({
      baseUrl: process.env.AI_BASE_URL || DEFAULT_CONFIG.baseUrl,
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL || DEFAULT_CONFIG.model,
      temperature: process.env.AI_TEMPERATURE || DEFAULT_CONFIG.temperature,
      maxTokens: process.env.AI_MAX_TOKENS || DEFAULT_CONFIG.maxTokens,
      customInstructions: process.env.AI_CUSTOM_INSTRUCTIONS || "",
    });
    return { config, source: "environment" };
  }

  const stored = await readStoredConfig();
  if (stored) {
    return { config: stored, source: "file" };
  }

  return { config: DEFAULT_CONFIG, source: "none" };
}

export async function buildCandidateConfig(input: ConfigInput): Promise<AiConfig> {
  const current = await loadEffectiveConfig();
  const apiKey = input.apiKey || current.config.apiKey;
  return configInputSchema.parse({ ...input, apiKey });
}

export async function saveConfig(input: ConfigInput): Promise<EffectiveConfig> {
  const candidate = await buildCandidateConfig(input);
  if (!candidate.apiKey) {
    throw new Error("请填写 API 密钥");
  }

  const directory = dataDirectory();
  const target = configPath();
  const temporary = `${target}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(candidate, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);

  return process.env.AI_API_KEY?.trim()
    ? loadEffectiveConfig()
    : { config: candidate, source: "file" };
}

export function assertConfigurationAccess(password: string | undefined) {
  const expected = process.env.CONFIG_PASSWORD;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      const error = new Error("生产环境必须设置 CONFIG_PASSWORD 后才能修改 AI 配置");
      Object.assign(error, { statusCode: 503 });
      throw error;
    }
    return;
  }

  const actualHash = createHash("sha256").update(password || "").digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(actualHash, expectedHash)) {
    const error = new Error("管理密码不正确");
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
}

export function publicConfigStatus({ config, source }: EffectiveConfig) {
  return {
    configured: Boolean(config.baseUrl && config.model && config.apiKey),
    source,
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    customInstructions: config.customInstructions,
  };
}
