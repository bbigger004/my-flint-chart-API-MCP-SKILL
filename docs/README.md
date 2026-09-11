# backend/docs —— 文档素材库

本目录存放 `backend/README.md` 用到的图片,以及它们的**可编辑源文件**。
所有引用都用相对路径(`./docs/images/...`),把 `backend/` 单独拷走也能正常显示。

```text
docs/
├── images/     # README 直接引用的 PNG
└── diagrams/   # 架构图的 HTML 源文件 + 截图脚本
```

---

## images/

| 文件 | 用途 | 说明 |
|---|---|---|
| `01-system-topology.png` | README 概述 | 系统拓扑:前端 / Agent / 后端 / 渲染库 / 产物存储的关系 |
| `02-compile-sequence.png` | README「HTTP 接口」 | 一次编译请求的时序 |
| `03-compiler-pipeline.png` | README「渲染管线」 | 校验 → 规范化 → 编译 → 标题补齐 → 渲染 → 交付 |
| `04-repo-module-map.png` | README「目录结构」 | 仓库模块地图 |
| `theme-gallery-hero.png` | README「主题映射范围」 | 3 后端 × 5 主题的对比拼版(精选) |

均为 1920×1080(主题拼版尺寸见文件本身)。

---

## diagrams/

| 文件 | 说明 |
|---|---|
| `01-system-topology.html` | 系统拓扑图源文件(HTML/CSS,可编辑) |
| `02-compile-sequence.html` | 编译时序图源文件 |
| `03-compiler-pipeline.html` | 编译管线图源文件 |
| `04-repo-module-map.html` | 模块地图源文件 |
| `screenshot.mjs` | 把上面的 HTML 批量渲染成 1920×1080 PNG(输出到 `../images/`) |

### 修改并重新生成图片

1. 编辑对应的 `.html`(纯 HTML/CSS,不需要构建);
2. 准备依赖(只需一次):

   ```bash
   npm i -D playwright-core
   npx playwright install chromium-headless-shell
   ```

3. 在仓库任意位置执行:

   ```bash
   node backend/docs/diagrams/screenshot.mjs
   ```

   脚本按自身所在目录查找 HTML,并把 PNG 写到 `backend/docs/images/`。

`screenshot.mjs` 查找 `playwright-core` 的顺序:
环境变量 `PLAYWRIGHT_CORE` → 项目内 `playwright-core` → 本机 dashi-ppt skill 自带副本。
找不到浏览器缓存时会给出明确提示。

---

## 素材来源

| 素材 | 原始位置 | 关系 |
|---|---|---|
| 4 张架构图(HTML + PNG) | `output/flint-architecture/diagrams/` | 本项目 PPT/图表流水线产物,已复制到本目录;原目录仍在,可继续用于 PPT |
| `theme-gallery-hero.png` | `examples/theme-gallery/contact-sheet-hero.png` | 由 `backend/scripts/generate-theme-gallery.js` 生成 |
| 完整主题图册 | `examples/theme-gallery/` | 30 张单图 + 两张拼版 + `index.html` |

> 说明:本目录是**副本**,方便 README 自包含;更新上游素材后重新复制即可。
