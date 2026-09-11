#!/usr/bin/env python3
"""把 Flint 产物 URL 下载成本地文件（兜底用）。

正常情况下图片链接直接贴进回复正文就能显示，不需要这个脚本。
只有当用户看不到图、或用户明确要一份本地文件时，才用它。

用法:
    python3 scripts/fetch_chart.py <产物URL> [输出路径]

示例:
    python3 scripts/fetch_chart.py \
        http://localhost:3000/api/flint/artifacts/20260910-abc123-def456 \
        chart.png

输出路径省略时，会按内容类型自动命名到当前目录。
下载完成后用 send_file_to_user 把文件发给用户。
"""

import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# 本机存在系统级代理(127.0.0.1:7890)且不排除 localhost，
# urllib 默认会读取系统代理设置，导致取 localhost 产物时偶发 502。
# 这里强制直连。
urllib.request.install_opener(
    urllib.request.build_opener(urllib.request.ProxyHandler({}))
)

EXT_BY_MIME = {
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/jpeg": ".jpg",
    "application/pdf": ".pdf",
}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    url = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else ""

    try:
        resp = urllib.request.urlopen(url, timeout=60)
    except urllib.error.HTTPError as e:
        print(f"下载失败: HTTP {e.code} {e.reason}", file=sys.stderr)
        if e.code == 404:
            print("产物可能已过期（默认 7 天 TTL）或被清理。", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"下载失败: {e.reason}", file=sys.stderr)
        print("若提示连接问题，确认 Flint 服务在 3000 端口运行。", file=sys.stderr)
        return 1

    data = resp.read()
    mime = (resp.headers.get("Content-Type") or "").split(";")[0].strip()

    if not out:
        name = os.path.basename(urllib.parse.urlparse(url).path) or "flint-chart"
        ext = EXT_BY_MIME.get(mime, "")
        if ext and not name.lower().endswith(ext):
            name += ext
        out = name

    with open(out, "wb") as f:
        f.write(data)

    print(f"已保存: {out}")
    print(f"  大小: {len(data)} 字节")
    print(f"  类型: {mime or '未知'}")
    print()
    print("下一步: 用 send_file_to_user 把该文件发给用户。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
