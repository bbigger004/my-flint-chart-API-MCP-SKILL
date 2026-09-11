/**
 * 从 HTTP 请求推导"对外可访问"的 base URL。
 *
 * 生产部署通常在反向代理/Ingress 后面,`req.protocol`/`req.host` 可能指向
 * 容器内部地址,因此优先读 `x-forwarded-proto` / `x-forwarded-host`;
 * 如果配置了 FLINT_PUBLIC_BASE_URL,artifact service 会优先使用配置值。
 */
import type { Request } from 'express';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

export function requestBaseUrl(req: Request): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const proto = forwardedProto || req.protocol || 'http';
  const host =
    forwardedHost || req.headers.host || req.get?.('host') || 'localhost';
  return `${proto}://${host}`;
}
