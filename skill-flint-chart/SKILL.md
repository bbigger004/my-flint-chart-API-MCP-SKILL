---
name: flint-chart
description: "画图表、数据可视化、生成统计图的唯一入口。任何时候用户想要「画个图」「做个图表」「可视化一下」「出张图」，或需要柱状图/折线图/饼图/散点图/热力图/桑基图/KPI 卡片等，都必须用这个 skill。底层是 Flint 图表 MCP（flint__render_chart 等工具），支持 95 个图表模板、3 个可渲染后端（vegalite/echarts/chartjs）、10 套品牌主题。本 skill 的关键是让生成的图**直接显示在对话里**。Also trigger for 'plot this', 'make a chart', 'visualize this data', 'render a chart'."
metadata:
  qwenpaw:
    emoji: "📊"
    requires: {}
---

# Flint 图表

Flint 是一个图表渲染服务，通过 MCP 暴露给 agent。能力：**95 个图表模板 × 3 个可渲染后端 × 10 套主题**。

本 skill 的核心目标不只是「把图渲染出来」，而是**让用户在对话里直接看到图**。这两件事不是一回事——渲染成功但用户看不见，等于没做。

---

## 三条铁律（先读这个）

### 1. 图必须在「你自己的回复正文」里，不能只在工具结果里

工具返回的 markdown 图片链接，**只有被复制进助手回复正文时才会渲染**。留在工具结果卡片里用户是看不到的。

```
✅ 正确：工具返回 ![](http://localhost:3000/api/flint/artifacts/xxx)
        → 你在回复正文里原样写一遍这一行
❌ 错误：调完工具就直接说「图已生成」 —— 用户什么也看不到
```

### 2. 用 `delivery="url"` + `format="png"`

- `delivery` 服务端默认已是 `url`（返回图片链接）。**不要用 `inline`**——console 会丢弃内联图片块，历史上就这么踩过坑。
- `format="png"` 最稳。`chartjs` 后端**只支持 png**（传 svg 会报错）；vegalite/echarts 两者都行，但展示场景一律 png。

### 3. 你看不见自己生成的图

你是纯文本模型，图片字节会被剥离。所以：
- **不要**声称「图看起来不错」「配色很协调」——你没看过。
- 只能说客观事实：尺寸、后端、是否成功、有没有警告。
- 用户如果问视觉问题（文字重叠、配色），如实说需要他自己确认。

---

## 一次调用的完整流程

```
1. 想清楚图型 → 见下方「图表类型选择」
2. 调用 flint__render_chart，参数：data + semantic_types + chart_spec + backend + format + delivery
3. 读返回：第一行是 `后端 · 格式 · 宽×高px`
4. 取出返回里的 ![chart](url) 那一行
5. 把这一行写进你的回复正文
6. 顺带说明：图型、维度、尺寸；有 warnings 就转述
```

### 工具返回怎么读

```
vegalite · png · 720×587px          ← 后端 · 格式 · 尺寸（用来向用户汇报）
![chart](http://localhost:3000/...)  ← ★ 必须粘贴进正文的就是这一行
产物链接: http://localhost:3000/...
artifactId: 20260910-b8f4e9b7642058e8-25aa3b
mimeType: image/png
expiresAt: 2026-09-17T10:16:55.956Z  ← 产物 7 天后过期，用户要长期保存就得下载
```

失败时会返回 `isError: true` 和中文错误说明；有 `warnings` 时把警告**如实转述**给用户（很多警告是在提示数据语义问题，很有价值）。

---

## 请求参数

```json
{
  "data": { "values": [ {"字段A": "...", "字段B": 123}, ... ] },
  "semantic_types": { "字段A": "Category", "字段B": "Quantity" },
  "chart_spec": {
    "chartType": "Bar Chart",
    "title": "一句话结论（强烈建议）",
    "subtitle": "统计口径，如 2025 年月活（万）",
    "encodings": { "x": {"field": "字段A"}, "y": {"field": "字段B"} },
    "baseSize": { "width": 720, "height": 420 }
  },
  "field_display_names": { "字段A": "展示名" },
  "theme_spec": "economist",
  "backend": "vegalite",
  "format": "png",
  "delivery": "url"
}
```

