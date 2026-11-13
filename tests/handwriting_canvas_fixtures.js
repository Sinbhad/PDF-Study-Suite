/**
 * Canvas (mind-map) handwriting fixtures (Node): a recognised page with `layout: 'canvas'` keeps its topics
 * apart (clusters side by side at the same height never interleave), block titles become headings, unsure
 * lines stay out, region ids are kept, cards pair each term with its own definition, quiz and test ask
 * questions, and an ordinary (non-canvas) result gives exactly the page lines it gave before.
 * Run: node tests/handwriting_canvas_fixtures.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

globalThis.window = globalThis;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const listed = [...html.matchAll(/<script\s+src="([^"?]+)/g)].map((m) => m[1])
  .filter((s) => s.startsWith('src/pdf/') || s.startsWith('src/nlp/') || s === 'src/ui/study-pipeline.js');
for (const s of ['src/pdf/ocr-canvas.js', 'src/pdf/ocr-canvas-scope.js'].concat(listed)) require(path.join(ROOT, s));
const P = globalThis.PDFStudy;

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

// Three topics side by side (their boxes share heights), five blocks, one duplicate reading, one unsure line.
const TOPICS = [
  { x: 60, y: 80, blocks: [
    ['Cell organelles', 'Mitochondria - site of aerobic respiration', 'Ribosome: builds proteins from amino acids', 'Nucleus - holds the genetic material'],
    ['Membrane', 'Phospholipid bilayer -> barrier around the cell', 'Channel proteins = pores that let ions through'] ] },
  { x: 620, y: 90, blocks: [
    ['Photosynthesis', 'Chloroplast - organelle where light is captured', 'Light reactions: split water and release oxygen', 'Calvin cycle - fixes carbon dioxide into sugar'],
    ['Pigments', 'Chlorophyll: absorbs red and blue light', 'qzv xw', 'Carotenoids - absorb blue and green light'] ] },
  { x: 1140, y: 70, blocks: [
    ['Genetics', 'Allele - one version of a gene', 'Genotype: the alleles an organism carries', 'Phenotype - the traits that can be observed'] ] },
];
const UNSURE = 'qzv xw';

function canvasResult() {
  const lines = [];
  let group = 0;
  TOPICS.forEach((t, cluster) => {
    let y = t.y;
    for (const block of t.blocks) {
      block.forEach((text, i) => {
        const h = i === 0 ? 30 : 20;
        const box = { x: t.x + (i ? 16 : 0), y, w: Math.min(440, text.length * 9), h };
        const push = (conf) => lines.push({ index: lines.length, box, cluster, group,
          regions: [{ id: `p1-l${lines.length}-r0`, kind: 'text', box, text, confidence: conf, source: 'model' }] });
        push(text === UNSURE ? 0.3 : 0.92);
        if (/^Channel/.test(text)) push(0.71); // the same ink read twice
        y += h + 6;
      });
      y += 40;
      group++;
    }
  });
  return { pageNumber: 1, scale: 2, width: 1600, height: 1200, layout: 'canvas', clusters: TOPICS.length, groups: group, lines };
}

const PAIRS = TOPICS.flatMap((t) => t.blocks.flatMap((b) => b.slice(1).map((l) => P.ocrCanvas.pairOf(l)).filter(Boolean)));
const up = (s) => s[0].toUpperCase() + s.slice(1);

function pageLineTests(page, result, before) {
  const lines = page.lines;
  const clusters = lines.map((l) => l.ocr.cluster);
  check('page lines: topics never interleave (cluster order non-decreasing)', clusters.every((c, i) => !i || c >= clusters[i - 1]), clusters.join(','));
  check('page lines: unsure line held back', !lines.some((l) => l.text === UNSURE) && P.ocrLines.lowConfidence(page).length === 1);
  check('page lines: duplicate reading of one line dropped', lines.filter((l) => /^Channel/.test(l.text)).length === 1);
  const titles = lines.filter((l) => l.ocr.title).map((l) => l.text);
  check('page lines: block titles are headings', JSON.stringify(titles) === JSON.stringify(['Cell organelles', 'Membrane', 'Photosynthesis', 'Pigments', 'Genetics']) &&
    lines.filter((l) => l.ocr.title).every((l) => l.isBold && l.fontSize >= 16), JSON.stringify(titles));
  const byId = new Map(result.lines.map((l) => [l.regions[0].id, l.regions[0].text]));
  check('page lines: ocr.regionIds point at the result regions they came from', lines.every((l) => l.ocr.regionIds.length === 1 && byId.get(l.ocr.regionIds[0]) === l.text));
  check('page lines: the result itself is left untouched', JSON.stringify(result) === before);
}

function scopeTests(scope) {
  const text = scope.text;
  const at = (s) => text.indexOf(s);
  check('scope text: each topic reads as one run', at('Nucleus') < at('Membrane') && at('Channel') < at('Photosynthesis') && at('Carotenoids') < at('Genetics') && at('Genetics') > 0, text);
  check('scope text: unsure line left out', !text.includes(UNSURE));
  check('scope: topics named by their first block', JSON.stringify(scope.canvas.topics.map((t) => t.name)) === JSON.stringify(['Cell organelles', 'Photosynthesis', 'Genetics']));
  check('scope: one slide-shaped block per group', scope.canvas.slides.length === 5 && scope.canvas.slides[1].title === 'Membrane' && scope.canvas.share === 1);
}

function materialTests(g) {
  const cards = g.flashcards;
  for (const p of PAIRS) {
    const mine = cards.filter((c) => c.front === up(p.term) || c.front.endsWith(`: ${up(p.term)}`));
    check(`cards: "${p.term}" has its own definition`, mine.length === 1 && mine[0].back === up(p.def), JSON.stringify(mine));
  }
  check('cards: nothing from the unsure line', !cards.some((c) => `${c.front} ${c.back}`.includes(UNSURE)));
  const quiz = g.quiz;
  check('quiz: 10 questions, answers among options', quiz.length === 10 && quiz.every((q) => q.type === 'reveal' || q.options.includes(q.answer)), String(quiz.length));
  const defOf = new Map(PAIRS.map((p) => [up(p.def), up(p.term)]));
  const matched = quiz.filter((q) => /best matches/.test(q.question));
  check('quiz: "which term matches" asks for the term of that very definition',
    matched.length > 0 && matched.every((q) => defOf.get((q.question.match(/"([^"]+)"$/) || [])[1]) === q.answer), JSON.stringify(matched.map((q) => [q.question, q.answer])));
  const test = g.test;
  const names = (test.sections || []).map((s) => s.name);
  check('test: questions asked, sections by topic', test.total >= 8 && names.some((n) => ['Cell organelles', 'Photosynthesis', 'Genetics'].includes(n)), JSON.stringify(names));
  check('summary: each block listed with its own pairs', (g.summary.slideBreakdown || []).length === 5 &&
    g.summary.slideBreakdown[2].definitions.some((d) => d.term === 'Chloroplast'), JSON.stringify(g.summary.slideBreakdown && g.summary.slideBreakdown.map((e) => e.title)));
}

async function pipelineTests() {
  const result = canvasResult();
  const before = JSON.stringify(result);
  const page = { pageNumber: 1, width: 800, height: 600, lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'no-text', recognised: false } };
  const parsed = { numPages: 1, pages: [page], pageCache: new Map([[1, page]]), outline: [] };
  const orig = P.hwPipeline;
  P.hwPipeline = { ensureRecognised: async () => { P.ocrLines.applyToPage(page, result); return { pages: 1, cancelled: false, engine: { available: true } }; } };
  try {
    const st = { parsedPdf: parsed, activeMode: 'book', quizCount: 10, quizSeed: 0, generated: {},
      selectedScope: { title: 'Pages 1-1', startPage: 1, endPage: 1 }, slideDeck: { slides: [] } };
    await P.studyPipeline.buildMaterials(st, 1, 1, () => {});
    pageLineTests(page, result, before);
    scopeTests(st.lastScopeObj);
    materialTests(st.generated);
    P.studyPipeline.regenerateQuiz(st, 6, 3);
    check('regenerate quiz: canvas blocks again, 6 questions', st.generated.quiz.length === 6);
    // Slide mode: the canvas page is read as one slide per block
    const deck = { parsedPdf: parsed, activeMode: 'slide_deck', quizCount: 10, quizSeed: 0, generated: {},
      selectedScope: { title: 'All slides', startPage: 1, endPage: 1 }, slideDeck: { slides: [{ slideNumber: 1, title: 'Slide 1', bullets: [] }] } };
    await P.studyPipeline.buildMaterials(deck, 1, 1, () => {});
    check('slide mode: cards from the canvas blocks', deck.generated.flashcards.some((c) => c.front === 'Allele' && c.back === 'One version of a gene'));
  } finally { P.hwPipeline = orig; }
}

function pairTests() {
  const pair = (s) => { const p = P.ocrCanvas.pairOf(s); return p ? `${p.term}|${p.def}` : null; };
  check('pairOf: "term - def", "label: text", "a = b", "a -> b", "x- y"', pair('Crust - thin outer layer') === 'Crust|thin outer layer' && pair('Speed: distance over time') === 'Speed|distance over time' &&
    pair('Work = force times distance') === 'Work|force times distance' && pair('Input -> output') === 'Input|output' && pair('Na-K pump- moves ions') === 'Na-K pump|moves ions');
  check('pairOf: hyphenated words and plain lines are not pairs', pair('P-glycoprotein') === null && pair('rapid growth of cities') === null && pair('- bullet line here') === null);
}

// Ordinary result: page lines exactly as before canvas support (snapshot taken from the previous version).
const PLAIN_EXPECTED = '[{"text":"Plate tectonics","formattedText":"Plate tectonics","cleanText":"Plate tectonics","x0":50,"textX0":50,"x1":350,"topY":50,"bottomY":70,"fontSize":16,"isBold":false,"hasBullet":false,"hasMath":false,"isCode":false,"wordCount":2,"pageWidth":600,"pageHeight":800,"ocr":{"lineIndex":0,"confidence":0.95,"low":false,"regionIds":["p1-l0-r0"]}},{"text":"Crust - the thin outer layer","formattedText":"Crust - the thin outer layer","cleanText":"Crust - the thin outer layer","x0":50,"textX0":50,"x1":500,"topY":80,"bottomY":93,"fontSize":11,"isBold":false,"hasBullet":false,"hasMath":false,"isCode":false,"wordCount":6,"pageWidth":600,"pageHeight":800,"ocr":{"lineIndex":1,"confidence":0.9,"low":false,"regionIds":["p1-l1-r0"]}},{"text":"Crust - the thin outer layer","formattedText":"Crust - the thin outer layer","cleanText":"Crust - the thin outer layer","x0":50,"textX0":50,"x1":500,"topY":80,"bottomY":93,"fontSize":11,"isBold":false,"hasBullet":false,"hasMath":false,"isCode":false,"wordCount":6,"pageWidth":600,"pageHeight":800,"ocr":{"lineIndex":2,"confidence":0.8,"low":false,"regionIds":["p1-l2-r0"]}},{"text":"• Mantle: hot rock that flows slowly","formattedText":"• Mantle: hot rock that flows slowly","cleanText":"Mantle: hot rock that flows slowly","x0":50,"textX0":50,"x1":500,"topY":120,"bottomY":132.5,"fontSize":10.576923076923077,"isBold":false,"hasBullet":true,"hasMath":false,"isCode":false,"wordCount":7,"pageWidth":600,"pageHeight":800,"ocr":{"lineIndex":4,"confidence":0.85,"low":false,"regionIds":["p1-l4-r0"]}}]';

function plainTests() {
  const reg = (id, text, conf, box) => ({ id, kind: 'text', box, text, confidence: conf, source: 'model' });
  const row = (i, text, conf, y, h, w) => ({ index: i, box: { x: 100, y, w, h }, regions: [reg(`p1-l${i}-r0`, text, conf, { x: 100, y, w, h })] });
  const result = { pageNumber: 1, scale: 2, width: 1200, height: 1600, lines: [
    row(0, 'Plate tectonics', 0.95, 100, 40, 600), row(1, 'Crust - the thin outer layer', 0.9, 160, 26, 900),
    row(2, 'Crust - the thin outer layer', 0.8, 160, 26, 900), row(3, 'zzq', 0.3, 200, 26, 900),
    row(4, '# Mantle : hot rock that flows slowly', 0.85, 240, 25, 900)] };
  const got = JSON.stringify(P.ocrLines.toPageLines(result, { width: 600, height: 800 }));
  check('non-canvas result: page lines byte-identical to before', got === PLAIN_EXPECTED, got);
  const page = { pageNumber: 1, width: 600, height: 800, lines: [], ink: { needsRecognition: true, recognised: true, result } };
  check('non-canvas result: not treated as a canvas page', !P.ocrCanvasScope.isCanvasPage(page));
}

(async () => {
  const t0 = Date.now();
  for (const [name, fn] of [['pairs', pairTests], ['plain', plainTests], ['pipeline', pipelineTests]]) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
  }
  console.log(`info: ${Date.now() - t0} ms`);
  console.log(`handwriting_canvas_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
