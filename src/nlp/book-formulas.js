/**
 * Book formulas: the displayed results a textbook section states (laws, identities, named theorems), for
 * book-outline.js. Chosen from layout and wording only, never from the subject:
 *   - a numbered run of three or more equations ("1. X + 0 = X", "2. X ⋅ 1 = X", ...): the book's numbered
 *     identities or laws, shown together as one list under the caption or heading that introduces them;
 *   - a displayed equation the text around it names: "... are referred to as DeMorgan's theorem",
 *     "the following consensus theorem is useful ...:", "The dual of the consensus theorem is".
 * Derivation steps (a display opening with "=") and anything whose notation is known to be damaged are left out.
 *   pick(paragraphs) -> [{ title, body, page }]
 *   paragraphs: book-sections.js paragraphs of one section ({ text, page, kind }).
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const MIN_RUN = 3; // numbered equations in a row before they count as the book's list of results
  const MAX_ITEM_CHARS = 90; // a numbered item longer than this is a worked step or prose, not a stated result
  const MAX_LIST = 20; // items shown from one numbered list

  // "are referred to as DeMorgan’s theorem", "is called the consensus theorem"
  const RESULT_NOUN = '(?:theorems?|laws?|rules?|identit(?:y|ies)|principles?|propert(?:y|ies)|postulates?|axioms?|formulas?|equations?)';
  const NAMED_AFTER_RE = new RegExp(`^(?:is|are)\\s+(?:referred\\s+to\\s+as|called|known\\s+as)\\s+(?:the\\s+)?((?:[A-Za-z][\\w’'-]*\\s+){0,3}${RESULT_NOUN})\\b`, 'i');
  // "the following consensus theorem is useful ...:", "The dual of the consensus theorem is", "The general
  // DeMorgan’s theorem can be expressed as": one named result (singular), introduced right before the display.
  const SINGLE_RESULT = '(?:theorem|law|rule|identity|principle|postulate|axiom|formula)';
  const NAMED_BEFORE_RE = new RegExp(`\\b((?:dual\\s+of\\s+the\\s+)?(?:general\\s+)?(?!(?:of|the|these|this|that|some|following|basic|above|previous|same|first|second|last|each|an?)\\s)[A-Za-z][\\w’'-]+\\s+${SINGLE_RESULT})\\b[^.]*?(?::|\\b(?:is|as|are|states|reads))\\s*$`, 'i');
  // The lead-in of a worked example or a proof, not of a stated result
  const WORKED_RE = /\b(?:example|proof|proceeds|as\s+follows|we\s+obtain|applied|apply|applying|consider|simplif(?:y|ied))\b/i;
  const PLAIN_MATH_RE = /^\$\$?[^$]+\$\$?(?:\s+and\s+\$[^$]+\$)?\.?$/;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const titleCase = (t) => (/^[a-z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);

  function damaged(text) {
    const st = dep('summaryStatements', './summary-statements.js');
    return /¿/.test(text) || Boolean(st && (st.mathDamage(text) || st.isMangled(text)));
  }

  /** "$X + (Y + Z$" -> "$X + (Y + Z$" made whole: every dollar dropped, the item set as one formula. */
  const asFormula = (s) => {
    const body = String(s || '').replace(/\$/g, '').replace(/\s+/g, ' ').replace(/[.,;]\s*$/, '').trim();
    return body ? `$${body}$` : '';
  };

  /**
   * Numbered items in order, each cut where the next number starts ("12. ... Z13. X(YZ)" holds 12 and 13)
   * or where a sentence of prose begins after it.
   */
  function numberedItems(text, from) {
    const out = [];
    let n = from;
    let rest = String(text || '');
    const head = rest.match(new RegExp(`^${n}\\s*\\.\\s*`));
    if (!head) return out;
    rest = rest.slice(head[0].length);
    for (;;) {
      const next = rest.search(new RegExp(`(?<!\\d)${n + 1}\\s*\\.\\s*(?=[\\$A-Za-z(\\\\])`));
      const body = (next >= 0 ? rest.slice(0, next) : rest).replace(/\s+[A-Z][a-z]+\s+[a-z][\s\S]*$/, '').trim();
      out.push({ n, body });
      if (next < 0) break;
      rest = rest.slice(next).replace(new RegExp(`^${n + 1}\\s*\\.\\s*`), '');
      n += 1;
    }
    return out;
  }

  const isResult = (body) => {
    const t = plain(body).replace(/\$/g, '');
    return t.length > 0 && t.length <= MAX_ITEM_CHARS && /=/.test(t) && !/^=/.test(t) &&
      !/\b(?!and\b|or\b)[a-z]{3,}\b/.test(t.replace(/\\[A-Za-z]+/g, ' '));
  };

  /** The book's numbered list of results, from consecutive numbered paragraphs (list rows or a table). */
  function numberedRuns(paragraphs) {
    const runs = [];
    let run = null;
    let caption = '';
    for (const p of paragraphs) {
      const text = plain(p.text).replace(/\s*\|\s*/g, ' ');
      const m = text.match(/^(\d{1,2})\s*\.\s*\S/);
      // A number out of sequence ends the run; a fresh "1." may start the next one
      if (run && m && Number(m[1]) !== run.items[run.items.length - 1].n + 1) { runs.push(run); run = null; }
      const expected = run ? run.items[run.items.length - 1].n + 1 : 1;
      if (m && Number(m[1]) === expected) {
        const items = numberedItems(text, expected).filter((it) => it.body);
        if (!run) run = { items: [], page: p.page, caption };
        run.items.push(...items);
        continue;
      }
      // Prose between numbered items ("Note that ...") keeps a run of results open, but not a stray "1." or "2."
      if (run && !m && run.items.length < MIN_RUN) run = null;
      if (!run && (p.kind === 'heading' || (/^\*\*[^*]+\*\*$/.test(String(p.text).trim()) && p.text.length < 80))) caption = plain(p.text);
      else if (!run) caption = '';
    }
    if (run) runs.push(run);
    return runs
      .map((r) => ({ ...r, items: r.items.filter((it) => isResult(it.body) && !damaged(it.body)) }))
      .filter((r) => r.items.length >= MIN_RUN)
      .map((r) => ({
        title: titleCase(r.caption) || 'Numbered results',
        body: r.items.slice(0, MAX_LIST).map((it) => `${it.n}. ${asFormula(it.body)}`).join('\n'),
        page: r.page,
      }));
  }

  /** The last sentence of a paragraph. */
  const lastSentence = (text) => {
    const parts = plain(text).split(/(?<=[.!?])\s+(?=[A-Z])/);
    return parts[parts.length - 1] || '';
  };

  /** Displays the text around them names: "... are referred to as X's theorem", "the following X theorem ...:". */
  function namedDisplays(paragraphs) {
    const out = [];
    let lastName = '';
    paragraphs.forEach((p, i) => {
      const text = plain(p.text);
      const display = p.kind === 'math' || PLAIN_MATH_RE.test(text);
      if (!display) { lastName = ''; return; }
      if (/^\$*\s*=/.test(text) || damaged(text) || !/=/.test(text)) return;
      const next = paragraphs[i + 1] ? plain(paragraphs[i + 1].text) : '';
      const prev = paragraphs[i - 1] ? plain(paragraphs[i - 1].text) : '';
      // A display the next line continues with "= ..." is the first step of a derivation
      if (/^\$*\s*=/.test(next)) return;
      const after = next.match(NAMED_AFTER_RE);
      const lead = prev ? lastSentence(prev) : '';
      const before = !after && lead && !WORKED_RE.test(lead) ? lead.match(NAMED_BEFORE_RE) : null;
      // A second display straight after a named one ("can be expressed as" + two lines) shares its name.
      const name = after ? after[1] : before ? before[1] : (paragraphs[i - 1] && paragraphs[i - 1].kind === 'math' ? lastName : '');
      if (!name) return;
      lastName = name;
      out.push({ title: titleCase(name.replace(/^the\s+/i, '').trim()), body: text.replace(/^\$\$|\$\$$/g, '$').replace(/^([^$])/, '$1'), page: p.page });
    });
    return out;
  }

  function pick(paragraphs) {
    const list = (paragraphs || []).filter((p) => p && p.text);
    return numberedRuns(list).concat(namedDisplays(list));
  }

  const api = { pick, numberedItems };
  PDFStudy.bookFormulas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
