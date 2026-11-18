/**
 * List Questions: a slide's labelled list asked as a choice between its members and the members of its sibling
 * lists (the lists under the other labels of the same heading on the same slide):
 *   NOT       Which of these is NOT listed under "Practical blocks — Head"?   3 members, 1 member of "— Abdomen"
 *   belongs   Which of these is listed under "Practical blocks — Head"?       1 member, 3 members of the siblings
 * The asked list holds at least MIN_MEMBERS short items. An outsider comes only from a sibling list, and only when no
 * list the scope prints under the asked label (on any slide) holds it or a word of it, so the key says what the
 * source says. Options are short names of one shape (no "Label: value" lines, no sentences).
 *   candidates(cards, { seed }) -> [question]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);
  const qf = () => dep('quizFacts', './quiz-facts.js');

  const MIN_MEMBERS = 4;
  const MAX_ITEM_WORDS = 6;
  const LENGTH_TELL_RATIO = 2.2; // an outsider far longer or shorter than the members stands out
  const LENGTH_TELL_CHARS = 14;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  /** The list a card's back holds ("• Cornual Nerve Block\n• Auriculopalpebral"), or [] when it is not a bullet list. */
  function itemsOf(card) {
    const lines = String(card.back || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2 || !lines.every((l) => /^•\s*\S/.test(l))) return [];
    const items = lines.map((l) => l.replace(/^•\s*/, '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim());
    // Short names only: a "Label: value" line, a sentence or a bracketed note is a point, not a member.
    if (items.some((x) => words(x).length > MAX_ITEM_WORDS || /[:;.!?]$|:\s/.test(x) || /^\(/.test(x))) return [];
    return items;
  }

  /** "Local Blocks – Practical Blocks — Head" -> { head: "Local Blocks – Practical Blocks", label: "Head" } */
  function split(front) {
    const parts = String(front || '').split(/\s+—\s+/);
    return parts.length >= 2 ? { head: parts.slice(0, -1).join(' — ').trim(), label: parts[parts.length - 1].trim() } : null;
  }

  const sameLength = (a, members) => {
    const longest = Math.max(...members.map((m) => m.length));
    const shortest = Math.min(...members.map((m) => m.length));
    return a.length <= Math.max(longest * LENGTH_TELL_RATIO, longest + LENGTH_TELL_CHARS) && a.length * LENGTH_TELL_RATIO >= shortest;
  };

  function candidates(cards, opts = {}) {
    const seed = opts.seed || 0;
    const lists = [];
    for (const card of cards || []) {
      if (!card || card.sourceKind !== 'label') continue;
      const parts = split(card.front);
      const items = parts ? itemsOf(card) : [];
      if (items.length) lists.push({ card, ...parts, items, page: card.pageNumber || card.page || null });
    }
    // Everything the scope lists under each label: an outsider must be in none of them.
    const underLabel = new Map();
    for (const l of lists) underLabel.set(norm(l.label), [...(underLabel.get(norm(l.label)) || []), ...l.items]);
    const out = [];
    for (const asked of lists.filter((l) => l.items.length >= MIN_MEMBERS)) {
      const siblings = lists.filter((l) => l !== asked && l.page === asked.page && norm(l.head) === norm(asked.head) && norm(l.label) !== norm(asked.label));
      const listed = underLabel.get(norm(asked.label)) || asked.items;
      const listedStems = new Set(listed.flatMap((x) => qf().contentStems(x)));
      const outsiders = [...new Map(siblings.flatMap((l) => l.items).map((x) => [norm(x), x])).values()]
        .filter((x) => !qf().contentStems(x).some((w) => listedStems.has(w)) && sameLength(x, asked.items));
      if (!outsiders.length) continue;
      const where = `"${asked.head} — ${asked.label}"`;
      const source = `${asked.card.front}: ${String(asked.card.back).replace(/\s*\n\s*/g, ' ')}`;
      const extra = {
        skill: 'definition', category: 'List', subject: asked.head, source, page: asked.page, pageNumber: asked.page,
      };
      const membersShown = shuffle(asked.items, asked.card.front, seed).slice(0, 3);
      const outsider = shuffle(outsiders, `${asked.card.front}|out`, seed)[0];
      const notStem = `Which of these is NOT listed under ${where}?`;
      out.push({
        type: 'multiple_choice', badge: 'Multiple Choice • List', question: notStem,
        options: shuffle([outsider, ...membersShown], notStem, seed), answer: outsider,
        explanation: `${where} lists ${asked.items.join(', ')} (slide ${asked.page}); ${outsider} is listed under "${asked.head} — ${siblings.find((l) => l.items.includes(outsider)).label}".`,
        factKey: `l|not|${norm(asked.card.front)}`, ...extra,
      });
      if (outsiders.length >= 3) {
        const member = shuffle(asked.items, `${asked.card.front}|in`, seed)[0];
        const wrong = shuffle(outsiders, `${asked.card.front}|outs`, seed).slice(0, 3);
        const inStem = `Which of these is listed under ${where}?`;
        out.push({
          type: 'multiple_choice', badge: 'Multiple Choice • List', question: inStem,
          options: shuffle([member, ...wrong], inStem, seed), answer: member,
          explanation: `${where} lists ${asked.items.join(', ')} (slide ${asked.page}); the others are listed under its other labels.`,
          factKey: `l|in|${norm(asked.card.front)}`, ...extra,
        });
      }
    }
    return out;
  }

  const api = { candidates, itemsOf };
  PDFStudy.listQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
