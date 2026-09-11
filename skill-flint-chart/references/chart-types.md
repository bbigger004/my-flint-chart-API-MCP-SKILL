# Flint 图表模板全清单（95 个）

本文件由 `scripts/gen_chart_types.py` 从服务端真实注册表生成，**与实际能力一致**。

> 每个模板后面方括号里是它**支持的编码通道**。传给模板不支持的通道会被服务端拒绝，
> 错误信息会列出该模板实际支持的通道。

## 后端总览

| 后端 | 可渲染 | 模板数 | 适用场景 |
|---|---|---|---|
| `vegalite` | ✅ | 36 | 最通用，模板最全，优先选它 |
| `echarts` | ✅ | 37 | 适合桑基图/树图/仪表盘/地图等 vegalite 没有的图型 |
| `chartjs` | ✅ | 22 | 只输出 PNG（不支持 SVG） |
| `plotly` | ❌ | 38 | ⚠️ **只能 compile，不能 render，MCP 里调不通** |
| `excel` | ❌ | 18 | ⚠️ **只能 compile，不能 render，MCP 里调不通** |

**共 95 个可渲染模板**（vegalite 36 + echarts 37 + chartjs 22）。

## `vegalite` — 36 个模板

| 图表模板 | 支持的通道 |
|---|---|
| `Area Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Bar Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Bar Table` | `y` `x` `color` `column` `row` |
| `Boxplot` | `x` `y` `color` `opacity` `column` `row` |
| `Bullet Chart` | `y` `x` `goal` `color` `column` `row` |
| `Bump Chart` | `x` `y` `color` `detail` `column` `row` |
| `Calendar Heatmap` | `x` `color` |
| `Candlestick Chart` | `x` `open` `high` `low` `close` `column` `row` |
| `Choropleth` | `id` `color` `detail` |
| `Connected Scatter Plot` | `x` `y` `order` `color` `detail` `column` `row` |
| `Density Plot` | `x` `color` `column` `row` |
| `Donut Chart` | `size` `color` `column` `row` |
| `ECDF Plot` | `x` `color` `detail` `column` `row` |
| `Gantt Chart` | `y` `x` `x2` `color` `detail` `column` `row` |
| `Grouped Bar Chart` | `x` `y` `group` `column` `row` |
| `Heatmap` | `x` `y` `color` `column` `row` |
| `Histogram` | `x` `color` `column` `row` |
| `KPI Card` | `metric` `value` `goal` |
| `Line Chart` | `x` `y` `color` `strokeDash` `detail` `opacity` `column` `row` |
| `Lollipop Chart` | `x` `y` `color` `column` `row` |
| `Map` | `longitude` `latitude` `color` `size` `opacity` |
| `Pie Chart` | `size` `color` `column` `row` |
| `Pyramid Chart` | `x` `y` `color` |
| `Radar Chart` | `x` `y` `color` `column` `row` |
| `Range Area Chart` | `x` `y` `y2` `color` `column` `row` |
| `Ranged Dot Plot` | `x` `y` `color` |
| `Regression` | `x` `y` `size` `color` `column` `row` |
| `Rose Chart` | `x` `y` `color` `column` `row` |
| `Scatter Plot` | `x` `y` `color` `size` `shape` `opacity` `column` `row` |
| `Slope Chart` | `x` `y` `color` `detail` `column` `row` |
| `Sparkline` | `x` `y` `color` `detail` `row` `column` |
| `Stacked Bar Chart` | `x` `y` `color` `column` `row` |
| `Streamgraph` | `x` `y` `color` `column` `row` |
| `Strip Plot` | `x` `y` `color` `size` `column` `row` |
| `Violin Plot` | `x` `y` `color` `row` |
| `Waterfall Chart` | `x` `y` `color` `column` `row` |

## `echarts` — 37 个模板

| 图表模板 | 支持的通道 |
|---|---|
| `Area Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Bar Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Boxplot` | `x` `y` `color` `opacity` `column` `row` |
| `Bullet Chart` | `y` `x` `goal` `color` `column` `row` |
| `Bump Chart` | `x` `y` `color` `detail` `column` `row` |
| `Calendar Heatmap` | `x` `color` |
| `Candlestick Chart` | `x` `open` `high` `low` `close` `column` `row` |
| `Connected Scatter Plot` | `x` `y` `order` `color` `detail` `column` `row` |
| `Density Plot` | `x` `color` `column` `row` |
| `ECDF Plot` | `x` `color` `detail` `column` `row` |
| `Funnel Chart` | `y` `size` |
| `Gantt Chart` | `y` `x` `x2` `color` `detail` `column` `row` |
| `Gauge Chart` | `size` `column` |
| `Grouped Bar Chart` | `x` `y` `group` `color` `column` `row` |
| `Heatmap` | `x` `y` `color` `column` `row` |
| `Histogram` | `x` `color` `column` `row` |
| `Line Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Lollipop Chart` | `x` `y` `color` `column` `row` |
| `Network Graph` | `x` `y` `size` |
| `Parallel Coordinates` | `color` `detail` |
| `Pie Chart` | `size` `color` `column` `row` |
| `Pyramid Chart` | `x` `y` `color` |
| `Radar Chart` | `x` `y` `color` `column` `row` |
| `Range Area Chart` | `x` `y` `y2` `color` `column` `row` |
| `Ranged Dot Plot` | `x` `y` `color` |
| `Regression` | `x` `y` `size` `color` `column` `row` |
| `Rose Chart` | `x` `y` `color` `column` `row` |
| `Sankey Diagram` | `x` `y` `size` |
| `Scatter Plot` | `x` `y` `color` `size` `opacity` `column` `row` |
| `Slope Chart` | `x` `y` `color` `detail` `column` `row` |
| `Stacked Bar Chart` | `x` `y` `color` `column` `row` |
| `Streamgraph` | `x` `y` `color` `column` `row` |
| `Strip Plot` | `x` `y` `color` `size` `column` `row` |
| `Sunburst Chart` | `color` `size` `detail` `group` |
| `Tree` | `color` `detail` `size` |
| `Treemap` | `color` `size` `detail` |
| `Waterfall Chart` | `x` `y` `color` `column` `row` |

