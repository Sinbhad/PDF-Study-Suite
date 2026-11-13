#!/usr/bin/env python3
"""Fetch the self-hosted math font (STIX Two, SIL OFL 1.1) into vendor/fonts/stix-two/.

Standard library only, HTTPS only, official source (github.com/stipub/stixfonts) at a pinned commit.
Each file is verified against the git blob SHA-1 and size that GitHub's contents API publishes for the
pinned tag (blob sha = sha1(b"blob <len>\\0" + data)). On any mismatch the partial file is deleted and the
script exits non-zero. A file with no published checksum is refused unless --trust-on-first-use is given,
which prints its SHA-256 so the owner can pin it here.

Usage:  python tools/fetch-math-font.py [--dry-run] [--trust-on-first-use]
"""
import argparse
import hashlib
import os
import sys
import urllib.request

REPO = "stipub/stixfonts"
TAG = "v2.13"  # for the record; the fetch below is pinned to the commit
COMMIT = "37308d44583ef882dc8b544aaa2e80ac8c406ebf"
RAW = "https://raw.githubusercontent.com/%s/%s/" % (REPO, COMMIT)
DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vendor", "fonts", "stix-two")

# (path in repo, destination file name, expected size, git blob sha1 or None)
FILES = [
    ("fonts/static_otf_woff2/STIXTwoMath-Regular.woff2", "STIXTwoMath-Regular.woff2", 552168,
     "6b3fe262779968faad8e19f81548dd236e18e4ae"),
    ("fonts/static_otf_woff2/STIXTwoText-Italic.woff2", "STIXTwoText-Italic.woff2", 147080,
     "4e7e9ed6844cb5c6166ee390d33d8cb4ffcdfb13"),
    ("fonts/static_otf_woff2/STIXTwoText-Bold.woff2", "STIXTwoText-Bold.woff2", 145516,
     "c2899511f51f3e71234371b0e1a06175e77cac0f"),
    ("OFL.txt", "OFL.txt", 4882, "96aa460dcb14080b868f0d389867ddfbd54e785f"),
]
MAX_BYTES = 2 * 1024 * 1024


def blob_sha1(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def download(url):
    if not url.startswith("https://"):
        raise ValueError("refusing non-HTTPS url: " + url)
    req = urllib.request.Request(url, headers={"User-Agent": "pdf-study-suite-font-fetch"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("download larger than %d bytes" % MAX_BYTES)
    return data


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print what would be fetched, download nothing")
    ap.add_argument("--trust-on-first-use", action="store_true",
                    help="allow files that have no published checksum; prints their SHA-256 to pin")
    args = ap.parse_args(argv)
    os.makedirs(DEST, exist_ok=True)
    failed = False
    for path, name, size, sha1 in FILES:
        url = RAW + path
        target = os.path.join(DEST, name)
        print("%s -> %s  (%s, %s)" % (url, os.path.normpath(target),
                                      "%d bytes" % size if size else "size unpinned",
                                      "git blob sha1 " + sha1 if sha1 else "NO CHECKSUM"))
        if args.dry_run:
            continue
        if sha1 is None and not args.trust_on_first_use:
            print("  REFUSED: no checksum published for this file (re-run with --trust-on-first-use to pin it)")
            failed = True
            continue
        part = target + ".part"
        try:
            data = download(url)
            if size and len(data) != size:
                raise ValueError("size %d != expected %d" % (len(data), size))
            if sha1 and blob_sha1(data) != sha1:
                raise ValueError("git blob sha1 mismatch (got %s)" % blob_sha1(data))
            with open(part, "wb") as fh:
                fh.write(data)
            os.replace(part, target)
            print("  ok  sha256 %s" % hashlib.sha256(data).hexdigest())
        except Exception as exc:  # fail closed: nothing unverified is ever left in place
            print("  FAILED: %s" % exc)
            if os.path.exists(part):
                os.remove(part)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
