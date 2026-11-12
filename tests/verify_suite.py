"""
Automated Verification Suite for the Offline Non-AI PDF Study Suite.
Verifies:
1. Strict 250-LOC Ceiling across all files in the repository.
2. Sample PDF generation (Class Slides & Textbook with Chapters/Sections).
3. HTML stylesheet & script graph integrity and module export completeness.
4. All 8 Node fixture suites (quality, option, layout, flashcard, math, structure, stem, ui_render).
5. Local HTTP server delivery of all assets, vendor libraries, and /local-larson.pdf.
"""
import http.server
import os
import re
import subprocess
import sys
import threading
import urllib.request

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(TESTS_DIR)
for _p in (ROOT_DIR, TESTS_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app import StudySuiteHandler, StudySuiteServer, LARSON_PATH
from generate_sample_pdfs import generate_samples
from verify_manifest import (
    EXPECTED_NAMESPACES,
    EXPECTED_SCRIPT_COUNT,
    HTTP_ENDPOINTS,
    NODE_FIXTURES,
    STYLESHEET_PATHS,
    find_node as _find_node,
)

MAX_LOC = 250
for _stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252; fixtures print math symbols
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def test_loc_ceiling() -> None:
    print("[1/5] Checking strict 250-LOC ceiling across all workspace files...")
    checked = 0
    for dirpath, _, filenames in os.walk(ROOT_DIR):
        for fname in sorted(filenames):
            if fname.endswith((".py", ".js", ".html", ".css", ".bat")):
                fpath = os.path.join(dirpath, fname)
                rel = os.path.relpath(fpath, ROOT_DIR)
                with open(fpath, "rb") as f:
                    line_count = sum(1 for _ in f)
                assert line_count <= MAX_LOC, f"LOC violation: {rel} has {line_count} lines (> {MAX_LOC})"
                print(f"   [OK] {rel:42s} : {line_count:3d} LOC")
                checked += 1
    assert checked >= 18, "Expected at least 18 project files"


def test_sample_pdfs() -> None:
    print("[2/5] Generating and verifying sample Class Slides & Textbook PDFs...")
    generate_samples(ROOT_DIR)
    for name in ("sample_class_slides.pdf", "sample_textbook_chapters.pdf"):
        p = os.path.join(ROOT_DIR, "samples", name)
        assert os.path.exists(p), f"Missing generated PDF: {p}"
        with open(p, "rb") as f:
            data = f.read()
        assert data.startswith(b"%PDF-1.4") and b"%%EOF" in data
        print(f"   [OK] samples/{name} ({len(data)} bytes)")


def test_script_integrity() -> None:
    print("[3/5] Verifying index.html stylesheet/script links and module exports...")
    index_path = os.path.join(ROOT_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    stylesheets = [s.split("?")[0] for s in re.findall(r'<link\s+rel="stylesheet"\s+href="([^"]+)"', html)]
    assert tuple(f"/{s}" for s in stylesheets) == STYLESHEET_PATHS, f"Unexpected stylesheets: {stylesheets}"

    scripts = [s.split("?")[0] for s in re.findall(r'<script\s+src="([^"]+)"', html)]
    assert len(scripts) == EXPECTED_SCRIPT_COUNT, (
        f"Expected {EXPECTED_SCRIPT_COUNT} script tags in index.html, found {len(scripts)}"
    )
    assert set(EXPECTED_NAMESPACES).issubset(set(scripts)), "Missing expected module scripts in index.html"

    for scr in scripts:
        full_path = os.path.join(ROOT_DIR, scr.replace("/", os.sep))
        assert os.path.exists(full_path), f"Referenced script missing: {scr}"
        if scr in EXPECTED_NAMESPACES:
            with open(full_path, "r", encoding="utf-8") as sf:
                code = sf.read()
            ns = EXPECTED_NAMESPACES[scr]
            assert ns in code, f"Missing namespace export {ns} in {scr}"


def test_quality_fixtures() -> None:
    print(f"[4/5] Running all {len(NODE_FIXTURES)} Node fixture suites...")
    node = _find_node()
    assert node and os.path.exists(node), "Node.js binary not found (Step 4 must never skip)"
    for name in NODE_FIXTURES:
        script = os.path.join(ROOT_DIR, "tests", name)
        proc = subprocess.run([node, script], capture_output=True, text=True, encoding="utf-8", timeout=60)
        for line in proc.stdout.strip().splitlines():
            print(f"   {line}")
        assert proc.returncode == 0, f"{name} failed:\n{proc.stdout}\n{proc.stderr}"


def test_http_server() -> None:
    print("[5/5] Verifying local HTTP server asset delivery & Larson Calculus endpoint...")
    server = StudySuiteServer(("127.0.0.1", 0), StudySuiteHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        for path in HTTP_ENDPOINTS:
            url = f"http://127.0.0.1:{port}{path}"
            with urllib.request.urlopen(url, timeout=5) as resp:
                assert resp.status == 200
                body = resp.read()
                assert len(body) > 50, f"Unexpectedly small body for {path}: {len(body)} bytes"

        if os.path.exists(LARSON_PATH):
            url = f"http://127.0.0.1:{port}/local-larson.pdf"
            with urllib.request.urlopen(url, timeout=10) as resp:
                assert resp.status == 200
                head = resp.read(64)
                assert head.startswith(b"%PDF-1.7")
                print(f"   [OK] /local-larson.pdf served cleanly ({LARSON_PATH})")
        print(f"   [OK] All {len(HTTP_ENDPOINTS)} endpoints served HTTP 200 OK from 127.0.0.1:{port}")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    test_loc_ceiling()
    test_sample_pdfs()
    test_script_integrity()
    test_quality_fixtures()
    test_http_server()
    print("\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")
