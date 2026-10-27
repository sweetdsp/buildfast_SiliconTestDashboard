#!/usr/bin/env python3
"""Inline CSS, JS and data/test_run_data.json into one self-contained dashboard/index.html."""
import json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "dashboard", "src")


def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as fh:
        return fh.read()


def safe_js(s, name):
    assert "</script" not in s.lower(), f"{name} contains </script"
    return s


def main():
    html = read(SRC, "template.html")
    data = json.dumps(json.load(open(os.path.join(ROOT, "data", "test_run_data.json"))), separators=(",", ":"))
    data = data.replace("<", "\\u003c")  # keeps the JSON block inert inside <script>
    for key, val in (("/*__CSS__*/", read(SRC, "styles.css")),
                     ("/*__ENGINE__*/", safe_js(read(SRC, "engine.js"), "engine.js")),
                     ("/*__CHARTS__*/", safe_js(read(SRC, "charts.js"), "charts.js")),
                     ("/*__LLM__*/", safe_js(read(SRC, "llm.js"), "llm.js")),
                     ("/*__RENDER__*/", safe_js(read(SRC, "render.js"), "render.js")),
                     ("/*__DATA__*/", data)):
        assert key in html, key
        html = html.replace(key, val)
    out = os.path.join(ROOT, "dashboard", "index.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote {out} ({len(html) // 1024} KB, self-contained)")


if __name__ == "__main__":
    main()
