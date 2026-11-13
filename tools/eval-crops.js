/**
 * Debug previews for the handwriting evaluation: the rendered page with every region box numbered, each
 * gray crop exactly as handed to the recogniser, and contact sheets of crops with what came back.
 * The crops are made by the app's own modules (the worker's importScripts list, injected into the page).
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./eval-browser.js');

/** Script names the worker loads, in order, read from src/hw/hw-worker.js so the tool follows the worker. */
function workerScripts() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'hw', 'hw-worker.js'), 'utf8');
  const names = [];
  for (const m of src.matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) if (!names.includes(q[1])) names.push(q[1]);
  }
  return names;
}

/* Runs in the page (serialised with toString): builds every preview as PNG base64 in window.__evalCrops. */
async function cropsInPage(a) {
  const S = window.PDFStudy;
  for (const name of a.scripts) {
    const src = `src/hw/${name}`;
    if ([...document.scripts].some((s) => (s.getAttribute('src') || '').split('?')[0] === src)) continue;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(`could not load ${src}`));
      document.head.appendChild(s);
    });
  }
  const bytes = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
  const parsed = await S.pdfLoader.loadPdfDocument(bytes.buffer, () => {});
  const { gray, width, height } = await S.hwPipeline.renderPageGray(parsed.pdfDoc, 1, 1650); // same call as ensureRecognised
  const prep = S.hwPagePrep;
  const res = a.result || { lines: [] };
  let lines; let cropOf; let mode;
  if (prep && prep.plan && prep.cropFor) {
    const plan = prep.plan(gray, width, height);
    lines = plan.lines;
    cropOf = (box) => prep.cropFor(plan, gray, width, height, box);
    mode = 'hwPagePrep';
  } else {
    // same steps as hw-worker-core.js before hwPagePrep existed
    const bin = S.hwClean ? S.hwClean.prepare(gray, width, height, S.hwRaster) : S.hwRaster.binarise(gray, width, height);
    lines = res.lines;
    cropOf = (box) => {
      const raw = S.hwRaster.crop(gray, width, height, box, Math.max(4, Math.round(box.h * 0.1)));
      return S.hwClean && S.hwClean.normaliseCrop ? S.hwClean.normaliseCrop(raw, bin.inverted) : raw;
    };
    mode = 'fallback';
  }
  const toModel = S.hwEngineUtil && S.hwEngineUtil.prepareCrop;
  const out = [];
  const canvasOf = (img) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, img.w); c.height = Math.max(1, img.h);
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(c.width, c.height);
    for (let i = 0, d = id.data; i < img.w * img.h; i++) { const v = img.data[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    ctx.putImageData(id, 0, 0);
    return c;
  };
  const save = (name, c) => out.push({ name, b64: c.toDataURL('image/png').split(',')[1] });
  const pad2 = (n) => String(n).padStart(2, '0');
  const items = [];
  lines.forEach((l, li) => (l.regions || []).forEach((r, ri) => {
    const got = (res.lines[li] && res.lines[li].regions && res.lines[li].regions[ri]) || {};
    items.push({ n: items.length + 1, li, ri, box: r.box, text: got.text || '', conf: got.confidence, stats: got.stats || null });
  }));
  const page = canvasOf({ data: gray, w: width, h: height });
  const pctx = page.getContext('2d');
  pctx.lineWidth = 2; pctx.font = 'bold 18px sans-serif';
  for (const it of items) {
    const { x, y, w, h } = it.box;
    pctx.strokeStyle = it.conf >= 0.6 ? '#0a8f3c' : '#d22';
    pctx.strokeRect(x, y, w, h);
    const label = String(it.n);
    pctx.fillStyle = 'rgba(255,255,160,0.9)';
    const ly = y >= 20 ? y - 20 : y; // inside the box when it touches the top edge
    pctx.fillRect(Math.max(0, x - 2), ly, pctx.measureText(label).width + 6, 20);
    pctx.fillStyle = '#000';
    pctx.fillText(label, Math.max(2, x + 1), ly + 16);
  }
  save('page-boxes.png', page);
  const rows = [];
  for (const it of items) {
    const base = `${pad2(it.n)}-l${pad2(it.li)}-r${it.ri}`;
    const crop = canvasOf(cropOf(it.box));
    save(`${base}.png`, crop);
    let model = null;
    const input = toModel ? toModel(cropOf(it.box)) : null; // null for an unusable crop
    if (input) { model = canvasOf(input); save(`${base}-model.png`, model); }
    rows.push({ it, crop, model });
  }
  const W = 1400; const CAP = 24; const THUMB = rows.some((r) => r.model) ? 160 : 0; const GAP = 10;
  for (let s = 0; s * 12 < rows.length; s++) {
    const chunk = rows.slice(s * 12, s * 12 + 12).map((r) => {
      const avail = W - 2 * GAP - (THUMB ? THUMB + GAP : 0);
      const k = Math.min(1, avail / r.crop.width, 200 / r.crop.height);
      return Object.assign({ k, rowH: CAP + Math.max(Math.round(r.crop.height * k), THUMB) + GAP }, r);
    });
    const sheet = document.createElement('canvas');
    sheet.width = W; sheet.height = chunk.reduce((n, r) => n + r.rowH, 0) + GAP;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, sheet.height);
    let y = GAP;
    for (const r of chunk) {
      const conf = typeof r.it.conf === 'number' ? r.it.conf.toFixed(2) : '-';
      const st = r.it.stats && typeof r.it.stats.mean === 'number' ? ` (mean ${r.it.stats.mean.toFixed(2)}, min ${Number(r.it.stats.min).toFixed(2)})` : '';
      ctx.fillStyle = r.it.conf >= 0.6 ? '#dff3e4' : '#fbe0e0';
      ctx.fillRect(0, y, W, CAP);
      ctx.fillStyle = '#000'; ctx.font = '16px sans-serif';
      ctx.fillText(`#${r.it.n}  l${r.it.li} r${r.it.ri}  conf ${conf}${st}  "${r.it.text}"`, GAP, y + 17);
      y += CAP;
      ctx.drawImage(r.crop, GAP, y, Math.round(r.crop.width * r.k), Math.round(r.crop.height * r.k));
      if (r.model) { ctx.drawImage(r.model, W - GAP - THUMB, y, THUMB, THUMB); ctx.strokeStyle = '#888'; ctx.strokeRect(W - GAP - THUMB, y, THUMB, THUMB); }
      y += r.rowH - CAP;
    }
    save(`sheet-${pad2(s + 1)}.png`, sheet);
  }
  if (parsed.pdfDoc && parsed.pdfDoc.destroy) parsed.pdfDoc.destroy();
  window.__evalCrops = out;
  const sameLines = mode === 'fallback' || lines.length === res.lines.length;
  return JSON.stringify({ mode, count: out.length, regions: items.length, model: !!toModel, sameLines });
}

/** Build and write the previews for one page into <out>/crops/<file>/; returns a one-line note for the log. */
async function writeCrops(evalJs, outDir, file, pdfB64, result) {
  const arg = { scripts: workerScripts(), b64: pdfB64, result };
  const info = JSON.parse(await evalJs(`(${cropsInPage.toString()})(${JSON.stringify(arg)})`));
  const dir = path.join(outDir, 'crops', file);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < info.count; i++) {
    const item = await evalJs(`window.__evalCrops[${i}]`);
    fs.writeFileSync(path.join(dir, item.name), Buffer.from(item.b64, 'base64'));
  }
  await evalJs('window.__evalCrops = null, true');
  const mode = info.mode === 'fallback' ? 'crops: fallback path' : 'crops: hwPagePrep';
  return `${mode}, ${info.regions} regions${info.model ? ', model inputs saved' : ''}${info.sameLines ? '' : ', WARNING: plan lines differ from result lines'} -> ${dir}`;
}

module.exports = { workerScripts, writeCrops };
