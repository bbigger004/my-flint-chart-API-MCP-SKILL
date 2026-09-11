#!/usr/bin/env python3
"""把 flint-chart 注册进 workspace 的 skill.json manifest。"""
import json
import os
import time
from datetime import datetime, timezone

WS = os.path.expanduser("~/.qwenpaw/workspaces/default")
MANIFEST = os.path.join(WS, "skill.json")

DESC = ("画图表、数据可视化、生成统计图的唯一入口。任何时候用户想要「画个图」「做个图表」"
        "「可视化一下」「出张图」，或需要柱状图/折线图/饼图/散点图/热力图/桑基图/KPI 卡片等，"
        "都必须用这个 skill。底层是 Flint 图表 MCP（flint__render_chart 等工具），"
        "支持 95 个图表模板、3 个可渲染后端（vegalite/echarts/chartjs）、10 套品牌主题。"
        "本 skill 的关键是让生成的图**直接显示在对话里**。"
        "Also trigger for 'plot this', 'make a chart', 'visualize this data', 'render a chart'.")

now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

with open(MANIFEST) as f:
    m = json.load(f)

existing = m["skills"].get("flint-chart", {})

entry = {
    "enabled": True,
    "channels": ["all"],
    "source": "customized",
    "installed_from": "",
    "config": {},
    "metadata": {
        "name": "flint-chart",
        "description": DESC,
        "version_text": "1.0",
        "commit_text": "",
        "emoji": "📊",
        "source": "customized",
        "protected": False,
        "requirements": {"require_bins": [], "require_envs": []},
        "updated_at": now_iso,
    },
    "requirements": {"require_bins": [], "require_envs": []},
    "updated_at": now_iso,
}

m["skills"]["flint-chart"] = entry
m["version"] = int(time.time() * 1000)

with open(MANIFEST, "w") as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write("\n")

print("已注册 flint-chart")
print(f"  manifest: {MANIFEST}")
print(f"  version : {m['version']}")
print(f"  已覆盖旧条目: {'是' if existing else '否(新建)'}")
print(f"  当前 skills: {list(m['skills'].keys())}")

# 校验能读回来
with open(MANIFEST) as f:
    chk = json.load(f)
assert chk["skills"]["flint-chart"]["enabled"] is True
print("  JSON 校验: 通过")
