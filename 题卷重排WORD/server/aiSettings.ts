import { randomBytes, createCipheriv, createDecipheriv, scrypt as scryptCallback } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const scrypt = promisify(scryptCallback);
const SETTINGS_VERSION = 1;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const SCRYPT_SALT_LENGTH = 16;

const EncryptedApiKeySchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  salt: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1),
}).strict();

const PersistedAiSettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  apiKey: EncryptedApiKeySchema,
  updatedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().optional(),
}).strict();

export const ProviderBaseUrlSchema = z.string()
  .trim()
  .min(1, "请输入接口地址")
  .max(2048, "接口地址过长")
  .transform((value, context) => {
    try {
      return normalizeProviderBaseUrl(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "接口地址必须是有效的 HTTP 或 HTTPS 地址",
      });
      return z.NEVER;
    }
  });

export const ProviderModelSchema = z.string()
  .trim()
  .min(1, "请输入模型名称")
  .max(256, "模型名称过长");

export const ProviderApiKeySchema = z.string()
  .trim()
  .min(1, "请输入 API 密钥")
  .max(4096, "API 密钥过长");

export const AiSettingsInputSchema = z.object({
  baseUrl: ProviderBaseUrlSchema,
  model: ProviderModelSchema,
  apiKey: ProviderApiKeySchema,
}).strict();

export const AiSettingsPatchSchema = z.object({
  baseUrl: ProviderBaseUrlSchema.optional(),
  model: ProviderModelSchema.optional(),
  apiKey: ProviderApiKeySchema.optional(),
}).strict();

export type AiSettingsInput = z.infer<typeof AiSettingsInputSchema>;
export type AiSettingsPatch = z.infer<typeof AiSettingsPatchSchema>;

export type AiSettingsSummary = {
  configured: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  updatedAt?: string;
  verifiedAt?: string;
};

type PersistedAiSettings = z.infer<typeof PersistedAiSettingsSchema>;

export class AiSettingsStoreError extends Error {
  constructor() {
    super("AI 配置不可用");
    this.name = "AiSettingsStoreError";
  }
}

