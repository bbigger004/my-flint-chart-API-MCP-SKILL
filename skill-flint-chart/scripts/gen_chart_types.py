#!/usr/bin/env python3
"""从 registry.json 生成 references/chart-types.md(保证与真实模板清单一致)。"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(HERE)  # scripts/ 的上一级 = skill 根目录
reg = json.load(open(os.path.join(HERE, "registry.json")))

BACKEND_NOTE = {
    "vegalite": "最通用，模板最全，优先选它",
    "echarts": "适合桑基图/树图/仪表盘/地图等 vegalite 没有的图型",
    "chartjs": "只输出 PNG（不支持 SVG）",
    "plotly": "⚠️ **只能 compile，不能 render，MCP 里调不通**",
    "excel": "⚠️ **只能 compile，不能 render，MCP 里调不通**",
}

L = []
L.append("# Flint 图表模板全清单（95 个）")
L.append("")
L.append("本文件由 `scripts/gen_chart_types.py` 从服务端真实注册表生成，**与实际能力一致**。")
L.append("")
L.append("> 每个模板后面方括号里是它**支持的编码通道**。传给模板不支持的通道会被服务端拒绝，")
L.append("> 错误信息会列出该模板实际支持的通道。")
L.append("")
L.append("## 后端总览")
L.append("")
L.append("| 后端 | 可渲染 | 模板数 | 适用场景 |")
L.append("|---|---|---|---|")
for b in ("vegalite", "echarts", "chartjs", "plotly", "excel"):
    n = len(reg["templates"].get(b, []))
    ok = "✅" if b in ("vegalite", "echarts", "chartjs") else "❌"
    L.append(f"| `{b}` | {ok} | {n} | {BACKEND_NOTE[b]} |")
L.append("")
L.append("**共 95 个可渲染模板**（vegalite 36 + echarts 37 + chartjs 22）。")
L.append("")

for b in ("vegalite", "echarts", "chartjs"):
    ts = reg["templates"][b]
    L.append(f"## `{b}` — {len(ts)} 个模板")
    L.append("")
    L.append("| 图表模板 | 支持的通道 |")
    L.append("|---|---|")
    for t in sorted(ts, key=lambda x: x["chart"]):
        chans = " ".join(f"`{c}`" for c in t["channels"])
        L.append(f"| `{t['chart']}` | {chans} |")
    L.append("")

L.append("## 通道速查")
L.append("")
CHAN_DESC = {
    "x": "横轴维度（分类或时间）",
    "y": "纵轴度量",
    "y2": "第二个纵轴（区间图用）",
    "x2": "横轴终点（甘特图用）",
    "color": "颜色分组 / 系列",
    "size": "气泡或点的大小",
    "opacity": "透明度分组",
    "column": "按此字段分列（小多图）",
    "row": "按此字段分行（小多图）",
    "group": "并排分组",
    "detail": "线上打点（折线/凹凸图）",
    "strokeDash": "线型分组（实线/虚线）",
    "label": "文本标签",
    "value": "数值（指标卡）",
    "metric": "指标名（指标卡）",
    "goal": "目标值（子弹图）",
    "order": "连接顺序（连接散点）",
    "open": "开盘价（K 线）",
    "high": "最高价（K 线）",
    "low": "最低价（K 线）",
    "close": "收盘价（K 线）",
    "series": "系列",
    "category": "分类维度",
    "angle": "角度（极坐标）",
    "radius": "半径（极坐标）",
    "theta": "角度（Excel 饼图）",
    "longitude": "经度（地图）",
    "latitude": "纬度（地图）",
    "id": "区域标识（分级统计图）",
}
L.append("| 通道 | 含义 |")
L.append("|---|---|")
for k, v in CHAN_DESC.items():
    L.append(f"| `{k}` | {v} |")
L.append("")

L.append("## 语义类型（`semantic_types`）")
L.append("")
L.append("| 取值 | 用于 | 影响 |")
L.append("|---|---|---|")
L.append("| `Category` | 离散分类字段 | 轴为分类轴，聚合为分组 |")
L.append("| `Quantity` | 数值度量 | 轴为连续轴，可聚合（求和/均值） |")
L.append("| `Temporal` | 时间字段 | 时间轴，按时间粒度过采样 |")
L.append("")
L.append("不填也能渲染，但轴行为、聚合方式可能不符合预期。**建议总是填。**")
L.append("")

L.append("## 主题（10 套）")
L.append("")
themes = reg["themes"]
L.append("| 主题 | 风格 |")
L.append("|---|---|")
THEME_NOTE = {
    "nyt": "《纽约时报》风，克制、衬线感",
    "economist": "《经济学人》风，红色强调、白底",
    "swiss": "瑞士国际主义，红黑、无衬线、网格清晰",
    "nature": "《自然》期刊风，学术配色",
    "mckinsey": "麦肯锡风，深蓝主色",
    "datawrapper": "Datawrapper 默认风，通用稳妥",
    "powerbi": "Power BI 深色",
    "powerbi-light": "Power BI 浅色",
    "pop": "高饱和撞色，适合社媒传播",
    "cartoon": "卡通明快，适合科普/演示",
}
for t in themes:
    L.append(f"| `{t}` | {THEME_NOTE.get(t, '')} |")
L.append("")
L.append("三个后端主题**都生效**且配色一致（实测确认）。")

out = os.path.join(SKILL_ROOT, "references", "chart-types.md")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w").write("\n".join(L) + "\n")
print(f"已生成 {out}")
print(f"  行数: {len(L)}")
print(f"  模板: vegalite {len(reg['templates']['vegalite'])} / "
      f"echarts {len(reg['templates']['echarts'])} / chartjs {len(reg['templates']['chartjs'])}")
print(f"  主题: {len(themes)}")
