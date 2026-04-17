"""Batch-run the pipeline on all images in a folder and produce an HTML report."""
import os
import sys
import glob
import hashlib
import shutil
import subprocess
import html

INPUT_DIR = r"H:\dark_mobile\Test_Image"
OUTPUT_ROOT = r"H:\dark_mobile\batch_outputs"
CONFIG = r"H:\dark_mobile\config.json"
RUNNER = r"H:\dark_mobile\pipeline\runner.py"
HTML_OUT = os.path.join(OUTPUT_ROOT, "report.html")

IMAGES = sorted(glob.glob(os.path.join(INPUT_DIR, "*.jpg")) +
                glob.glob(os.path.join(INPUT_DIR, "*.jpeg")) +
                glob.glob(os.path.join(INPUT_DIR, "*.png")))


def safe_dirname(name):
    return hashlib.md5(name.encode()).hexdigest()[:10]


def run_pipeline(img_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    cmd = [
        sys.executable, RUNNER,
        "--image", img_path,
        "--config", CONFIG,
        "--output_dir", out_dir,
        "--detect_only",
    ]
    print(f"  Running: {os.path.basename(img_path)} ...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  FAILED: {result.stderr[-300:]}")
    else:
        print(f"  OK")
    return result.returncode == 0


def img_tag(path, base):
    if os.path.exists(path):
        rel = os.path.relpath(path, base).replace("\\", "/")
        return f'<img src="{rel}" />'
    return '<span class="na">not generated</span>'


def build_html(results, base):
    rows = ""
    for i, r in enumerate(results, 1):
        name = html.escape(r["name"])
        rows += f"""
        <tr>
            <td class="idx">{i}</td>
            <td class="name">{name}<br>{img_tag(r['original'], base)}</td>
            <td>{img_tag(r['units'], base)}</td>
            <td>{img_tag(r['devices'], base)}</td>
            <td>{img_tag(r['rack_ports'], base)}</td>
        </tr>"""

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Batch Pipeline Report</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ background: #0a0e1a; color: #c8d6f0; font-family: 'Segoe UI', system-ui, sans-serif; padding: 24px; }}
  h1 {{ text-align: center; margin-bottom: 24px; font-size: 1.5rem;
       background: linear-gradient(135deg, #22d3ee, #60a5fa, #a78bfa);
       -webkit-background-clip: text; -webkit-text-fill-color: transparent; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th {{ background: rgba(34,211,238,0.1); color: #22d3ee; padding: 12px 8px;
       font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       border-bottom: 2px solid rgba(34,211,238,0.25); text-align: center; }}
  td {{ padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06);
       vertical-align: top; text-align: center; }}
  tr:hover {{ background: rgba(59,130,246,0.06); }}
  img {{ max-width: 280px; max-height: 360px; border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.1); display: block; margin: 6px auto; }}
  .idx {{ font-family: monospace; font-weight: 800; color: #60a5fa; width: 36px; }}
  .name {{ font-family: monospace; font-size: .78rem; color: #a78bfa; max-width: 200px; word-break: break-all; }}
  .na {{ color: rgba(244,63,94,0.6); font-size: .72rem; }}
  .summary {{ text-align: center; margin-bottom: 16px; font-size: .82rem; color: rgba(255,255,255,0.4); }}
</style>
</head>
<body>
<h1>Pipeline Batch Report</h1>
<p class="summary">{len(results)} images processed from {html.escape(INPUT_DIR)}</p>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Original</th>
      <th>Units</th>
      <th>Devices</th>
      <th>Full Rack + Ports</th>
    </tr>
  </thead>
  <tbody>{rows}
  </tbody>
</table>
</body>
</html>"""
    return page


def main():
    os.makedirs(OUTPUT_ROOT, exist_ok=True)
    results = []

    for img_path in IMAGES:
        name = os.path.basename(img_path)
        out_dir = os.path.join(OUTPUT_ROOT, safe_dirname(name))
        ok = run_pipeline(img_path, out_dir)
        # Copy original image into output folder so report is self-contained
        original_copy = os.path.join(out_dir, "0_original" + os.path.splitext(name)[1])
        if not os.path.exists(original_copy):
            shutil.copy2(img_path, original_copy)
        results.append({
            "name": name,
            "ok": ok,
            "original": original_copy,
            "units": os.path.join(out_dir, "1_units_only.png"),
            "devices": os.path.join(out_dir, "2_devices_only.png"),
            "rack_ports": os.path.join(out_dir, "7_rack_all_ports.png"),
        })

    with open(HTML_OUT, "w", encoding="utf-8") as f:
        f.write(build_html(results, OUTPUT_ROOT))

    print(f"\nReport: {HTML_OUT}")


if __name__ == "__main__":
    main()
