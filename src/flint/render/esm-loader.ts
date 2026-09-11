/**
 * 原生 ESM 动态导入工具。
 *
 * 为什么需要它:
 * 后端目前以 CommonJS 编译(nest build 默认输出 CJS),而 vega / vega-lite
 * 是纯 ESM 包且带顶层 await,Node 的 require() 无法加载它们
 * (会抛 ERR_REQUIRE_ASYNC_MODULE)。
 *
 * TypeScript 在 module=commonjs 下会把 `await import('x')` 降级成
 * `require('x')`,同样踩坑。这里的 new Function 绕开了 TS 的降级:
 * 函数体内写的是语法层面的动态 import(),Node 运行时把它当真正的
 * ESM import 处理,于是 CJS 文件也能加载 ESM-only 的包。
 *
 * 只应在本模块内使用,并且只用于“确实无法被 require”的 ESM 包;
 * 其余包(echarts/chart.js/@napi-rs/canvas/@resvg)走普通静态导入即可。
 */
type EsmImporter = (specifier: string) => Promise<Record<string, any>>;

/** 在 CJS 环境里执行原生 import(specifier) 的动态加载器 */
export const importEsm: EsmImporter = new Function(
  'specifier',
  'return import(specifier)',
) as EsmImporter;