export class AiSettingsStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly administratorPassword: string,
    private readonly filePath = resolve(process.cwd(), process.env.AI_SETTINGS_FILE || ".ai-config.local.json"),
  ) {}

  async getSummary(): Promise<AiSettingsSummary> {
    const settings = await this.read();
    if (!settings) {
      return {
        configured: false,
        baseUrl: "",
        model: "",
        hasApiKey: false,
      };
    }

    const persisted = await this.readPersisted();
    return {
      configured: true,
      baseUrl: settings.baseUrl,
      model: settings.model,
      hasApiKey: true,
      updatedAt: persisted.updatedAt,
      verifiedAt: persisted.verifiedAt,
    };
  }

  async read(): Promise<AiSettingsInput | null> {
    const persisted = await this.readPersistedOrNull();
    if (!persisted) return null;

    try {
      return await this.decryptSettings(persisted);
    } catch {
      throw new AiSettingsStoreError();
    }
  }

  async save(input: AiSettingsInput): Promise<AiSettingsSummary> {
    const settings = AiSettingsInputSchema.parse(input);
    const updatedAt = new Date().toISOString();
    const persisted: PersistedAiSettings = {
      version: SETTINGS_VERSION,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: await this.encryptApiKey(settings.apiKey),
      updatedAt,
    };

    await this.enqueueWrite(persisted);
    return {
      configured: true,
      baseUrl: settings.baseUrl,
      model: settings.model,
      hasApiKey: true,
      updatedAt,
    };
  }

  /**
   * 仅当当前持久化配置与已验证的快照完全一致时，才写入验证时间。
   * 该操作和保存操作共用同一队列，避免验证请求覆盖其等待期间的新配置。
   */
  async markVerifiedIfCurrent(input: AiSettingsInput): Promise<AiSettingsSummary | null> {
    const expected = AiSettingsInputSchema.parse(input);

    return this.enqueueMutation(async () => {
      let persisted: PersistedAiSettings | null;
      let current: AiSettingsInput;

      try {
        persisted = await this.readPersistedOrNull();
        if (!persisted) return null;
        current = await this.decryptSettings(persisted);
      } catch {
        // 配置在验证期间损坏、被替换或已无法解密时，绝不能尝试回写旧快照。
        return null;
      }

      if (!isSameAiSettings(current, expected)) return null;

      const verifiedAt = new Date().toISOString();
      await this.writePersisted({ ...persisted, verifiedAt });
      return {
        configured: true,
        baseUrl: persisted.baseUrl,
        model: persisted.model,
        hasApiKey: true,
        updatedAt: persisted.updatedAt,
        verifiedAt,
      };
    });
  }

  private async readPersisted(): Promise<PersistedAiSettings> {
    const settings = await this.readPersistedOrNull();
    if (!settings) throw new AiSettingsStoreError();
    return settings;
  }

  private async readPersistedOrNull(): Promise<PersistedAiSettings | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw new AiSettingsStoreError();
    }

    try {
      return PersistedAiSettingsSchema.parse(JSON.parse(raw));
    } catch {
      throw new AiSettingsStoreError();
    }
  }

  private async encryptApiKey(apiKey: string) {
    const salt = randomBytes(SCRYPT_SALT_LENGTH);
    const key = await deriveEncryptionKey(this.administratorPassword, salt);
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: "aes-256-gcm" as const,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private async decryptApiKey(encrypted: z.infer<typeof EncryptedApiKeySchema>) {
    const salt = decodeBase64(encrypted.salt);
    const iv = decodeBase64(encrypted.iv);
    const authTag = decodeBase64(encrypted.authTag);
    const ciphertext = decodeBase64(encrypted.ciphertext);

    if (salt.length !== SCRYPT_SALT_LENGTH || iv.length !== GCM_IV_LENGTH || authTag.length !== GCM_TAG_LENGTH) {
      throw new AiSettingsStoreError();
    }

    const key = await deriveEncryptionKey(this.administratorPassword, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  private async decryptSettings(persisted: PersistedAiSettings): Promise<AiSettingsInput> {
    const apiKey = await this.decryptApiKey(persisted.apiKey);
    return AiSettingsInputSchema.parse({
      baseUrl: persisted.baseUrl,
      model: persisted.model,
      apiKey,
    });
  }

  private async enqueueWrite(settings: PersistedAiSettings) {
    await this.enqueueMutation(() => this.writePersisted(settings));
  }

  private enqueueMutation<T>(mutation: () => Promise<T>) {
    const operation = this.writeQueue.then(mutation);
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async writePersisted(settings: PersistedAiSettings) {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${randomBytes(8).toString("hex")}.tmp`;

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
      await restrictFilePermissions(temporaryPath);
      await rename(temporaryPath, this.filePath);
      await restrictFilePermissions(this.filePath);
    } catch {
      throw new AiSettingsStoreError();
    }
  }
}

export function mergeAiSettings(saved: AiSettingsInput | null, patch: AiSettingsPatch): AiSettingsInput | null {
  if (requiresNewApiKeyForBaseUrlChange(saved, patch)) return null;

  const candidate = {
    baseUrl: patch.baseUrl ?? saved?.baseUrl,
    model: patch.model ?? saved?.model,
    apiKey: patch.apiKey ?? saved?.apiKey,
  };

  const parsed = AiSettingsInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * 同一上游主机可以继续使用已保存的密钥；切换协议、域名或端口时必须重新提交密钥。
 */
export function requiresNewApiKeyForBaseUrlChange(saved: AiSettingsInput | null, patch: AiSettingsPatch) {
  if (!saved || patch.baseUrl === undefined || patch.apiKey !== undefined) return false;

  try {
    return new URL(saved.baseUrl).origin !== new URL(patch.baseUrl).origin;
  } catch {
    return saved.baseUrl !== patch.baseUrl;
  }
}

export function normalizeProviderBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("不支持的协议");
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("无效的接口地址");
  }

  const normalized = url.toString().replace(/\/+$/, "");
  return normalized || url.origin;
}

async function deriveEncryptionKey(password: string, salt: Buffer) {
  return scrypt(password, salt, 32) as Promise<Buffer>;
}

function decodeBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AiSettingsStoreError();
  }
  return Buffer.from(value, "base64");
}

async function restrictFilePermissions(path: string) {
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows 文件权限模型不支持 POSIX chmod，写入仍会继续。
  }
}

function isMissingFileError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "ENOENT",
  );
}

function isSameAiSettings(left: AiSettingsInput, right: AiSettingsInput) {
  return left.baseUrl === right.baseUrl
    && left.model === right.model
    && left.apiKey === right.apiKey;
}