## `chartjs` — 22 个模板

| 图表模板 | 支持的通道 |
|---|---|
| `Area Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Bar Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Bubble Chart` | `x` `y` `size` `color` `opacity` `column` `row` |
| `Bump Chart` | `x` `y` `color` `detail` `column` `row` |
| `Combo Chart` | `x` `y` `column` `row` |
| `Connected Scatter Plot` | `x` `y` `order` `color` `detail` `column` `row` |
| `Doughnut Chart` | `size` `color` `column` `row` |
| `ECDF Plot` | `x` `color` `detail` `column` `row` |
| `Gantt Chart` | `y` `x` `x2` `color` `column` `row` |
| `Grouped Bar Chart` | `x` `y` `group` `color` `column` `row` |
| `Histogram` | `x` `color` `column` `row` |
| `Line Chart` | `x` `y` `color` `opacity` `column` `row` |
| `Lollipop Chart` | `x` `y` `color` `column` `row` |
| `Pie Chart` | `size` `color` `column` `row` |
| `Radar Chart` | `x` `y` `color` `column` `row` |
| `Range Area Chart` | `x` `y` `y2` `color` `column` `row` |
| `Rose Chart` | `x` `y` `color` `column` `row` |
| `Scatter Plot` | `x` `y` `color` `size` `opacity` `column` `row` |
| `Slope Chart` | `x` `y` `color` `detail` `column` `row` |
| `Stacked Bar Chart` | `x` `y` `color` `column` `row` |
| `Strip Plot` | `x` `y` `color` `size` `column` `row` |
| `Waterfall Chart` | `x` `y` `color` `column` `row` |

## 通道速查

| 通道 | 含义 |
|---|---|
| `x` | 横轴维度（分类或时间） |
| `y` | 纵轴度量 |
| `y2` | 第二个纵轴（区间图用） |
| `x2` | 横轴终点（甘特图用） |
| `color` | 颜色分组 / 系列 |
| `size` | 气泡或点的大小 |
| `opacity` | 透明度分组 |
| `column` | 按此字段分列（小多图） |
| `row` | 按此字段分行（小多图） |
| `group` | 并排分组 |
| `detail` | 线上打点（折线/凹凸图） |
| `strokeDash` | 线型分组（实线/虚线） |
| `label` | 文本标签 |
| `value` | 数值（指标卡） |
| `metric` | 指标名（指标卡） |
| `goal` | 目标值（子弹图） |
| `order` | 连接顺序（连接散点） |
| `open` | 开盘价（K 线） |
| `high` | 最高价（K 线） |
| `low` | 最低价（K 线） |
| `close` | 收盘价（K 线） |
| `series` | 系列 |
| `category` | 分类维度 |
| `angle` | 角度（极坐标） |
| `radius` | 半径（极坐标） |
| `theta` | 角度（Excel 饼图） |
| `longitude` | 经度（地图） |
| `latitude` | 纬度（地图） |
| `id` | 区域标识（分级统计图） |

## 语义类型（`semantic_types`）

| 取值 | 用于 | 影响 |
|---|---|---|
| `Category` | 离散分类字段 | 轴为分类轴，聚合为分组 |
| `Quantity` | 数值度量 | 轴为连续轴，可聚合（求和/均值） |
| `Temporal` | 时间字段 | 时间轴，按时间粒度过采样 |

不填也能渲染，但轴行为、聚合方式可能不符合预期。**建议总是填。**

## 主题（10 套）

| 主题 | 风格 |
|---|---|
| `nyt` | 《纽约时报》风，克制、衬线感 |
| `economist` | 《经济学人》风，红色强调、白底 |
| `swiss` | 瑞士国际主义，红黑、无衬线、网格清晰 |
| `nature` | 《自然》期刊风，学术配色 |
| `mckinsey` | 麦肯锡风，深蓝主色 |
| `datawrapper` | Datawrapper 默认风，通用稳妥 |
| `powerbi` | Power BI 深色 |
| `powerbi-light` | Power BI 浅色 |
| `pop` | 高饱和撞色，适合社媒传播 |
| `cartoon` | 卡通明快，适合科普/演示 |

三个后端主题**都生效**且配色一致（实测确认）。
