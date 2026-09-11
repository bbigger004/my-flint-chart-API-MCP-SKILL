/**
 * 把 MCP Server 挂到 Express/Nest 的 /mcp 上(Streamable HTTP,无状态)。
 *
 * 为什么“每次请求都新建 server + transport”?
 * Streamable HTTP 的无状态模式约定:每个 POST 都是完整、独立的 JSON-RPC
 * 消息交换,不需要会话 ID。这样:
 * - 部署简单:多副本/无状态容器随便横向扩;
 * - 没有会话表,自然没有会话泄漏/过期问题;
 * - QwenPaw / Claude 等客户端每次 initialize / tools/list / tools/call
 *   都会带自己的消息 id,不会串号。
 *
 * 兼容性说明:官方 flint-chart-mcp 的 HTTP 实现(0.5.x)也是同样的
 * “POST-only stateless”模式,并被 SDK 客户端测试覆盖;因此这里不额外
 * 实现 GET 的 SSE 长连接,POST 直答 JSON 即可被标准 Streamable HTTP 客户端识别。
 */
import type { Request, Response } from 'express';
import { Router, json as jsonParser } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getArtifactService } from '../flint/artifacts/artifact.service';
import { requestBaseUrl } from '../flint/artifacts/public-url';
import { MAX_BODY_BYTES } from './mcp-constants';
import { createFlintMcpServer } from './mcp-server';

/** 服务端无法返回结构化错误时的兜底响应(不依赖任何 MCP SDK 状态) */
function sendJsonRpcError(res: Response, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code: status === 400 ? -32700 : -32600, message },
    id: null,
  });
}

/**
 * 处理单个 POST /mcp 请求。
 * req.body 由下方 jsonParser 提前解析;把 Express 的 req/res 原样交给
 * transport.handleRequest —— SDK 负责把 Node 的 HTTP 对象转成 Web 标准
 * Request/Response,并按 Accept 头决定“直接 JSON 响应”还是“SSE 响应”。
 */
async function handleMcpPost(req: Request, res: Response): Promise<void> {
  // 配置了 FLINT_MCP_AUTH_TOKEN 时,/mcp 必须是带 Bearer 的请求
  const artifacts = getArtifactService();
  if (!artifacts.checkBearer(req.headers.authorization)) {
    sendJsonRpcError(res, 401, 'missing or invalid Authorization bearer token');
    return;
  }

  // 产物 URL 需要对外可访问的 base:优先配置项,其次请求头推导
  const server = createFlintMcpServer({ baseUrl: requestBaseUrl(req) });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态:不给客户端发会话 ID
    enableJsonResponse: true, // 客户端没要求 SSE 时,直接回 JSON
  });
  // 请求结束(无论成功失败)就把本次的 server/transport 收掉,避免泄漏
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

/**
 * 生成挂载到 Nest 主进程的 Express Router。
 * 用法:app.use(MCP_PATH, createMcpRouter())
 */
export function createMcpRouter(): Router {
  const router = Router();

  // MCP 请求体可能是很大的内联数据,限制放宽到 32MiB。
  // strict:false 允许最外层不是严格 JSON 对象(JSON-RPC 消息本身是对象,
  // 但保留与官方实现一致的宽容度)。
  // type:'*/*' 是为了对齐官方实现:不管 content-type 是不是 application/json,
  // 都把原始 body 当 JSON 解析;strict:false 允许任意合法 JSON 根值。
  router.use(jsonParser({ limit: MAX_BODY_BYTES, strict: false, type: '*/*' }));

  router.post('/', async (req: Request, res: Response) => {
    try {
      await handleMcpPost(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJsonRpcError(res, 500, message);
    }
  });

  // 无状态 Streamable HTTP 服务只接受 POST;GET(SSE 长连接)与 DELETE(会话
  // 销毁)在此模式下没有会话可依附,统一返回 405,让客户端立刻感知并回退。
  router.all('/', (req: Request, res: Response) => {
    if (req.method === 'POST') return; // 已被上面的 post 路由处理
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'method not allowed; use POST for the /mcp endpoint',
      },
      id: null,
    });
  });

  return router;
}
