/**
 * Idempotent manifest synchronizer between index.html and tests/verify_manifest.py.
 *
 * Usage:
 *   node tools/sync-manifest.js --check             Exit 0 iff index.html and verify_manifest.py match (default)
 *   node tools/sync-manifest.js --write             Update EXPECTED_SCRIPT_COUNT & EXPECTED_NAMESPACES cleanly
 *   node tools/sync-manifest.js --write --bump-cache[=all]
 *                                                   Also update ?v=YYYYMMDDx cache-busters in index.html
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseIndexScripts, parseVerifyManifest, checkStaticConfig } = require('./check-contracts.js');

const ROOT = path.resolve(__dirname, '..');

function detectNamespace(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  // Match top-level assignment PDFStudy.fooBar = ... (last non-prototype match wins)
  const matches = [...code.matchAll(/\bPDFStudy\.([A-Za-z0-9_]+)\s*=/g)];
  if (!matches.length) return null;
  const picked = matches[matches.length - 1][1];
  return `PDFStudy.${picked}`;
}

function walkSrcJs() {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.sort();
}

/** Synchronizes verify_manifest.py in-place while preserving section comments and formatting when unchanged. */
function syncManifestText(manifestSrc, htmlScripts, nonModuleScripts, existingNamespaces, rootDir) {
  const nonMod = new Set(nonModuleScripts);
  const desiredScripts = htmlScripts.filter((s) => !nonMod.has(s));
  const desiredSet = new Set(desiredScripts);

  // Check if any changes are actually needed
  const existingKeys = [...existingNamespaces.keys()];
  const countMatches = (manifestSrc.match(/EXPECTED_SCRIPT_COUNT\s*=\s*(\d+)/) || [])[1] === String(htmlScripts.length);
  const keysMatch = existingKeys.length === desiredScripts.length && desiredScripts.every((s) => existingNamespaces.has(s));
  if (countMatches && keysMatch) return manifestSrc;

  let next = manifestSrc.replace(
    /EXPECTED_SCRIPT_COUNT\s*=\s*\d+/,
    `EXPECTED_SCRIPT_COUNT = ${htmlScripts.length}`
  );

  if (!keysMatch) {
    const nsBlockRe = /(EXPECTED_NAMESPACES\b[^=]*=\s*\{\r?\n)([\s\S]*?)(\r?\n\})/;
    const m = next.match(nsBlockRe);
    if (!m) throw new Error('Could not locate EXPECTED_NAMESPACES block in tests/verify_manifest.py');
    const eol = next.includes('\r\n') ? '\r\n' : '\n';
    const rawLines = m[2].split(/\r?\n/);

    const keptLines = [];
    const present = new Set();
    for (const line of rawLines) {
      const entryMatch = line.match(/^\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/);
      if (!entryMatch) {
        keptLines.push(line);
        continue;
      }
      const scr = entryMatch[1];
      if (desiredSet.has(scr)) {
        keptLines.push(line);
        present.add(scr);
      }
    }

    // Insert missing scripts right after their previous sibling in index.html
    for (let i = 0; i < desiredScripts.length; i++) {
      const scr = desiredScripts[i];
      if (present.has(scr)) continue;
      const ns = detectNamespace(path.join(rootDir, scr));
      if (!ns) throw new Error(`Cannot auto-detect PDFStudy.<ns> export in ${scr}`);
      const newLine = `    "${scr}": "${ns}",`;
      let insertAt = keptLines.length;
      if (i > 0) {
        const prev = desiredScripts[i - 1];
        const prevIdx = keptLines.findIndex((l) => l.includes(`"${prev}"`));
        if (prevIdx >= 0) insertAt = prevIdx + 1;
      }
      keptLines.splice(insertAt, 0, newLine);
      present.add(scr);
    }

    next = next.replace(nsBlockRe, `${m[1]}${keptLines.join(eol)}${m[3]}`);
  }
  return next;
}

function bumpCacheInHtml(htmlPath, bumpAll) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let touched = null;
  if (!bumpAll) {
    try {
      const out = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
      touched = new Set(out.splitlines ? out.splitlines() : out.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).trim().replace(/\\/g, '/')));
    } catch (_e) {
      touched = null;
    }
  }
  const tag = `${ymd}z`;
  html = html.replace(/(<(?:script|link)\b[^>]+(?:src|href)=")([^"?]+)(?:\?v=[^"]*)?(")/g, (all, pre, asset, post) => {
    if (!bumpAll && touched && !touched.has(asset)) return all;
    return `${pre}${asset}?v=${tag}${post}`;
  });
  fs.writeFileSync(htmlPath, html, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes('--write');
  const bumpArg = args.find((a) => a.startsWith('--bump-cache'));
  const htmlPath = path.join(ROOT, 'index.html');
  const manifestPath = path.join(ROOT, 'tests/verify_manifest.py');

  const htmlScripts = parseIndexScripts(htmlPath);
  const manifest = parseVerifyManifest(manifestPath);
  const srcFiles = walkSrcJs();

  if (!writeMode) {
    const errors = checkStaticConfig({ rootDir: ROOT, htmlScripts, manifest, srcFiles });
    if (errors.length) {
      for (const e of errors) console.error(`SYNC FAIL: ${e}`);
      process.exit(1);
    }
    console.log(`[OK] manifest in sync (${htmlScripts.length} scripts, ${manifest.namespaces.size} namespaces)`);
    process.exit(0);
  }

  const oldText = fs.readFileSync(manifestPath, 'utf8');
  const newText = syncManifestText(oldText, htmlScripts, manifest.nonModuleScripts, manifest.namespaces, ROOT);
  if (newText !== oldText) {
    fs.writeFileSync(manifestPath, newText, 'utf8');
    console.log('Updated tests/verify_manifest.py');
  } else {
    console.log('tests/verify_manifest.py already in sync (no changes)');
  }

  if (bumpArg) {
    bumpCacheInHtml(htmlPath, bumpArg === '--bump-cache=all');
    console.log('Updated cache-buster ?v= tags in index.html');
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { detectNamespace, syncManifestText };
