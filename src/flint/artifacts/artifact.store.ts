/**
 * 存储适配器实现:本地文件系统(fs)与 S3 兼容对象存储(s3)。
 *
 * fs  :单机/开发用,目录原子写,元数据 sidecar 作提交标记;
 * s3  :生产用,兼容 AWS S3 / 阿里云 OSS / MinIO(S3 API);
 *      交付 URL 直接给对象存储预签名地址,不再经过本服务转发。
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ARTIFACT_URL_PREFIX, type ArtifactConfig } from './artifact.config';
import {
  ArtifactStoreError,
  type ArtifactRecord,
  type ArtifactStore,
} from './artifact.types';

/** 本地文件系统适配器 */
export class FsArtifactStore implements ArtifactStore {
  readonly kind = 'fs' as const;

  constructor(private readonly dir: string) {}

  async save(record: ArtifactRecord, bytes: Buffer): Promise<void> {
    this.ensureDir();
    // 先写数据,再写元数据;元数据存在即视为"提交完成"
    this.atomicWrite(this.dataPath(record.id, record.extension), bytes);
    this.atomicWrite(
      this.metaPath(record.id),
      Buffer.from(JSON.stringify(record, null, 2), 'utf8'),
    );
  }

  async loadRecord(id: string): Promise<ArtifactRecord | null> {
    try {
      const parsed = JSON.parse(readFileSync(this.metaPath(id), 'utf8')) as ArtifactRecord;
      if (!parsed || parsed.id !== id || !parsed.extension) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async loadBytes(record: ArtifactRecord): Promise<Buffer> {
    return readFileSync(this.dataPath(record.id, record.extension));
  }

  async remove(record: ArtifactRecord): Promise<void> {
    for (const path of [this.metaPath(record.id), this.dataPath(record.id, record.extension)]) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // 清理失败不影响主流程,交给下一次 sweep
      }
    }
  }

  async listRecordIds(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length));
  }

  async buildUrl(
    record: ArtifactRecord,
    context: { requestBaseUrl?: string; hmacQuery?: string },
  ): Promise<string> {
    const base = this.publicBaseUrl ?? context.requestBaseUrl ?? '';
    return `${base}${ARTIFACT_URL_PREFIX}/${record.id}${context.hmacQuery ?? ''}`;
  }

  /** 由 createArtifactStore 注入,避免 store 依赖 service 的签名逻辑 */
  publicBaseUrl: string | null = null;

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true, mode: 0o750 });
  }

  private dataPath(id: string, extension: string): string {
    return join(this.dir, `${id}.${extension}`);
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private atomicWrite(path: string, data: Buffer): void {
    const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(temp, data, { mode: 0o640 });
    renameSync(temp, path); // 同目录 rename 在 POSIX 上原子
  }
}

/** S3 兼容对象存储适配器(AWS S3 / OSS / MinIO) */
export class S3ArtifactStore implements ArtifactStore {
  readonly kind = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly config: ArtifactConfig) {
    const { bucket, region, accessKeyId, secretAccessKey, endpoint, forcePathStyle } =
      config.s3;
    if (!bucket) {
      throw new ArtifactStoreError(
        'FLINT_ARTIFACT_STORE=s3 需要设置 S3_BUCKET(AWS/OSS/MinIO 的桶名)',
      );
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new ArtifactStoreError(
        'FLINT_ARTIFACT_STORE=s3 需要设置 S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY',
      );
    }
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async save(record: ArtifactRecord, bytes: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: this.dataKey(record),
        Body: bytes,
        ContentType: record.mimeType,
      }),
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: this.metaKey(record.id),
        Body: Buffer.from(JSON.stringify(record, null, 2), 'utf8'),
        ContentType: 'application/json',
      }),
    );
  }

  async loadRecord(id: string): Promise<ArtifactRecord | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: this.metaKey(id) }),
      );
      const body = await response.Body?.transformToByteArray();
      if (!body) return null;
      const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as ArtifactRecord;
      return parsed?.id === id ? parsed : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async loadBytes(record: ArtifactRecord): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: this.dataKey(record) }),
    );
    const body = await response.Body?.transformToByteArray();
    if (!body) throw new ArtifactStoreError(`对象存储中的产物为空:${record.id}`);
    return Buffer.from(body);
  }

  async remove(record: ArtifactRecord): Promise<void> {
    await Promise.allSettled([
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: this.dataKey(record) }),
      ),
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: this.metaKey(record.id) }),
      ),
    ]);
  }

  /** 对象存储的过期清理交给 bucket lifecycle rule,这里返回空列表 */
  async listRecordIds(): Promise<string[]> {
    return [];
  }

  /**
   * 直接返回对象存储的预签名 GET URL。
   * 签名有效期不超过 7 天(SigV4 上限),由 FLINT_ARTIFACT_TTL_SECONDS 控制。
   */
  async buildUrl(record: ArtifactRecord): Promise<string> {
    const expiresIn = Math.min(this.config.ttlSeconds, 7 * 24 * 3600);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: this.dataKey(record),
        ResponseContentType: record.mimeType,
      }),
      { expiresIn },
    );
  }

  private dataKey(record: ArtifactRecord): string {
    return `${this.config.s3.prefix}/${record.id}.${record.extension}`;
  }

  private metaKey(id: string): string {
    return `${this.config.s3.prefix}/${id}.json`;
  }
}

/** S3 SDK 的 NoSuchKey / 404 判定 */
function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

/** 按配置创建存储适配器(启动期失败快速暴露配置问题) */
export function createArtifactStore(config: ArtifactConfig): ArtifactStore {
  if (config.store === 's3') {
    return new S3ArtifactStore(config);
  }
  const store = new FsArtifactStore(config.dir);
  store.publicBaseUrl = config.publicBaseUrl;
  return store;
}
