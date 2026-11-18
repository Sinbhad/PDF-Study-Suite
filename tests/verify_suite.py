"""
Automated Verification Suite for the offline PDF Study Suite.
Verifies:
1. Files over the 250-line review trigger are listed (a prompt to check responsibilities, not a limit).
2. Sample PDF generation (Class Slides & Textbook with Chapters/Sections).
3. HTML stylesheet & script graph integrity and module export completeness.
4. All Node fixture suites listed in verify_manifest.NODE_FIXTURES (quality, layout, math, handwriting, ...).
5. Local HTTP server delivery of all assets, vendor libraries, and /local-larson.pdf.
6. When the page reader's files are installed (vendor/hw/, PP-OCR; the TrOCR handwriting model is not
   needed): a real reading run in a headless browser (tools/smoke-handwriting.js). Skipped with a message
   when the files, Pillow or a browser is missing.
"""
import http.server
import os
import re
import subprocess
import sys
import tempfile
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
    EXPECTED_SCRIPTS,
    HTTP_ENDPOINTS,
    NODE_FIXTURES,
    PPOCR_FILES,
    STYLESHEET_PATHS,
    find_node as _find_node,
)

REVIEW_LOC = 250
SKIP_DIRS = {"vendor", "node_modules", "__pycache__"}  # dot-directories are skipped as well
for _stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252; fixtures print math symbols
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def test_loc_ceiling() -> None:
    """Line counts are a review trigger, not a limit: a long file is listed for a look at its responsibilities.

    A file must never be shortened by joining statements or stripping comments to get under the number.
    """
    print(f"[1/6] Listing source files over the {REVIEW_LOC}-line review trigger...")
    checked = 0
    over = []
    for dirpath, dirnames, filenames in os.walk(ROOT_DIR):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fname in sorted(filenames):
            if fname.endswith((".py", ".js", ".html", ".css", ".bat")):
                fpath = os.path.join(dirpath, fname)
                rel = os.path.relpath(fpath, ROOT_DIR)
                with open(fpath, "rb") as f:
                    line_count = sum(1 for _ in f)
                if line_count > REVIEW_LOC:
                    over.append((rel, line_count))
                checked += 1
    for rel, line_count in over:
        print(f"   [REVIEW] {rel:42s} : {line_count:3d} lines - check it still has one responsibility")
    print(f"   [OK] {checked} files checked, {len(over)} over the review trigger")
    assert checked >= 18, "Expected at least 18 project files"


def test_sample_pdfs() -> None:
    print("[2/6] Generating and verifying sample Class Slides & Textbook PDFs...")
    generate_samples(ROOT_DIR)
    for name in ("sample_class_slides.pdf", "sample_textbook_chapters.pdf"):
        p = os.path.join(ROOT_DIR, "samples", name)
        assert os.path.exists(p), f"Missing generated PDF: {p}"
        with open(p, "rb") as f:
            data = f.read()
        assert data.startswith(b"%PDF-1.4") and b"%%EOF" in data
        print(f"   [OK] samples/{name} ({len(data)} bytes)")


