/**
 * 产物交付配置(进程启动时从环境变量读取一次)。
 *
 * 生产形态:产物写入对象存储/共享存储,通过 HTTPS URL 交付;
 * 开发形态:用 fs 适配器写本地目录,同样通过 /api/flint/artifacts/:id 交付。
 * 无论哪种形态,响应里都不会出现服务器文件系统路径。
 */
import { join } from 'node:path';

/** 交付模式:内联 payload / 只回 URL / 两者都给 */
export type ArtifactDelivery = 'inline' | 'url' | 'both';

/** 存储类型:本地文件系统 / S3 兼容对象存储 */
export type ArtifactStoreKind = 'fs' | 's3';

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** MinIO / OSS 一般需要 path-style;AWS 默认可关闭 */
  forcePathStyle: boolean;
  /** 对象 key 前缀,便于与其他业务共用同一个桶 */
  prefix: string;
}

export interface ArtifactConfig {
  /** 存储类型:单机 fs,生产 s3 */
  store: ArtifactStoreKind;
  /** 总开关:FLINT_ARTIFACT_WRITE=0 关闭落盘(关闭后只能 inline 交付) */
  enabled: boolean;
  /** 产物目录(fs 适配器用);生产接对象存储后此项目仅作本地回退 */
  dir: string;
  /** 签名 URL / 文件保留的有效期(秒),默认 7 天 */
  ttlSeconds: number;
  /** 单个产物字节上限,防止超大图拖垮存储 */
  maxBytes: number;
  /** render_chart / REST 未显式传 delivery 时的默认模式 */
  defaultDelivery: ArtifactDelivery;
  /** 对外 HTTPS 域名(如 https://flint.example.com);设置后 URL 用它拼绝对地址 */
  publicBaseUrl: string | null;
  /** 鉴权 token;设置后 MCP 端点要求 Bearer,产物 URL 走 HMAC 签名 */
  authToken: string | null;
  /** S3 兼容对象存储配置 */
  s3: S3Config;
}

/** 产物下载路由的固定前缀(挂在全局 /api 前缀下) */
export const ARTIFACT_URL_PREFIX = '/api/flint/artifacts';

/** 允许的自定义 artifact_id 形状:短名白名单,杜绝路径穿越 */
export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const FALSY = new Set(['0', 'false', 'off', 'no', '']);

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return !FALSY.has(raw.trim().toLowerCase());
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 把环境变量字符串规范化成交付模式;非法值退回 inline(兼容旧行为) */
export function normalizeDelivery(raw: string | undefined): ArtifactDelivery {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'url' || value === 'both' ? value : 'inline';
}

/** 读取环境变量的抽象:既能来自 process.env,也能来自 Nest ConfigService */
export type EnvReader = (key: string) => string | undefined;

/**
 * 从任意 env 读取器构造配置。
 * Nest 侧注入 ConfigService,把 .env 的加载交给 @nestjs/config;
 * MCP 单例与测试仍可用下面的 loadArtifactConfig(process.env)。
 */
export function loadArtifactConfigFrom(read: EnvReader): ArtifactConfig {
  const store: ArtifactStoreKind =
    (read('FLINT_ARTIFACT_STORE') ?? '').trim().toLowerCase() === 's3' ? 's3' : 'fs';
  return {
    store,
    enabled: readBoolean(read('FLINT_ARTIFACT_WRITE'), true),
    dir: read('FLINT_ARTIFACT_DIR')?.trim() || join(process.cwd(), 'output', 'artifacts'),
    ttlSeconds: readPositiveInt(read('FLINT_ARTIFACT_TTL_SECONDS'), 7 * 24 * 3600),
    maxBytes: readPositiveInt(read('FLINT_ARTIFACT_MAX_BYTES'), 16 * 1024 * 1024),
    defaultDelivery: normalizeDelivery(read('FLINT_ARTIFACT_DELIVERY')),
    publicBaseUrl: read('FLINT_PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') || null,
    authToken: read('FLINT_MCP_AUTH_TOKEN')?.trim() || null,
    s3: {
      endpoint: read('S3_ENDPOINT')?.trim() || undefined,
      region: read('S3_REGION')?.trim() || 'us-east-1',
      bucket: read('S3_BUCKET')?.trim() || undefined,
      accessKeyId: read('S3_ACCESS_KEY_ID')?.trim() || undefined,
      secretAccessKey: read('S3_SECRET_ACCESS_KEY')?.trim() || undefined,
      forcePathStyle: readBoolean(read('S3_FORCE_PATH_STYLE'), true),
      prefix:
        read('FLINT_ARTIFACT_S3_PREFIX')?.trim().replace(/^\/+|\/+$/g, '') || 'flint-artifacts',
    },
  };
}

/** 从 process.env(或传入的 env 对象)构造配置 */
export function loadArtifactConfig(env: NodeJS.ProcessEnv = process.env): ArtifactConfig {
  return loadArtifactConfigFrom((key) => env[key]);
}
