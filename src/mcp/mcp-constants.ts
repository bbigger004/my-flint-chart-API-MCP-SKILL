/**
 * MCP(Streamable HTTP)模块的公共常量。
 *
 * 渲染后端枚举与安全上限已下沉到 `src/flint/render/render.types.ts`
 * (REST 渲染接口与 MCP 共用),这里只保留传输层自己的常量。
 */

/** MCP Streamable HTTP 端点路径,挂在 Nest 主进程的 /mcp 上(不经过 /api 前缀) */
export const MCP_PATH = '/mcp';

/** MCP server 元信息:QwenPaw / Claude Desktop 等客户端会展示这些字段 */
export const MCP_SERVER_NAME = 'flint-chart-mcp';
export const MCP_SERVER_VERSION = '1.0.0';

/** HTTP body 上限:inline data 可能不小,给足 32MiB */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
