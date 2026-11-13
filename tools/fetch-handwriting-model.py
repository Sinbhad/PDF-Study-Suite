#!/usr/bin/env python3
"""Fetch the on-device handwriting runtime and models into vendor/hw/ (git-ignored).

Standard library only, HTTPS only, every file pinned and verified, fail closed (a bad file is deleted).
  * @huggingface/transformers 3.8.1 and onnxruntime-web (npm tarballs, verified by sha512 BEFORE opening;
    only named members are read, never extractall); onnxruntime-web also supplies ort.wasm.min.mjs (sha256 checked)
  * Xenova/trocr-small-handwritten at a pinned commit (two ONNX files by sha256, small files by git blob SHA-1):
    the full-precision encoder (about 87 MB, more accurate than the 8-bit one) and the 8-bit decoder (about 41 MB)
  * PP-OCRv5 mobile detection + English recognition (ONNX, about 13 MB, by sha256) and its character list
    (tools/ppocr-v5-vocab.json, copied after a sha256 check)
All pins live in tools/hw_model_pins.py. See docs/HANDWRITING.md sections 5 and 6.

Usage:  python tools/fetch-handwriting-model.py [--dry-run] [--all]
"""
import argparse
import base64
import hashlib
import os
import posixpath
import shutil
import sys
import tarfile
import urllib.parse
import urllib.request

from hw_model_pins import HF, MAX_MEMBER_MB, MODEL_FILES, MODEL_SUBDIR, PPOCR_FILES, PPOCR_VOCAB, TARBALLS

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.normpath(os.path.join(HERE, "..", "vendor", "hw"))
CHUNK = 1024 * 1024
ALLOWED_HOSTS = ("registry.npmjs.org", "huggingface.co")
ALLOWED_SUFFIXES = (".huggingface.co", ".hf.co")
ORT_LOADER = "ort.wasm.min.mjs"
WASM = "ort-wasm-simd-threaded.jsep.wasm"


def host_ok(url):
    p = urllib.parse.urlparse(url)
    h = (p.hostname or "").lower()
    return p.scheme == "https" and (h in ALLOWED_HOSTS or h.endswith(ALLOWED_SUFFIXES))


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urljoin(req.full_url, newurl)
        if not host_ok(target):
            raise ValueError("refusing redirect to " + target)
        return super().redirect_request(req, fp, code, msg, headers, target)


OPENER = urllib.request.build_opener(SafeRedirect)


def download(url, part, limit, hashers):
    """Stream url to the .part file, feeding every hasher; refuses to exceed limit. Returns byte count."""
    if not host_ok(url):
        raise ValueError("refusing url (HTTPS + allow-listed host only): " + url)
    req = urllib.request.Request(url, headers={"User-Agent": "pdf-study-suite-hw-fetch"})
    total = 0
    with OPENER.open(req, timeout=60) as resp, open(part, "wb") as fh:
        while True:
            buf = resp.read(CHUNK)
            if not buf:
                break
            total += len(buf)
            if total > limit:
                raise ValueError("download larger than %d bytes" % limit)
            for h in hashers:
                h.update(buf)
            fh.write(buf)
    return total


def safe_remove(path):
    if os.path.exists(path):
        os.remove(path)


def fetch_file(url, rel, size, kind, checksum):
    """Download one pinned file to vendor/hw/<rel>; kind "sha256" or "blob" (git blob SHA-1)."""
    target = os.path.join(DEST, *rel.split("/"))
    part = target + ".part"
    os.makedirs(os.path.dirname(target), exist_ok=True)
    try:
        hashers = [hashlib.sha256() if kind == "sha256" else hashlib.sha1()]
        if kind == "blob":
            hashers[0].update(b"blob %d\0" % size)  # git blob header; size is pinned and checked below
        n = download(url, part, size + 1, hashers)
        if n != size:
            raise ValueError("size %d != expected %d" % (n, size))
        if hashers[0].hexdigest() != checksum:
            raise ValueError("%s mismatch (got %s)" % (kind, hashers[0].hexdigest()))
        os.replace(part, target)
        print("  ok  %s (%d bytes)" % (rel, n))
        return True
    except Exception as exc:
        print("  FAILED %s: %s" % (rel, exc))
        safe_remove(part)
        return False


def install_vocab():
    """Copy the tracked PP-OCR character list into vendor/hw/ after checking its sha256."""
    name, rel, sha = PPOCR_VOCAB
    with open(os.path.join(HERE, name), "rb") as fh:
        data = fh.read()
    if hashlib.sha256(data).hexdigest() != sha:
        print("  FAILED %s: sha256 mismatch, not installed" % name)
        return False
    target = os.path.join(DEST, *rel.split("/"))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as fh:
        fh.write(data)
    print("  ok  %s -> %s" % (name, rel))
    return True


def safe_member_name(name):
    return (not name.startswith("/") and "\\" not in name and ".." not in name.split("/")
            and posixpath.normpath(name) == name)


