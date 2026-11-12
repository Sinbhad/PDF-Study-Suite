"""
Zero-Dependency Local Launcher for the Offline Non-AI PDF Study Suite.
Serves the workspace on http://127.0.0.1:8765 with strict no-cache headers
and exposes /local-larson.pdf for instant loading.
"""
import http.server
import os
import socket
import threading
import webbrowser

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
# Optional shortcut: point LARSON_PDF at a local copy to get a one-click "Recent" link.
LARSON_PATH = os.environ.get("LARSON_PDF") or os.path.join(
    os.path.expanduser("~"), "Downloads", "Larson-Calculus-of-a-Single-Variable-10th-Edition-c2014-txtbk.pdf"
)
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


class StudySuiteHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/local-larson.pdf":
            if os.path.exists(LARSON_PATH):
                file_size = os.path.getsize(LARSON_PATH)
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Length", str(file_size))
                self.end_headers()
                try:
                    with open(LARSON_PATH, "rb") as f:
                        while chunk := f.read(262144):
                            self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            self.send_error(404, "Larson Calculus PDF not found on disk")
            return
        super().do_GET()


class StudySuiteServer(http.server.ThreadingHTTPServer):
    """The page requests ~75 small files at once; the default backlog of 5 refuses some of them."""

    request_queue_size = 128
    daemon_threads = True


def find_free_port(start_port: int = DEFAULT_PORT) -> int:
    for port in range(start_port, start_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex((HOST, port)) != 0:
                return port
    return start_port


def main() -> None:
    port = find_free_port(DEFAULT_PORT)
    url = f"http://{HOST}:{port}/index.html?v=20261026a"
    server = StudySuiteServer((HOST, port), StudySuiteHandler)

    print("=" * 64)
    print(" Offline Non-AI PDF Study Suite (Slides & Textbooks)")
    print(f" Running locally at: {url}")
    print(" Press Ctrl+C to stop.")
    print("=" * 64)

    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down local server.")
        server.server_close()


if __name__ == "__main__":
    main()
