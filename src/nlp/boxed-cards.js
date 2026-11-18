/**
 * Boxed Cards: textbook material set apart from the running text.
 *   fromBlocks(blocks)  extraction's tagged blocks (block.kind):
 *     'definition' | 'theorem'   -> a numbered box ("Definition 4", "Theorem 2 (De Morgan's Laws)") is asked by the
 *                                   term it defines or the name it carries (boxCard), never by its number; a titled
 *                                   box is left to the didactic-block path (title + body), returned in `didactic`
 *     'key-concept'              -> a margin note, asked as a completion card (key-statements.js)
 *     'self-check'               -> the book's own question with its answer: a ready-made Q&A card
 *     'table'                    -> one card per cell (table-cards.js)
 *     'syntax'                   -> "<title> — syntax" => the syntax box
 *     'example' | 'sidebar' | 'proof' -> nothing: illustrations, asides and proofs are not study facts
 *   fromText(text)      "Definition 4 Let p and q be propositions. The exclusive or of p and q, denoted by ...,
 *                       is the proposition ..." (a numbered box whose frame was lost): the term it defines => the box.
 *                       "Theorem 2 (De Morgan's Laws) ..." => named theorems only; an unnamed "Theorem 1" asks nothing.
 *   boxName(title, body)  the term or name a numbered box stands for ('' when it names nothing), for block-quiz.js
 * Every card carries sourceKind ('definition' | 'key-concept' | 'self-check' | 'table') and page when known.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const BOX_HEAD_RE = /^(?:\*\*)?(Definition|Theorem|Lemma|Corollary|Proposition)\s+(\d+(?:\.\d+)*)(?:\*\*)?\s*(?:\(([^)]{3,60})\))?\s*[.:]?\s*(.*)$/;
  const MAX_BOX_LINES = 6;
  const MIN_CUT_BOX_CHARS = 40;
  const MAX_BOX_SENTENCES = 3;
  const SKIPPED_KINDS = new Set(['example', 'sidebar', 'proof']);

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const cap = (s) => (/^[a-z]{2}/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
  const textOf = (blk) => plain(blk.text || blk.body || blk.content || '');
  // A block's body as the didactic path reads it (cross-references and cut-off tails removed).
  const stemCardsBack = (blk) => dep('stemCards', './stem-cards.js').didacticBack(blk);
  const endsSentence = (s) => /[.!?]["”’)]?\s*\$*\s*$/.test(plain(s));

  function selfCheckCards(blk) {
    const pairs = Array.isArray(blk.items) && blk.items.length ? blk.items : [blk];
    return pairs
      .map((p) => ({ question: plain(p.question || p.prompt || ''), answer: plain(p.answer || p.solution || '') }))
      .filter((p) => p.question && p.answer && /\?\s*$|^(?:what|why|how|which|when|where|who|explain|describe|give|name|list)\b/i.test(p.question))
      .map((p) => ({ front: p.question, back: p.answer, category: 'Self Check', kind: 'qa', sourceKind: 'self-check', page: blk.pageNumber || null }));
  }

  /**
   * A rule box ("Common Error 5.2" over "Using == to Compare Strings ..."): the box's own heading names the rule,
   * and the sentences that state it (must / never / always / instead / is an error) are the answer. Sentences about
   * the tools rather than the subject (the editor, the keyboard), code lines, and sentences that lean on the box's
   * example ("In this case, ...") are left out; a box with no such sentence makes no card.
   */
  function ruleBoxCard(blk) {
    const kind = plain(blk.title).match(RULE_BOX_RE)[1];
    // Code is left out: listings in backticks, and statements set inline ("values[10] = 5.4; // Error").
    const body = String(blk.text || blk.body || '').replace(/`[^`]*`/g, ' ').replace(INLINE_CODE_RE, ' ').replace(/\s+/g, ' ').trim();
    // The heading runs in title case up to the capitalised word that opens the first sentence: the last capital
    // before the first lower-case word that no title would hold ("Using == to Compare Strings | If you write").
    const tokens = body.split(' ');
    const firstLower = tokens.findIndex((t) => /^[a-z]/.test(t) && !TITLE_SMALL_WORD_RE.test(t));
    let opener = firstLower - 1;
    while (opener > 0 && !/^[A-Z]/.test(tokens[opener])) opener--;
    const name = opener > 0 ? tokens.slice(0, opener).join(' ') : '';
    if (!name || name.split(/\s+/).length < 2 || name.split(/\s+/).length > 9) return null;
    const sc = dep('selfContained', './self-contained.js');
    const sentences = dep('tokenizer', './tokenizer.js').splitSentences(tokens.slice(opener).join(' '))
      // "you must use the new operator: <listing>" ends where its listing was.
      .map((x) => plain(x).replace(/:\s+[A-Z].*$/, '.'))
      .filter((x) => RULE_WORD_RE.test(x) && !TOOLING_RE.test(x) && !/[{};]|\/\//.test(x) && !sc.unresolvedBack(x) && x.split(/\s+/).length >= 6);
    if (!sentences.length || TOOLING_RE.test(name)) return null;
    // A sentence that states the rule (must / never / always ...) before one that only reports a failure.
    const strong = sentences.filter((x) => STRONG_RULE_RE.test(x));
    const back = (strong.length ? strong : sentences).slice(0, MAX_RULE_SENTENCES).join(' ');
    if (back.length > MAX_RULE_CHARS) return null;
    return { front: `${name} (${kind.toLowerCase()})`, back, category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: name };
  }
  const RULE_BOX_RE = /^(Common\s+Error|Programming\s+Tip|Quality\s+Tip|Common\s+Pitfall|Pitfall|Caution|Warning)\s+\d+(?:\.\d+)*\b/i;
  const RULE_WORD_RE = /\b(?:must|never|always|do\s+not|don['’]t|should|instead|is\s+(?:an?\s+)?error|will\s+fail|fails|no\s+compiler\s+error|good\s+idea|avoid|common\s+error)\b/i;
  // Sentences about the working environment, not the subject being taught.
  const TOOLING_RE = /\b(?:editors?|IDEs?|keyboard|tab\s+key|space\s+bar|cursor|mouse|menu|toolbar|shortcut|printer|screen|scrolling|tabs?)\b/i;
  const TITLE_SMALL_WORD_RE = /^(?:a|an|the|and|or|of|to|in|for|on|at|by|with|into|from|vs\.?)$/;
  const STRONG_RULE_RE = /\b(?:must|never|always|do\s+not|don['’]t|should|avoid|common\s+error|good\s+idea)\b/i;
  const INLINE_CODE_RE = /\b[A-Za-z_]\w*(?:\[[^\]]*\])+\s*\$?\s*=\s*[^;]*;\s*(?:\/\/\$?)?/g;
  const MAX_RULE_SENTENCES = 2;
  const MAX_RULE_CHARS = 360;

  /**
   * A syntax box drawn as code with callout labels around it ("These quantities are compared. `floor > 13` Check
   * that you have ..."): read as one line, the labels and the code interleave and the card cannot be studied.
   */
  function isCalloutDiagram(text) {
    if (!/`/.test(text)) return false;
    const outside = text.replace(/`[^`]*`/g, ' ');
    return (outside.match(/[A-Za-z]{3,}/g) || []).length >= CALLOUT_WORDS;
  }
  const CALLOUT_WORDS = 8;

  /** "Definition 1", "Theorem 2 (De Morgan's Laws)": a box title that is only its number (and a bracketed name). */
  function isBareNumber(title) {
    const m = plain(title).match(BOX_HEAD_RE);
    return Boolean(m) && !m[4].trim();
  }

  function fromBlocks(blocks) {
    const didactic = [];
    const boxes = []; // numbered definition and theorem boxes, as cards named by their term
    const cards = [];
    for (const blk of blocks || []) {
      if (!blk) continue;
      const kind = blk.kind || '';
      const page = blk.pageNumber || blk.page || null;
      // A "Common Error" / "Programming Tip" box states a rule of the subject among its asides: that rule is a card.
      if (kind === 'sidebar' && RULE_BOX_RE.test(plain(blk.title))) {
        const card = ruleBoxCard(blk);
        if (card) cards.push({ ...card, page });
        continue;
      }
      if (SKIPPED_KINDS.has(kind)) continue;
      if (kind === 'key-concept') {
        // A margin note may hold two statements ("X compare values. The == operator tests ..."): each is split on its
        // own, and the first that makes a card is kept.
        const ks = dep('keyStatements', './key-statements.js');
        const notes = dep('tokenizer', './tokenizer.js').splitSentences(textOf(blk));
        const card = (notes.length ? notes : [textOf(blk)]).map((s) => ks.completion(s)).find(Boolean);
        if (card) cards.push({ ...card, category: 'Key Concept', kind: 'concept', sourceKind: 'key-concept', page, subject: plain(blk.title) });
      } else if (kind === 'self-check') {
        cards.push(...selfCheckCards(blk));
      } else if (kind === 'table') {
        cards.push(...dep('tableCards', './table-cards.js').rowCards(blk, { subject: plain(blk.title) }).map((c) => ({ ...c, page })));
      } else if (kind === 'syntax') {
        if (plain(blk.title) && textOf(blk) && !isCalloutDiagram(textOf(blk))) cards.push({ front: `${plain(blk.title)} — syntax`, back: textOf(blk), category: 'Formula', kind: 'formula', sourceKind: 'formula', page });
      } else if (isBareNumber(blk.title)) {
        // "Definition 1" as a title names nothing: the card is the term the box defines, or none.
        const m = plain(blk.title).match(BOX_HEAD_RE);
        const card = boxCard(m[1], m[2], m[3], plain(stemCardsBack(blk)));
        if (card) boxes.push({ ...card, page });
      } else {
        didactic.push(blk);
      }
    }
    return { didactic, boxes, cards };
  }

  /** The body of a numbered box: its own line's rest and following lines up to the end of its statement. */
  function boxBody(lines, i, rest) {
    const body = rest ? [rest] : [];
    let sentences = (rest.match(/[.!?](?=\s|$)/g) || []).length;
    for (let k = i + 1; k < lines.length && k - i <= MAX_BOX_LINES && sentences < MAX_BOX_SENTENCES; k++) {
      const line = String(lines[k]).trim();
      if (!line || BOX_HEAD_RE.test(plain(line)) || /^(?:\*\*)?(?:EXAMPLE|Proof|Solution)\b/i.test(line)) break;
      body.push(line);
      sentences += (line.match(/[.!?](?=\s|$)/g) || []).length;
      if (endsSentence(line) && sentences >= 1 && !/^Let\b/.test(plain(body.join(' ')).split(/(?<=[.!?])\s+/).pop())) break;
    }
    return plain(body.join(' '));
  }

  /** The term a definition box defines: "... The exclusive or of $p$ and $q$, denoted by ..." -> "exclusive or". */
  function definedTerm(body) {
    const statement = body.replace(/^\$?\\text\{Let\}\s*/, 'Let ');
    const mined = dep('definitionMiner', './definition-miner.js').mine(statement, { strong: true })[0] ||
      dep('proseDefinitions', './prose-definitions.js').mine(dep('tokenizer', './tokenizer.js').splitSentences(statement))[0];
    // A notation the miners cannot read past ("The exclusive or of $p$ and $q$, denoted by ...") still names
    // its term in "The <term> of".
    const masked = plain(body.replace(/\$[^$]*\$/g, 'X'));
    const named = masked.match(/(?:^|\.\s+)The\s+([a-z][a-z -]{2,40}?)\s+of\s+X/);
    // The box opens by saying what its term is ("A set is an unordered collection ..., called elements ..."): that
    // subject is the term, not a word the same sentence names on the way.
    const lead = masked.match(/^(?:An?|The)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)\s+(?:is|are)\s+(?:an?|the|any)\s/);
    // "The set X is a subset of X ... if and only if ...": the relation the box defines.
    const relation = masked.match(/\bX\s+is\s+an?\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)\s+of\s+X\b[^.]*\bif\s+and\s+only\s+if\b/);
    const term = ((lead && lead[1]) || (relation && relation[1]) || (mined && mined.term) || (named ? named[1] : '')).trim();
    // "The conditional statement p $\to q$": a variable left behind by the masked notation is no part of the term.
    return term.replace(/(?:\s+[A-Za-z]){1,2}$/, '');
  }

  /**
   * One numbered box as a card: a definition by the term it defines, a theorem by the name in its brackets.
   * -> card | null (an unnamed "Theorem 1", or a definition whose term cannot be read, asks nothing).
   */
  function boxCard(word, number, name, whole) {
    // A box cut off mid-sentence (the next statement ran past the extracted lines) keeps its complete sentences.
    const cut = whole && !endsSentence(whole) ? whole.replace(/(?<=[.!?]["”’)]?\$?)\s+[^.!?]*$/, '') : whole;
    // "... is denoted by $(S)$": the notation's symbol was lost in extraction, so the sentence is left out.
    const body = (cut && cut !== whole && cut.length >= MIN_CUT_BOX_CHARS ? cut : whole)
      .replace(/\s+[^.]*\bdenoted\s+by\s+\$?\([A-Za-z]\)\.?\$?\s*\.?$/, '');
    if (!body || !endsSentence(body)) return null;
    if (/^Definition$/i.test(word)) {
      const term = definedTerm(body);
      if (!term) return null;
      // A term that ends in a function word ("exclusive or") keeps its box number so it reads as a name.
      const front = /\s(?:or|and|of|not)$/i.test(term) ? `${cap(term)} (${word} ${number})` : cap(term);
      return { front, back: body, category: 'Definition', kind: 'definition', sourceKind: 'definition', label: `${word} ${number}`, subject: cap(term) };
    }
    if (!name) return null;
    return { front: cap(plain(name)), back: body, category: 'Theorem', kind: 'theorem', sourceKind: 'key-concept', label: `${word} ${number}` };
  }

  /** The name a numbered box stands for ("Definition 4" -> "Exclusive or"), the title itself when it is no number. */
  function boxName(title, body) {
    const m = plain(title).match(BOX_HEAD_RE);
    if (!m || m[4].trim()) return plain(title); // "Theorem 1.2 — Properties of Limits" names itself
    if (m[3]) return cap(plain(m[3]));
    const card = boxCard(m[1], m[2], '', plain(body));
    return card ? card.subject : '';
  }

  function fromText(text) {
    const lines = String(text || '').split('\n');
    const out = [];
    lines.forEach((line, i) => {
      const m = plain(line).match(BOX_HEAD_RE);
      if (!m) return;
      const [, word, number, name, rest] = m;
      const card = boxCard(word, number, name, boxBody(lines, i, rest || ''));
      if (card) out.push(card);
    });
    return out;
  }

  const api = { fromBlocks, fromText, boxName };
  PDFStudy.boxedCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
