/**
 * 产物交付服务:渲染产物 → 可交付引用(artifactId + 可下载 URL)。
 *
 * 存储读写下沉到 ArtifactStore(fs / s3 两个适配器),本层只负责:
 * - id 生成与校验(内容哈希 + 短随机段,只允许白名单短名);
 * - 幂等/覆盖策略(同名不同内容默认拒绝);
 * - 过期判断与 fs 侧清理;
 * - HMAC 签名 URL(fs 交付用;对象存储走自己的预签名)。
 *
 * 响应与日志只暴露 id/URL,绝不暴露服务器文件系统路径。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ARTIFACT_ID_PATTERN, loadArtifactConfig, type ArtifactConfig } from './artifact.config';
import { createArtifactStore } from './artifact.store';
import {
  ArtifactStoreError,
  type ArtifactMeta,
  type ArtifactRecord,
  type ArtifactStore,
  type PutOptions,
  type StoredArtifact,
} from './artifact.types';

export { ArtifactStoreError };
export type { ArtifactMeta, ArtifactRecord, PutOptions, StoredArtifact };

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

export class ArtifactService {
  private lastSweepAt = 0;
  private readonly store: ArtifactStore;

  constructor(
    private readonly config: ArtifactConfig = loadArtifactConfig(),
    store?: ArtifactStore,
  ) {
    // 存储适配器在构造期创建:配置错误(如 s3 缺 bucket/凭证)会在启动时立刻暴露
    this.store = store ?? createArtifactStore(config);
  }

  /** 只读配置(供上层决定默认 delivery、是否签名等) */
  get settings(): Readonly<ArtifactConfig> {
    return this.config;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** 当前存储类型:fs 或 s3(健康检查/日志用) */
  get storeKind(): 'fs' | 's3' {
    return this.store.kind;
  }

  /**
   * 保存产物。
   * - 指定 artifactId 且内容相同 → 幂等返回已有记录;
   * - 指定 artifactId 且内容不同 → 默认拒绝(overwrite=false);
   * - 未指定 → 用 sha256 前 16 位 + 随机段生成不可猜 id。
   */
  async put(
    bytes: Buffer,
    meta: ArtifactMeta,
    options: PutOptions = {},
  ): Promise<ArtifactRecord> {
    if (!this.config.enabled) {
      throw new ArtifactStoreError('产物交付已关闭(FLINT_ARTIFACT_WRITE=0)');
    }
    if (bytes.length > this.config.maxBytes) {
      throw new ArtifactStoreError(
        `产物 ${bytes.length} 字节,超过上限 ${this.config.maxBytes} 字节`,
      );
    }
    const extension: 'png' | 'svg' = meta.extension === 'svg' ? 'svg' : 'png';
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    let id = options.artifactId;
    if (id !== undefined && !ARTIFACT_ID_PATTERN.test(id)) {
      throw new ArtifactStoreError(
        `非法的 artifact_id:"${id}"(仅允许字母、数字、下划线、连字符,长度 1-64)`,
      );
    }
    if (!id) {
      id = this.generateId(sha256);
    } else {
      const existing = await this.store.loadRecord(id);
      if (existing) {
        if (existing.sha256 === sha256 && existing.extension === extension) {
          return existing; // 幂等:同样的内容重复渲染不重复写
        }
        if (!options.overwrite) {
          throw new ArtifactStoreError(
            `artifact_id "${id}" 已存在且内容不同;如需覆盖请传 overwrite=true`,
          );
        }
      }
    }

    const now = Date.now();
    const record: ArtifactRecord = {
      id,
      extension,
      mimeType: meta.mimeType,
      size: bytes.length,
      sha256,
      width: meta.width,
      height: meta.height,
      warnings: meta.warnings,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.config.ttlSeconds * 1000).toISOString(),
    };
    await this.store.save(record, bytes);
    await this.sweepExpired();
    return record;
  }

  /** 按 id 读回产物;不存在/已过期返回 null(过期对象顺手删除) */
  async get(id: string): Promise<StoredArtifact | null> {
    if (!ARTIFACT_ID_PATTERN.test(id)) return null;
    const record = await this.store.loadRecord(id);
    if (!record) return null;
    if (Date.parse(record.expiresAt) <= Date.now()) {
      await this.store.remove(record);
      return null;
    }
    try {
      return { record, bytes: await this.store.loadBytes(record) };
    } catch {
      return null;
    }
  }

  /**
   * 构造产物下载 URL。
   * - fs :本服务 /api/flint/artifacts/:id(配置 authToken 时附 HMAC 签名);
   * - s3 :对象存储预签名 URL(签名与有效期由对象存储负责)。
   */
  async buildUrl(record: ArtifactRecord, requestBaseUrl?: string): Promise<string> {
    return this.store.buildUrl(record, {
      requestBaseUrl,
      hmacQuery: this.signQuery(record.id),
    });
  }

  /** MCP 端点鉴权:配置了 token 才校验,未配置时(开发)放行 */
  checkBearer(authorization: string | undefined): boolean {
    const token = this.config.authToken;
    if (!token) return true;
    if (!authorization) return false;
    return safeEqual(authorization.trim(), `Bearer ${token}`);
  }

  /**
   * 产物 URL 签名校验。
   * 只对 fs 交付有意义(s3 的签名在对象存储侧校验);未配置 token 时视为通过。
   */
  checkSignature(id: string, exp?: string, sig?: string): boolean {
    const token = this.config.authToken;
    if (!token || this.store.kind === 's3') return true;
    if (!exp || !sig) return false;
    const expiresAt = Number(exp);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return false;
    return safeEqual(sig, this.signature(id, exp));
  }

  /**
   * 清理过期产物(节流:最多 5 分钟一次)。
   * 仅 fs 适配器需要;对象存储交给 bucket lifecycle rule。
   */
  async sweepExpired(force = false): Promise<void> {
    if (!this.config.enabled || this.store.kind !== 'fs') return;
    const now = Date.now();
    if (!force && now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const id of await this.store.listRecordIds()) {
      const record = await this.store.loadRecord(id);
      if (record && Date.parse(record.expiresAt) <= now) {
        await this.store.remove(record);
      }
    }
  }

  /* ------------------------------ 内部实现 ------------------------------ */

  private generateId(sha256: string): string {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = randomBytes(3).toString('hex');
    return `${day}-${sha256.slice(0, 16)}-${random}`;
  }

  private signQuery(id: string): string {
    if (!this.config.authToken || this.store.kind === 's3') return '';
    const exp = Math.floor((Date.now() + this.config.ttlSeconds * 1000) / 1000);
    const sig = this.signature(id, String(exp));
    return `?exp=${exp}&sig=${sig}`;
  }

  private signature(id: string, exp: string): string {
    return createHmac('sha256', this.config.authToken ?? '')
      .update(`${id}:${exp}`)
      .digest('hex');
  }
}

let singleton: ArtifactService | null = null;

/** 进程级单例:MCP 的无状态 server 与 Nest DI 共用同一个实例 */
export function getArtifactService(config?: ArtifactConfig): ArtifactService {
  singleton ??= new ArtifactService(config);
  return singleton;
}
