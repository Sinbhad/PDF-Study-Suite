/**
 * Contrast Cards: pairs a lecture or a chapter sets against each other, asked as one "how do they differ?"
 *   numbered kinds    "Hansen's type 1 = ..." and "Hansen's type 2 = ..."    -> "Hansen's type 1 vs type 2"
 *   opposite words    "Acute infarct" and "Chronic infarct" (same remaining words) -> "Acute vs chronic infarct"
 *   "X vs Y" slides   title "Coup vs contrecoup" over its bullets          -> "Coup vs contrecoup — how do they differ?"
 * Only cards that already passed their own gates are paired, so a contrast never adds an unchecked fact.
 * fromCards(cards, slides?) -> [{ front, back, category: 'Contrast', kind: 'overview', subject, sourceKind: 'list' }]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // Words that name the kind in "type 1 / type 2", "grade I / grade II", "stage A / stage B".
  const NUMBERED_KIND_RE = /^(.*?)\b(type|class|grade|stage|phase|form|degree)\s+(\d+|[IVX]{1,4}|[A-D])\b(.*)$/i;
  // Opposites a lecture contrasts; each pair is general vocabulary of description, not of one subject.
  const OPPOSITES = [
    ['acute', 'chronic'], ['primary', 'secondary'], ['central', 'peripheral'], ['upper', 'lower'], ['active', 'passive'],
    ['direct', 'indirect'], ['internal', 'external'], ['intrinsic', 'extrinsic'], ['wet', 'dry'], ['benign', 'malignant'],
    ['aerobic', 'anaerobic'], ['positive', 'negative'], ['proximal', 'distal'], ['dorsal', 'ventral'], ['afferent', 'efferent'],
    ['sensory', 'motor'], ['innate', 'adaptive'], ['endogenous', 'exogenous'], ['synchronous', 'asynchronous'],
    ['static', 'dynamic'], ['implicit', 'explicit'], ['local', 'global'], ['inclusive', 'exclusive'], ['necessary', 'sufficient'],
  ];
  const VS_TITLE_RE = /^(.{2,60}?)\s+(?:vs\.?|versus)\s+(.{2,60})$/i;
  const MAX_SIDE_CHARS = 220;
  const MAX_VS_BULLETS = 7;

  // Quote marks around a word ("‘Wet’ FIP") go; an apostrophe inside one ("Hansen’s") stays.
  const tidy = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/(^|\s)[‘'"“]+|[’'"”]+(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
  /** The label a card asks about: the part after "Entity — ", without a trailing bracket. */
  const labelOf = (front) => tidy(String(front).split(/\s+[—–]\s+/).pop()).replace(/\s*\([^)]*\)\s*$/, '');
  const flat = (back) => tidy(String(back).replace(/^\s*•\s*/gm, '').replace(/\n+/g, '; '));
  const cap = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

  function pairCard(front, a, b, subject) {
    const sideA = flat(a.back);
    const sideB = flat(b.back);
    if (!sideA || !sideB || sideA.length > MAX_SIDE_CHARS || sideB.length > MAX_SIDE_CHARS || sideA === sideB) return null;
    return {
      front, back: `• ${cap(labelOf(a.front))}: ${sideA}\n• ${cap(labelOf(b.front))}: ${sideB}`,
      category: 'Contrast', kind: 'overview', subject, sourceKind: 'list', page: a.page || a.pageNumber || null, pageNumber: a.pageNumber || a.page || null,
      topic: a.topic || subject, context: a.context,
    };
  }

  function numberedPairs(cards, out, used) {
    const byBase = new Map();
    for (const c of cards) {
      const m = labelOf(c.front).match(NUMBERED_KIND_RE);
      if (!m) continue;
      const key = `${m[1].trim().toLowerCase()}|${m[2].toLowerCase()}|${m[4].trim().toLowerCase()}`;
      byBase.set(key, [...(byBase.get(key) || []), { c, m }]);
    }
    for (const list of byBase.values()) {
      if (list.length < 2 || list[0].m[3] === list[1].m[3]) continue;
      const [a, b] = list;
      const base = `${a.m[1]}${a.m[2]}`.trim();
      const card = pairCard(`${cap(base)} ${a.m[3]} vs ${a.m[2].toLowerCase()} ${b.m[3]} — how do they differ?`, a.c, b.c, cap(`${a.m[1]}${a.m[2]}`.trim()));
      if (card) { out.push(card); used.add(a.c); used.add(b.c); }
    }
  }

  function oppositePairs(cards, out, used) {
    for (const [x, y] of OPPOSITES) {
      const side = (word) => cards.filter((c) => !used.has(c)).map((c) => {
        const words = labelOf(c.front).toLowerCase().split(/\s+/);
        const at = words.indexOf(word);
        return at < 0 || words.length > 5 ? null : { c, rest: words.filter((_, i) => i !== at).join(' ') };
      }).filter(Boolean);
      const xs = side(x);
      const ys = side(y);
      for (const a of xs) {
        const b = ys.find((o) => o.rest === a.rest && o.c !== a.c);
        if (!b) continue;
        const rest = a.rest ? ` ${a.rest}` : '';
        const card = pairCard(`${cap(x)} vs ${y}${rest} — how do they differ?`, a.c, b.c, a.c.subject || cap(a.rest) || cap(x));
        if (card) { out.push(card); used.add(a.c); used.add(b.c); }
      }
    }
  }

  function vsSlides(slides, out) {
    for (const s of slides || []) {
      const m = tidy(s.title).match(VS_TITLE_RE);
      if (!m || !s.bullets || s.bullets.length < 2 || s.bullets.length > MAX_VS_BULLETS) continue;
      if (s.contentKind && s.contentKind !== 'content') continue;
      out.push({
        front: `${cap(m[1])} vs ${m[2]} — how do they differ?`, back: s.bullets.map((b) => `• ${b}`).join('\n'),
        category: 'Contrast', kind: 'overview', subject: cap(m[1]), sourceKind: 'list', page: s.slideNumber, pageNumber: s.slideNumber,
        topic: tidy(s.title), context: `Slide ${s.slideNumber}: ${tidy(s.title)}`,
      });
    }
  }

  function fromCards(cards, slides) {
    const out = [];
    const used = new Set();
    const pool = (cards || []).filter((c) => c && c.front && c.back && c.category !== 'Contrast');
    numberedPairs(pool, out, used);
    oppositePairs(pool, out, used);
    vsSlides(slides, out);
    return out;
  }

  /**
   * "An arithmetic variable designates a number ..., whereas a logic variable is always either a 1 or a 0."
   * A sentence that sets two kinds of one thing against each other (the two noun phrases share their head noun)
   * is a contrast card: "Arithmetic variable vs logic variable" => the sentence, without its lead-in.
   * sentences: the scope's sentences (plain text). -> [{ front, back, category: 'Contrast', ... }]
   */
  function fromSentences(sentences) {
    const out = [];
    for (const raw of sentences || []) {
      const s = tidy(raw).replace(CONTRAST_LEAD_RE, '');
      const m = s.match(WHEREAS_RE);
      if (!m || s.length > MAX_WHEREAS_CHARS) continue;
      // The two subjects: the shortest openings of each half (two or three words) that end in the same noun.
      const openings = (words) => [2, 3].filter((n) => words.length > n).map((n) => words.slice(0, n).join(' ').toLowerCase());
      const head = (np) => np.split(/\s+/).pop().replace(/s$/, '');
      let a = '';
      let b = '';
      for (const x of openings(m[1].split(/\s+/))) {
        const y = openings(m[2].split(/\s+/)).find((o) => head(o) === head(x) && o !== x);
        if (y && !a) [a, b] = [x, y];
      }
      if (!a) continue;
      const back = s[0].toUpperCase() + s.slice(1);
      out.push({ front: `${a[0].toUpperCase()}${a.slice(1)} vs ${b}`, back: /[.!]$/.test(back) ? back : `${back}.`, category: 'Contrast', kind: 'concept', subject: a, sourceKind: 'key-concept' });
    }
    return out;
  }
  // Each half opens with an article and runs on in lower case: "<an X Y ...>, whereas <a Z Y ...>".
  const WHEREAS_RE = /^(?:[Aa]n?|[Tt]he)\s+([a-z][^,;]{12,170}),\s+(?:whereas|while)\s+(?:an?|the)\s+([a-z][^;]{8,170})$/;
  // "One should realize that ..." / "Note that ...": the author's lead-in, not part of the contrast.
  const CONTRAST_LEAD_RE = /^(?:one\s+should\s+(?:realize|note|remember)\s+that|note\s+that|remember\s+that|recall\s+that)\s+/i;
  const MAX_WHEREAS_CHARS = 320;

  const api = { fromCards, fromSentences };
  PDFStudy.contrastCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
