"""Respaldo de la exposición. Ejecutar python local.py y abrir el enlace mostrado."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "py"))
from eqcalc.api import api


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            html = (ROOT / "index.html").read_text(encoding="utf-8-sig")
            html = re.sub(r'  <[^\n]+cdn\.jsdelivr\.net[^\n]+\n', "", html)
            html = re.sub(r'<script type="py"[^>]*></script>', '<script src="js/local-api.js"></script>', html)
            data = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != "/api":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 15000000:
            return self.send_error(413)
        try:
            args = json.loads(self.rfile.read(length))
            result = api(*args).encode()
        except (TypeError, ValueError):
            return self.send_error(400)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(result)


if __name__ == "__main__":
    os.chdir(ROOT)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    print(f"Cota UT: http://127.0.0.1:{port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

