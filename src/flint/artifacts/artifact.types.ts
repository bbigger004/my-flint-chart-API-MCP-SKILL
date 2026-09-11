/**
 * 产物存储的公共类型与存储适配器接口。
 *
 * 上层(ArtifactService / REST / MCP)只依赖这里的 ArtifactStore,
 * 不关心字节到底落在本地磁盘还是对象存储。
 */

/** 写产物时调用方要提供的元信息 */
export interface ArtifactMeta {
  mimeType: string;
  /** 文件扩展名:png | svg */
  extension: 'png' | 'svg';
  width?: number;
  height?: number;
  warnings?: unknown[];
}

/** 落盘/上传结果(可安全序列化进响应,不含绝对路径) */
export interface ArtifactRecord {
  id: string;
  extension: string;
  mimeType: string;
  size: number;
  sha256: string;
  width?: number;
  height?: number;
  warnings?: unknown[];
  createdAt: string;
  expiresAt: string;
}

export interface StoredArtifact {
  record: ArtifactRecord;
  bytes: Buffer;
}

export interface PutOptions {
  /** 调用方指定短名;不传则按内容哈希生成 */
  artifactId?: string;
  /** 同名不同内容是否允许覆盖,默认 false */
  overwrite?: boolean;
}

/** 产物层错误(上层转成 400/500,不掺协议细节) */
export class ArtifactStoreError extends Error {}

/** 存储适配器:fs(单机)与 s3(对象存储)两种实现 */
export interface ArtifactStore {
  readonly kind: 'fs' | 's3';
  /** 保存元数据 + 字节 */
  save(record: ArtifactRecord, bytes: Buffer): Promise<void>;
  /** 读元数据;不存在/已过期由 ArtifactService 判断 */
  loadRecord(id: string): Promise<ArtifactRecord | null>;
  /** 读字节 */
  loadBytes(record: ArtifactRecord): Promise<Buffer>;
  /** 删除元数据 + 字节 */
  remove(record: ArtifactRecord): Promise<void>;
  /** 列出全部元数据 id(供 fs 清理使用;s3 交给 bucket lifecycle) */
  listRecordIds(): Promise<string[]>;
  /**
   * 构造可交付 URL。
   * fs:返回本服务 /api/flint/artifacts/:id(可带 HMAC 签名);
   * s3:返回对象存储预签名 URL。
   */
  buildUrl(
    record: ArtifactRecord,
    context: { requestBaseUrl?: string; hmacQuery?: string },
  ): Promise<string>;
}
