/**
 * Math font fixtures (Node): styles/math.css font wiring, licence files, fetch script, no proprietary fonts,
 * offline promise, and the \mathcal / variable rendering of src/ui/math-renderer.js.
 * Run: node tests/math_font_fixtures.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const css = read('styles', 'math.css');
const unq = (s) => s.trim().replace(/^["']|["']$/g, '');
const firstFamily = (decl) => unq(decl.split(',')[0]);

// ---- @font-face blocks -------------------------------------------------------------------------
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1];
  const get = (prop) => { const r = body.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`)); return r ? r[1].trim() : ''; };
  return { body, family: unq(get('font-family')), style: get('font-style'), display: get('font-display'), src: get('src') };
});
check('math.css declares at least one @font-face', faces.length >= 1);
const families = new Set(faces.map((f) => f.family));
const rootVars = css.match(/:root\s*\{([^}]*)\}/);
const varDecl = (name) => { const m = (rootVars ? rootVars[1] : '').match(new RegExp(`${name}\\s*:\\s*([^;]+);`)); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
const fontMath = varDecl('--font-math');
check('--font-math is defined', fontMath.length > 0);
check('--font-math first family is declared by an @font-face', families.has(firstFamily(fontMath)), `first=${firstFamily(fontMath)} faces=${[...families]}`);
check('--font-math ends with generic serif', /,\s*serif$/.test(fontMath), fontMath);

const dirs = new Set();
const woffNames = new Set();
faces.forEach((f, i) => {
  const tag = `@font-face #${i} (${f.family})`;
  check(`${tag} has font-display: swap`, f.display === 'swap', f.display);
  check(`${tag} has a local() source`, /local\(/.test(f.src));
  const url = f.src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
  check(`${tag} has a url()`, !!url);
  if (url) {
    check(`${tag} url is under ../vendor/fonts/ and ends .woff2`, /^\.\.\/vendor\/fonts\/.+\.woff2$/.test(url[1]), url[1]);
    dirs.add(path.posix.dirname(url[1]).replace(/^\.\.\//, ''));
    woffNames.add(path.posix.basename(url[1]));
  }
});

// ---- .math-var / .math-cal ---------------------------------------------------------------------
const rule = (sel) => { const m = css.match(new RegExp(`(?:^|[\\s}])${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm')); return m ? m[1] : ''; };
const mv = rule('.math-var');
check('.math-var is italic', /font-style\s*:\s*italic/.test(mv), mv);
const mvStackName = (mv.match(/font-family\s*:\s*var\((--[\w-]+)\)/) || [])[1];
const mvStack = mvStackName ? varDecl(mvStackName) : ((mv.match(/font-family\s*:\s*([^;]+)/) || [])[1] || '');
check('.math-var uses a stack whose first family has a real italic @font-face',
  faces.some((f) => f.family === firstFamily(mvStack) && /italic/.test(f.style)), `stack=${mvStack}`);
const mc = rule('.math-cal');
check('.math-cal rule exists', mc.length > 0);
check('.math-cal has no cursive/Script/Brush', !/cursive|script|brush/i.test(mc), mc);

// ---- offline + no proprietary fonts --------------------------------------------------------------
const walk = (dir, exts) => {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
};
const styleFiles = walk('styles', ['.css']);
for (const f of styleFiles) {
  check(`${f}: no remote url()`, !/url\(\s*["']?\s*(?:https?:)?\/\//i.test(read(f)));
}
const banned = /Styrene|Tiempos|Copernicus/i;
for (const f of [...styleFiles, 'index.html', ...walk('src/ui', ['.js', '.css', '.html'])]) {
  check(`${f}: no proprietary font names`, !banned.test(read(f)), (read(f).match(banned) || [])[0]);
}

// ---- licences ----------------------------------------------------------------------------------
check('at least one font directory referenced', dirs.size >= 1);
for (const d of dirs) {
  const names = exists(d) ? fs.readdirSync(path.join(ROOT, d)).filter((n) => /^(OFL|LICEN[CS]E)/i.test(n)) : [];
  check(`${d}: licence file beside the fonts`, names.length > 0, `dir exists=${exists(d)}`);
  const txt = names.map((n) => read(d, n)).join('\n');
  check(`${d}: licence is SIL OFL 1.1`, /SIL OPEN FONT LICENSE/i.test(txt) && /Version 1\.1/i.test(txt));
}

// ---- fetch script and docs ---------------------------------------------------------------------
check('tools/fetch-math-font.py exists', exists('tools', 'fetch-math-font.py'));
if (exists('tools', 'fetch-math-font.py')) {
  const py = read('tools', 'fetch-math-font.py');
  check('fetch script has no http:// URL', !/http:\/\//i.test(py));
  check('fetch script uses https://', /https:\/\//.test(py));
  check('fetch script pins a 40-hex commit', /\b[0-9a-f]{40}\b/.test(py));
  for (const n of woffNames) check(`fetch script lists ${n}`, py.includes(n));
}
check('docs/MATH-FONT.md exists with an https URL', exists('docs', 'MATH-FONT.md') && /https:\/\/\S+/.test(read('docs', 'MATH-FONT.md')));

// ---- renderer ----------------------------------------------------------------------------------
const mr = require(path.join(ROOT, 'src', 'ui', 'math-renderer.js'));
const calSpan = (html) => (html.match(/<span class="math-cal">([\s\S]*?)<\/span>/) || [])[1] || '';
const L = calSpan(mr.renderMath('\\mathcal{L}', false));
check('\\mathcal{L} -> math-cal span with U+2112', L.includes('ℒ'), L);
check('\\mathcal{L} leaves no raw ASCII letter in span', !/[A-Za-z]/.test(L.replace(/<[^>]*>/g, '')), L);
check('\\mathcal{A} contains U+1D49C', calSpan(mr.renderMath('\\mathcal{A}', false)).includes('\u{1D49C}'));
check('\\mathcal{F} contains U+2131', calSpan(mr.renderMath('\\mathcal{F}', false)).includes('ℱ'));
check('variable renders as math-var italic', /<i class="math-var">x<\/i>/.test(mr.renderMath('x', false)), mr.renderMath('x', false));
check('\\mathbf{v} -> math-bold', /class="math-bold"/.test(mr.renderMath('\\mathbf{v}', false)));
check('\\alpha renders the Greek letter', mr.renderMath('\\alpha', false).includes('α'));
const lt = mr.renderMath('a < b', false);
check('< is escaped', !/<\s*b\b/.test(lt) && lt.includes('&lt;'), lt);
const samples = ['\\mathcal{L}', '\\mathcal{A}\\mathcal{Z}', '\\mathcal{F}(x)=\\int f', '\\mathcal{LA}', '\\mathcal{\\alpha}', '\\frac{\\mathcal{B}}{\\mathcal{E}}', '\\mathcal{}', '\\mathcal'];
for (const s of samples) {
  let ok = true;
  try { encodeURIComponent(mr.renderMath(s, false)); encodeURIComponent(mr.renderMath(s, true)); } catch (_e) { ok = false; }
  check(`no unpaired surrogate for ${s}`, ok);
}

console.log(`math_font_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