| 参数 | 要点 |
|---|---|
| `data.values` | **必须内联**。`data.url` 已被服务端禁用，传了不生效。 |
| `semantic_types` | 强烈建议填。决定轴/比例尺/聚合行为。取值：`Category` `Quantity` `Temporal` 等。**不要显式传 `null`**（schema 会拒），不想填就整个省略。 |
| `chart_spec.title` | 很多设计语言会去掉轴标题，全靠 title 说明指标含义，**务必填**。 |
| `encodings` | 通道要与模板匹配，见 `references/chart-types.md`。传了模板不支持的通道会被拒绝，错误信息会列出支持的通道。 |
| `theme_spec` | 10 套：`nyt` `economist` `swiss` `nature` `mckinsey` `datawrapper` `powerbi` `powerbi-light` `pop` `cartoon`。三个后端都生效。 |
| `backend` | `vegalite`（最全，36 模板）/ `echarts`（37，适合桑基、树图、仪表盘）/ `chartjs`（22，只出 png）。别名 `vega-lite` `chart.js` 也接受。 |
| `field_display_names` | 字段是英文时，用它可以给出中文轴标签/图例名。 |

> **`plotly` 和 `excel` 后端只能编译不能渲染**，MCP 里调不通，别用。

---

## 图表类型选择

| 用户意图 | 推荐 chartType | 后端 |
|---|---|---|
| 比较大小 / 排名 | `Bar Chart`、`Grouped Bar Chart` | vegalite |
| 占比构成 | `Stacked Bar Chart`、`Pie Chart`、`Donut Chart`、`Treemap` | vegalite（树图用 echarts） |
| 趋势 / 时间序列 | `Line Chart`、`Area Chart`、`Streamgraph` | vegalite |
| 多系列趋势对比 | `Line Chart` + `color` | vegalite |
| 两个变量关系 | `Scatter Plot`、`Bubble Chart`、`Regression` | vegalite |
| 分布 | `Histogram`、`Boxplot`、`Violin Plot`、`Density Plot` | vegalite |
| 增减拆解（瀑布） | `Waterfall Chart` | vegalite |
| 时间跨度 / 排期 | `Gantt Chart` | vegalite |
| 完成度 / 达成率 | `Bullet Chart`、`Gauge Chart` | vegalite（仪表盘用 echarts） |
| 日历热力 | `Calendar Heatmap` | vegalite / echarts |
| 二维热力 | `Heatmap` | vegalite |
| 多指标对比（雷达） | `Radar Chart`、`Rose Chart` | vegalite |
| 流向 / 转化路径 | `Sankey Diagram`、`Funnel Chart` | echarts |
| 层级结构 | `Sunburst Chart`、`Tree`、`Treemap` | echarts |
| 关系网络 | `Network Graph` | echarts |
| 单值指标卡 | `KPI Card` | vegalite |
| 极简趋势（嵌入式） | `Sparkline` | vegalite |
| 地图 | `Map`、`Choropleth` | vegalite |

完整清单（95 个模板 + 各自支持的通道）见 **`references/chart-types.md`**。
不确定有哪些模板时，也可以调 `flint__list_chart_types`。

---

## 已知陷阱

这些是实测确认过的行为，踩了会浪费时间。下表尺寸类结论为 **2026-09-10 构建**直接实测所得：

