/**
 * Handwriting evaluation tool fixtures (Node, no browser): text normalisation, Levenshtein, CER/WER, line
 * alignment, category grouping, kept-only scoring, calibration buckets and the PNG reader.
 * Run: node tests/handwriting_eval_fixtures.js
 */
const path = require('path');
const tool = (f) => require(path.join(__dirname, '..', 'tools', f));
const m = tool('eval-metrics.js');
const sc = tool('eval-score.js');
const png = tool('eval-png.js');
const { imageToPdf } = tool('eval-pdf.js');
const { buildSummary, markdown } = tool('eval-report.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`[OK] ${name}`); return; }
  failed++;
  console.log(`FAIL ${name}${detail === undefined ? '' : `\n     ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const throwsLike = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// 1. Levenshtein
check('levenshtein: kitten -> sitting is 3', m.levenshtein('kitten', 'sitting') === 3);
check('levenshtein: empty side is the other length', m.levenshtein('', 'abc') === 3 && m.levenshtein('abc', '') === 3);
check('levenshtein: works on word arrays', m.levenshtein(['a', 'b', 'c'], ['a', 'c']) === 1);
check('levenshtein: counts code points, not UTF-16 units', m.levenshtein('a😀', 'ab') === 1);

// 2. Normalisation
check('normalise: quotes, dashes, spaces, space before punctuation', m.normalise('  “Hello” —  world ,ok ! ') === '"Hello" - world,ok!', m.normalise('  “Hello” —  world ,ok ! '));
check('normalise: NFKC folds ligatures and curly apostrophes', m.normalise('ﬁne ‘it’s’') === "fine 'it's'");
check('loose: lower case, punctuation stripped', m.loose('Hello, World! (Twice)') === 'hello world twice');

// 3. CER / WER
const s1 = m.score('the cat sat', 'the bat sat');
check('score: one substituted letter', s1.charEdits === 1 && s1.refChars === 11 && near(s1.cer, 1 / 11));
check('score: one wrong word of three', s1.wordEdits === 1 && s1.refWords === 3 && near(s1.wer, 1 / 3));
const s2 = m.score('Hello, world.', 'hello world');
check('score: case and punctuation count in CER, not in loose CER', s2.charEdits === 3 && s2.looseEdits === 0 && near(s2.looseCer, 0));
check('score: both sides normalised alike', m.score('it’s  done .', "it's done.").charEdits === 0);
check('score: empty hypothesis is CER 1, empty both is 0', m.score('ab', '').cer === 1 && m.score('', '').cer === 0);

// 4. Line alignment: merged pieces, a missed line, a hallucinated extra piece
const refs = ['the quick brown fox', 'jumps over the lazy dog', 'and runs away'];
const pieces = [{ text: 'the quick', confidence: 0.9 }, { text: 'brown fox', confidence: 0.5 }, { text: 'and runs away', confidence: 0.8 }, { text: 'zz zz', confidence: 0.2 }];
const al = m.alignLines(refs, pieces, 3);
check('align: two pieces merge into the first line', al.lines[0].matched && al.lines[0].pieces === 2 && al.lines[0].got === 'the quick brown fox' && al.lines[0].cer === 0, al.lines[0]);
check('align: merged confidence is length-weighted, min kept', near(al.lines[0].confidence, 0.7) && al.lines[0].minConfidence === 0.5, al.lines[0]);
check('align: the unread line is a miss', !al.lines[1].matched && al.lines[1].cer === 1 && al.missed === 1, al.lines[1]);
check('align: third line matches exactly', al.lines[2].matched && al.lines[2].cer === 0 && al.lines[2].pieces === 1);
check('align: trailing junk is an extra piece', al.extras.length === 1 && al.extras[0].text === 'zz zz', al.extras);
const al2 = m.alignLines(['alpha beta', 'gamma'], [{ text: 'alpha bcta', confidence: 0.4 }, { text: 'gamma', confidence: 0.9 }]);
check('align: a slightly wrong line still matches with its CER', al2.lines[0].matched && near(al2.lines[0].cer, 0.1) && al2.extras.length === 0);
check('align: nothing recognised means every line missed', m.alignLines(['a', 'b'], []).missed === 2);
const al3 = m.alignLines(['one two three four'], ['one', 'two', 'three', 'four'].map((t) => ({ text: t, confidence: 1 })), 3);
check('align: at most 3 pieces merge into one line', al3.lines[0].pieces <= 3 && al3.extras.length >= 1, al3);

// 5. Pages, categories, real vs synthetic
const rec = (file, texts, extra) => Object.assign({ file, seconds: 2, result: { lines: texts.map((t) => ({ regions: [Object.assign({ text: t[0], confidence: t[1] }, t[2] ? { stats: t[2] } : {})] })) } }, extra);
check('category: prefix decides, unknown is Other', sc.categoryOf('neat-01-x.jpg') === 'Neat' && sc.categoryOf('synthetic-02.png') === 'Synthetic' && sc.categoryOf('math-01.jpg') === 'Other');
check('category: scanned print has its own group and counts as real', sc.categoryOf('printed-02-two-columns.jpg') === 'Printed' && !sc.isSynthetic('printed-02-two-columns.jpg'));
const pages = [
  sc.scorePage(rec('neat-01.jpg', [['abcd', 0.9]]), ['abcd']),
  sc.scorePage(rec('messy-01.jpg', [['abcxyz', 0.3]]), ['abcdef']),
  sc.scorePage(rec('synthetic-01.png', [['zz', 0.9]]), ['ab']),
  sc.scorePage(rec('average-09.jpg', [['q', 0.9]]), null),
];
const g = sc.groupSummary(pages);
check('groups: per category', g.byCategory.Neat.pages === 1 && g.byCategory.Messy.pages === 1 && g.byCategory.Synthetic.pages === 1 && g.byCategory.Average.scoredPages === 0);
check('groups: real CER is micro-averaged over real pages only', near(g.real.all.cer, 3 / 10) && g.real.pages === 3 && g.real.scoredPages === 2, g.real.all);
check('groups: synthetic kept apart', near(g.synthetic.all.cer, 1) && g.synthetic.pages === 1);
check('groups: pieces per page, low share, seconds per piece', near(g.real.piecesPerPage, 1) && near(g.real.lowShare, 1 / 3) && near(g.real.secondsPerPiece, 2));
check('groups: page without transcript is listed, not scored', pages[3].scored === false && pages[3].pieces === 1);

// 6. Kept pieces only
const kp = sc.scorePage(rec('neat-02.jpg', [['hello world', 0.9, { mean: 0.95, min: 0.8 }], ['goodbye', 0.3, { mean: 0.5, min: 0.1 }]]), ['hello world', 'goodbye']);
check('kept: all pieces read the page perfectly', kp.all.page.charEdits === 0 && kp.low === 1 && kp.pieces === 2);
check('kept: dropping the low piece costs its characters', kp.kept.page.charEdits === 8 && kp.kept.page.refChars === 19, kp.kept.page);
check('kept: coverage is the share of reference chars on kept, matched lines', near(kp.kept.coverage, 11 / 18) && kp.kept.missed === 1, kp.kept);

// 7. Calibration buckets (real pages only), stats tables only when stats exist
const cal = sc.calibrationTables([kp, pages[2]]);
check('calibration: one line in 0.8-1.0, one in 0.2-0.4', cal.confidence[4].count === 1 && cal.confidence[1].count === 1 && cal.confidence[0].count === 0, cal.confidence);
check('calibration: tables keyed on stats.mean and stats.min', cal.statsMean && cal.statsMean[4].count === 1 && cal.statsMin && cal.statsMin[0].count === 1 && cal.statsMin[4].count === 1, cal);
check('calibration: works without stats', !sc.calibrationTables(pages).statsMean && sc.calibrationTables(pages).confidence.length === 5);
const md = markdown(buildSummary([...pages, kp]));
check('report: markdown has real and synthetic rows and worst lines', /\*\*Real\*\*/.test(md) && /\*\*Synthetic\*\*/.test(md) && /15 worst/.test(md));

// 8. PNG reader
const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]); // 3 x 2
const okRgb = [0, 1, 2, 3, 4].every((f) => {
  const d = png.decodePng(png.encodePng(rgb, 3, 2, 2, f));
  return d.w === 3 && d.h === 2 && d.channels === 3 && d.data.equals(rgb);
});
check('png: RGB round trip through every row filter', okRgb);
const rgba = Buffer.from([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128, 200, 100, 50, 255]); // 2 x 2
const d4 = png.decodePng(png.encodePng(rgba, 2, 2, 6, 4));
check('png: RGBA composited onto white', d4.channels === 3 && d4.data.equals(Buffer.from([0, 0, 0, 255, 255, 255, 127, 127, 127, 200, 100, 50])), [...d4.data]);
const g8 = png.decodePng(png.encodePng(Buffer.from([0, 128, 255, 7]), 2, 2, 0, 1));
check('png: 8-bit gray stays one channel', g8.channels === 1 && g8.data.equals(Buffer.from([0, 128, 255, 7])));
const deep = png.encodePng(rgb, 3, 2, 2, 0); deep[24] = 16;
check('png: 16-bit is refused with a clear error', throwsLike(() => png.decodePng(deep), /16-bit/));
const inter = png.encodePng(rgb, 3, 2, 2, 0); inter[28] = 1;
check('png: interlaced is refused with a clear error', throwsLike(() => png.decodePng(inter), /interlaced/));
check('png: not a PNG is refused', throwsLike(() => png.decodePng(Buffer.from('hello world, this is not an image file')), /not a PNG/));
const doc = imageToPdf(png.encodePng(rgba, 2, 2, 6, 0), 'png');
const docText = doc.pdf.toString('latin1');
check('pdf: PNG page embeds a FlateDecode RGB image', doc.w === 2 && doc.h === 2 && /^%PDF-1\.4/.test(docText) && /\/FlateDecode/.test(docText) && /\/DeviceRGB/.test(docText) && /%%EOF\n$/.test(docText));

console.log(`handwriting_eval_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