def test_script_integrity() -> None:
    print("[3/6] Verifying index.html stylesheet/script links and module exports...")
    index_path = os.path.join(ROOT_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    stylesheets = [s.split("?")[0] for s in re.findall(r'<link\s+rel="stylesheet"\s+href="([^"]+)"', html)]
    assert tuple(f"/{s}" for s in stylesheets) == STYLESHEET_PATHS, f"Unexpected stylesheets: {stylesheets}"

    scripts = [s.split("?")[0] for s in re.findall(r'<script\s+src="([^"]+)"', html)]
    twice = sorted({s for s in scripts if scripts.count(s) > 1})
    assert not twice, f"Scripts loaded more than once in index.html: {twice}"
    missing = sorted(EXPECTED_SCRIPTS - set(scripts))
    assert not missing, f"Scripts in tests/verify_manifest.py that index.html does not load: {missing}"
    unlisted = sorted(set(scripts) - EXPECTED_SCRIPTS)
    assert not unlisted, f"Scripts index.html loads that tests/verify_manifest.py does not list: {unlisted}"
    assert len(scripts) == EXPECTED_SCRIPT_COUNT, (
        f"index.html loads {len(scripts)} scripts, tests/verify_manifest.py EXPECTED_SCRIPT_COUNT says {EXPECTED_SCRIPT_COUNT}")
    print(f"   [OK] index.html loads the {len(scripts)} scripts the manifest lists")

    for scr in scripts:
        full_path = os.path.join(ROOT_DIR, scr.replace("/", os.sep))
        assert os.path.exists(full_path), f"Referenced script missing: {scr}"
        if scr in EXPECTED_NAMESPACES:
            with open(full_path, "r", encoding="utf-8") as sf:
                code = sf.read()
            ns = EXPECTED_NAMESPACES[scr]
            assert ns in code, f"Missing namespace export {ns} in {scr}"


def test_quality_fixtures() -> None:
    print(f"[4/6] Running all {len(NODE_FIXTURES)} Node fixture suites...")
    node = _find_node()
    assert node and os.path.exists(node), "Node.js binary not found (Step 4 must never skip)"
    for name in NODE_FIXTURES:
        script = os.path.join(ROOT_DIR, "tests", name)
        proc = subprocess.run([node, script], capture_output=True, text=True, encoding="utf-8", timeout=60)
        for line in proc.stdout.strip().splitlines():
            print(f"   {line}")
        assert proc.returncode == 0, f"{name} failed:\n{proc.stdout}\n{proc.stderr}"


def test_http_server() -> None:
    print("[5/6] Verifying local HTTP server asset delivery & Larson Calculus endpoint...")
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


def test_handwriting_model() -> None:
    """Optional extra: runs only when the page reader, Pillow, a handwriting-style font and Edge/Chrome are present."""
    print("[6/6] Reading a synthetic handwritten page with the real page reader in a real browser...")
    hw = os.path.join(ROOT_DIR, "vendor", "hw")
    absent = [n for n in PPOCR_FILES if not os.path.exists(os.path.join(hw, *n.split("/")))]
    if absent:
        print(f"   [SKIPPED] the page reader is not installed (vendor/hw/{absent[0]} is missing; "
              "run python tools/fetch-handwriting-model.py --ppocr-only); step 4 covers type-it-in")
        return
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("   [SKIPPED] Pillow is not installed, so the synthetic page cannot be drawn")
        return
    node = _find_node()
    with tempfile.TemporaryDirectory() as tmp:
        pdf = os.path.join(tmp, "fixture.pdf")
        made = subprocess.run([sys.executable, os.path.join(ROOT_DIR, "tools", "make-handwriting-fixture.py"), pdf],
                              capture_output=True, text=True, encoding="utf-8", timeout=60)
        if made.returncode != 0:
            print(f"   [SKIPPED] could not draw the synthetic page: {made.stderr.strip() or made.stdout.strip()}")
            return
        proc = subprocess.run([node, os.path.join(ROOT_DIR, "tools", "smoke-handwriting.js"), pdf, "--timeout=300"],
                              capture_output=True, text=True, encoding="utf-8", timeout=480)
    if proc.returncode == 2:
        print(f"   [SKIPPED] {proc.stderr.strip()}")
        return
    tail = proc.stdout[proc.stdout.rfind("\n}") + 2:].strip().splitlines()
    for line in tail:
        print(f"   {line}")
    assert proc.returncode == 0, f"handwriting smoke test failed: {proc.stdout[-3000:]} {proc.stderr[-2000:]}"


if __name__ == "__main__":
    test_loc_ceiling()
    test_sample_pdfs()
    test_script_integrity()
    test_quality_fixtures()
    test_http_server()
    test_handwriting_model()
    print("\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")