| 陷阱 | 说明与对策 |
|---|---|
| **图不显示** | 最常见原因：链接只留在工具结果里。必须粘进回复正文。 |
| **`data.url` 无效** | 服务端已禁用远程取数，必须 `data.values` 内联。 |
| **chartjs 传 svg 报错** | chartjs 引擎没有 SVG 输出，一律 `format="png"`。 |
| **显式传 `null` 被拒** | 可选字段不想填就省略键，别传 `null`。 |
| **Waterfall 合计行** | 合计行的 `类型` 用 `total` / `合计` / `end` 都可以，会被按 `end` 处理并锚定 0 轴，同时返回一条 info 警告——那是正常提示，转述即可。 |
| **尺寸只有 vegalite 好预测** | vegalite 输出**宽度精确等于** `baseSize.width`；echarts / chartjs 会比请求值放大（实测同样请求 720×420：echarts 出 844×517、chartjs 出 800×500）。要精确控尺寸就选 vegalite。 |
| **高度是浮动的** | vegalite 输出高度在 `baseSize.height` 附近浮动（实测 700→700、700→712、420→498、320→336/367、250→299），受标题长度换行、坐标轴标签、分面行数影响。**高度只能当近似值**，别按像素精确规划。 |
| **分面不会放大画布（vegalite）** | 实测 2 列分面请求 400×300 出 400×387，2×2 分面出 400×438——宽度始终是 400，**格子被压窄**。所以格子多时要主动调大 `baseSize`，否则每格挤成一团。（chartjs 的 `Radar` / `Rose` 9 格分面反而会倍增画布，见下行。） |
| **chartjs Radar/Rose 分面会倍增** | 9 格分面时画布按格数倍增：`baseSize` 480×360 → 1500×1134；900×700 → 2760×2154，且 `canvasSize` 拦不住。（上一轮复测所得。） |
| **`canvasSize` 别依赖** | 实测 vegalite 请求 baseSize 900×700 + canvasSize 上限 500×400，输出仍是 900×700；chartjs 分面下同样无效。想控尺寸就调 `baseSize`。 |
| **chartjs 分面固定尺寸** | `Histogram` / `Gantt Chart` / `Range Area Chart` 在 chartjs 分面时忽略 baseSize，恒定 1260×954。（上一轮复测所得，本轮未逐项复核。） |
| **echarts 产物非确定性** | 每次渲染类名带随机计数器，字节不同（视觉一致）。别指望产物字节可复现。 |
| **产物 7 天过期** | 用户要长期保存的图，用 `scripts/fetch_chart.py` 下载到本地。 |
| **取产物时卡住/502** | 本机有系统级代理 `127.0.0.1:7890` 且不排除 localhost。脚本已内置禁用代理；自己写代码取产物时记得 `ProxyHandler({})`。 |

---

## 回退：如果图还是显示不出来

极少数情况下图片链接可能不渲染。此时把图落盘后作为文件发给用户：

```bash
cd {本 skill 目录} && python3 scripts/fetch_chart.py <产物URL> <输出路径>
```

拿到本地文件后调用 `send_file_to_user` 发出去。这一步是**兜底**，正常情况下不需要。

---

## 完整示例

用户：「帮我把这几个渠道的营收画个柱状图」

```json
{
  "data": { "values": [
    {"渠道": "官网", "营收": 128},
    {"渠道": "应用商店", "营收": 96},
    {"渠道": "合作方", "营收": 74},
    {"渠道": "线下", "营收": 52}
  ]},
  "semantic_types": { "渠道": "Category", "营收": "Quantity" },
  "chart_spec": {
    "chartType": "Bar Chart",
    "title": "官网渠道贡献最高，占四成营收",
    "subtitle": "各渠道营收（万元）",
    "encodings": { "x": {"field": "渠道"}, "y": {"field": "营收"} },
    "baseSize": { "width": 720, "height": 420 }
  },
  "theme_spec": "economist",
  "backend": "vegalite",
  "format": "png",
  "delivery": "url"
}
```

然后在回复里：

> 已生成，官网渠道最高（128 万）：
>
> ![chart](http://localhost:3000/api/flint/artifacts/20260910-xxxx-xxxx)

**「然后在回复里贴链接」这一步不能省。**