def extract_member(tar, member, dest_name, sha256):
    if not safe_member_name(member):
        raise ValueError("unsafe member name " + member)
    info = tar.getmember(member)
    if not info.isfile() or info.size > MAX_MEMBER_MB * CHUNK:
        raise ValueError("member %s is not a regular file or is too large" % member)
    target = os.path.join(DEST, dest_name)
    part = target + ".part"
    src = tar.extractfile(info)
    try:
        sha = hashlib.sha256()
        with open(part, "wb") as fh:
            for buf in iter(lambda: src.read(CHUNK), b""):
                sha.update(buf)
                fh.write(buf)
        if sha256 and sha.hexdigest() != sha256:
            raise ValueError("sha256 mismatch for %s (got %s)" % (member, sha.hexdigest()))
        os.replace(part, target)
    finally:
        safe_remove(part)
    print("  ok  %s -> %s (%d bytes)" % (member, dest_name, info.size))


def fetch_tarball(name, url, integrity, limit_mb, members, want):
    """Download, verify and read the named members for which want(dest name) is true. Returns (ok, found wasm)."""
    part = os.path.join(DEST, os.path.basename(url) + ".part")
    ok = True
    found_wasm = False
    try:
        sha = hashlib.sha512()
        n = download(url, part, limit_mb * CHUNK, [sha])
        got = "sha512-" + base64.b64encode(sha.digest()).decode("ascii")
        if got != integrity:
            raise ValueError("integrity mismatch (got %s)" % got)  # checked BEFORE the tarball is opened
        print("  ok  %s verified (%d bytes)" % (name, n))
        with tarfile.open(part, "r:gz") as tar:
            names = set(tar.getnames())
            for member, dest_name, required, sha256 in members:
                if not want(dest_name):
                    continue
                if member not in names:
                    if required:
                        print("  FAILED missing member %s; dist/ names: %s" % (
                            member, ", ".join(sorted(x for x in names if x.startswith("package/dist/")))))
                        ok = False
                    continue
                extract_member(tar, member, dest_name, sha256)
                found_wasm = found_wasm or dest_name == WASM
    except Exception as exc:
        print("  FAILED %s: %s" % (name, exc))
        ok = False
    finally:
        safe_remove(part)
    return ok, found_wasm


def model_total():
    total = sum(f[1] for f in MODEL_FILES) + sum(f[2] for f in PPOCR_FILES)
    return "%d model files, %d bytes (about %.0f MB)" % (len(MODEL_FILES) + len(PPOCR_FILES), total, total / 1e6)


def dry_run():
    for name, url, integrity, _limit, members in TARBALLS:
        print("%s\n  %s\n  %s" % (name, url, integrity))
        for member, dest_name, required, sha256 in members:
            print("    %s -> vendor/hw/%s%s%s" % (member, dest_name, "" if required else " (if present)",
                                                 " (sha256 %s)" % sha256 if sha256 else ""))
    print("onnxruntime-web is skipped when the .wasm and %s are already there (unless --all)" % ORT_LOADER)
    for path, size, kind, checksum in MODEL_FILES:
        print("%s%s\n  -> vendor/hw/%s/%s (%d bytes, %s %s)" % (HF, path, MODEL_SUBDIR, path, size, kind, checksum))
    for url, rel, size, sha in PPOCR_FILES:
        print("%s\n  -> vendor/hw/%s (%d bytes, sha256 %s)" % (url, rel, size, sha))
    print("tools/%s\n  -> vendor/hw/%s (copied, sha256 %s)" % PPOCR_VOCAB)
    print(model_total())
    print("dry run: nothing downloaded")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print what would be fetched, download nothing")
    ap.add_argument("--all", action="store_true", help="also download onnxruntime-web when its files are present")
    args = ap.parse_args(argv)
    if args.dry_run:
        return dry_run()
    os.makedirs(DEST, exist_ok=True)
    failed = False
    have = lambda f: os.path.exists(os.path.join(DEST, f))  # noqa: E731
    have_wasm = have(WASM)
    for idx, (name, url, integrity, limit, members) in enumerate(TARBALLS):
        if idx == 1 and have_wasm and have(ORT_LOADER) and not args.all:
            print("%s skipped: .wasm and %s already found" % (name, ORT_LOADER))
            continue
        print("%s" % name)
        # the .wasm comes from the first tarball when it has one; the second then only supplies the loader
        want_wasm = idx == 0 or not have_wasm
        ok, found = fetch_tarball(name, url, integrity, limit, members, lambda d: d != WASM or want_wasm)
        failed = failed or not ok
        have_wasm = have_wasm or found
    print("Model files: " + model_total())
    for path, size, kind, checksum in MODEL_FILES:
        failed = (not fetch_file(HF + path, MODEL_SUBDIR + "/" + path, size, kind, checksum)) or failed
    for url, rel, size, sha in PPOCR_FILES:
        failed = (not fetch_file(url, rel, size, "sha256", sha)) or failed
    failed = (not install_vocab()) or failed
    print("")
    print("FAILED: nothing unverified was left in place." if failed else "All files fetched and verified.")
    print("NOTE: the TrOCR weights licence must be confirmed by the owner before any redistribution "
          "(docs/HANDWRITING.md R1; see models/trocr-small-handwritten/README.md). PP-OCRv5 is Apache-2.0. "
          "vendor/hw/ is git-ignored: do not commit it.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
