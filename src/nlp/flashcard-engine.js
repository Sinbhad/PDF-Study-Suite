/**
 * Deterministic Rule-Based Flashcard Generator (Slides & STEM/Academic Textbooks)
 * Extracts Boxed Definitions, Named Theorems, Guidelines, Bold Key Terms, and Syntactic Definitions.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function getDeps() {
    const tokenizer =
      PDFStudy.tokenizer || (typeof require === 'function' ? require('./tokenizer.js') : null);
    const boldTerms =
      PDFStudy.boldTerms || (typeof require === 'function' ? require('./bold-terms.js') : null);
    const noiseFilter =
      PDFStudy.noiseFilter || (typeof require === 'function' ? require('./noise-filter.js') : null);
    return { tokenizer, boldTerms, noiseFilter };
  }

  const DEFINITION_RULES = [
    {
      type: 'glossary',
      regex:
        /^(?:\*\*|__)?(?<term>[A-Z][A-Za-z0-9\s\-\/]{1,42}?)(?:\*\*|__)?\s*(?:\((?<acronym>[A-Z0-9\-]{1,10})\))?\s*(?::|—|–|\s-\s)\s*(?<def>[A-Za-z0-9][^.!?\n]{12,260}[.!?]?)$/,
    },
    {
      type: 'copula',
      regex:
        /^(?:The\s+|A\s+|An\s+)?(?:\*\*|__)?(?<term>[A-Z][A-Za-z0-9\s\-]{2,40}?)(?:\*\*|__)?\s+(?:\((?<acronym>[A-Z0-9\-]{2,10})\)\s+)?(?:is\s+defined\s+as|can\s+be\s+defined\s+as|refers\s+to|denotes|is\s+known\s+as|(?:is|are)\s+(?:a|an)\s+(?:type|kind|form|class|variety|branch)\s+of|is\s+(?:a|an|the)\s+(?:process|method|technique|mechanism|system|measure|phenomenon|structure|condition|state|ability|study|rate|ratio|principle|theory|law|rule|property|theorem|limit|derivative|integral|function)\s+(?:by\s+which|where|in\s+which|that|of|for))\s+(?<def>[^.!?\n]{10,250}[.!?]?)$/i,
    },
    {
      type: 'reverse_def',
      regex:
        /^(?<def>[A-Z][^.!?\n]{15,210}?)\s+(?:is|are)\s+(?:called|known\s+as|referred\s+to\s+as|termed)\s+(?:the\s+|a\s+|an\s+)?(?:\*\*|__)?(?<term>[A-Za-z0-9\s\-]{2,38}?)(?:\*\*|__)?[.!?]?$/,
    },
    {
      type: 'appositive',
      regex:
        /^(?:The\s+|A\s+|An\s+)?(?:\*\*|__)?(?<term>[A-Z][A-Za-z0-9\s\-]{2,34}?)(?:\*\*|__)?,\s+(?<def>(?:a|an|the)\s+[^,\n]{14,150}),\s+(?:is|are|was|were|plays|provides|allows|functions|serves|acts|consists|controls|regulates)\b/,
    },
  ];

  // Boilerplate/exercise noise comes from shared noise-filter.js; "second degree" ordinals are local.
  const DEGREE_TERM_RE = /\b(?:zeroth|first|second|third|fourth|nth)\s+degree\b/i;

  const nf = () => getDeps().noiseFilter;
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const stemCards = () => dep('stemCards', './stem-cards.js');
  const mathText = () => dep('mathText', './math-text.js');
  const isNoise = (t) => Boolean(nf() && nf().isNoise(t)) || DEGREE_TERM_RE.test(t);
  const isTermNoise = (t) => isNoise(t) || Boolean(nf() && nf().isTermNoise(t));
  // Standalone sentences (not didactic bodies) must not dangle ("This means..."), be fragments or questions.
  const isBadSentence = (t) => isNoise(t) || dep('stemNoise', './stem-noise.js').isUnusableSentence(t);

  function isValidTerm(term, invalidStarts, maxWords = 9) {
    if (!term) return false;
    const clean = term.replace(/[*_]/g, '').trim();
    const words = clean.split(/\s+/);
    if (words.length < 1 || words.length > maxWords) return false;
    if (clean.length < 3 || clean.length > maxWords * 9) return false;
    if (invalidStarts.has(words[0].toLowerCase())) return false;
    if (isTermNoise(clean) || /^\d+$/.test(clean)) return false;
    return true;
  }

  function extractBookFlashcards(text, contextLabel = 'Book Section', didacticBlocks = []) {
    if (dep('stemNoise', './stem-noise.js').isAnswerKeySection(text)) return [];
    const { tokenizer, boldTerms } = getDeps();
    const { INVALID_TERM_STARTS, cleanMarkdown, splitSentences } = tokenizer;
    const cards = [];
    const seen = new Set();

    // A card exists only when the text defines or states something: no keyword-frequency filler cards.
    function addCard(front, back, category, pageNumber, boxed) {
      let fClean = cleanMarkdown(front).replace(/^(the|a|an)\s+/i, '').trim();
      if (/^[a-z]{2}/.test(fClean)) fClean = fClean[0].toUpperCase() + fClean.slice(1); // "infinite limit" -> "Infinite limit"
      const didactic = /^(?:Theorem|Definition|Guideline|Rule|Law|Corollary|Lemma|Algorithm|Formula|Summary)$/.test(category);
      const lines = String(back || '').split('\n').map((l) => cleanMarkdown(l)).filter(Boolean).join('\n'); // list backs keep their lines
      let bClean = mathText().safeSlice(lines, didactic ? 950 : 460);
      if (/^[a-z]/.test(bClean)) bClean = bClean[0].toUpperCase() + bClean.slice(1);
      if (!mathText().isBalanced(bClean) || dep('stemNoise', './stem-noise.js').isFragment(bClean)) return false;
      if (!isValidTerm(fClean, INVALID_TERM_STARTS, didactic ? 14 : 9)) return false;
      const realWords = bClean.match(/\b[A-Za-z]{3,}\b/g) || [];
      const formula = /^(?:Formula|Algorithm)$/.test(category) && mathText().hasMath(bClean);
      const minWords = formula ? 0 : didactic && boxed ? 1 : 5;
      if (realWords.length < minWords || bClean.length < (boxed || formula ? 6 : 24) || isNoise(boxed ? bClean.replace(/^\d{1,2}\.\s+/gm, '') : bClean)) return false; // a boxed "1. $...$" item is not an exercise
      // "Theorem 1.2 — ..." == "Theorem 1.2: ..."; "Step functions" == "step function"; "Gibbs Free Energy (G)" == "Gibbs Free Energy"
      const thm = fClean.match(/^theorem\s+[A-Z0-9]+\.\d+/i);
      const key = thm ? thm[0].toLowerCase() : boldTerms ? boldTerms.termKey(fClean) : fClean.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      const card = {
        id: `fc-${cards.length + 1}`,
        front: fClean,
        back: bClean,
        context: pageNumber ? `${contextLabel} (p. ${pageNumber})` : contextLabel,
        pageNumber: pageNumber || null,
        category,
        kind: stemCards().kindOf(category),
      };
      cards.push(card);
      return true;
    }

    // 1. First-Class STEM Didactic Blocks (Definitions, Theorems, Rules, Algorithms...): boxed text is trusted as-is
    for (const blk of didacticBlocks || []) {
      addCard(blk.title, stemCards().didacticBack(blk), blk.category, blk.pageNumber, true);
    }
    // 1b. Named theorems/rules, core formulas, complexities & recurrences stated in running text
    for (const sc of stemCards().extractStemCards(text, splitSentences)) addCard(sc.front, sc.back, sc.category);

    const lines = (text || '').split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 6);

    // 2. Multi-line Heading Scanner for plain-text inputs ("Definition of X" / "THEOREM X.Y")
    for (let i = 0; i < lines.length - 1; i++) {
      const plainLine = cleanMarkdown(lines[i]);
      const defHead = plainLine.match(/^(Definitions?\s+of\s+[A-Z][A-Za-z0-9\s,\-()\/]{2,60})$/);
      const thmHead = plainLine.match(/^THEOREM\s+([A-Z0-9]+\.\d+)\s*([A-Za-z0-9\s,\-()'\/]{0,55})$/i);
      if (defHead || thmHead) {
        const sub = thmHead && thmHead[2].trim();
        const title = defHead ? defHead[1].trim() : sub ? `Theorem ${thmHead[1]} — ${sub}` : `Theorem ${thmHead[1]}`;
        const bodyLines = [];
        for (let k = i + 1; k < Math.min(lines.length, i + 25); k++) {
          const nextPlain = cleanMarkdown(lines[k]);
          if (/^(?:THEOREM\s+|Definitions?\s+of\b|EXAMPLE\s+\d+|Proof\b|REMARK\b|Solution\b)/i.test(nextPlain)) break;
          if (tokenizer.isHeadingLine(lines[k])) break;
          bodyLines.push(nextPlain);
        }
        if (bodyLines.length > 0) addCard(title, bodyLines.join(' '), defHead ? 'Definition' : 'Theorem');
      }
    }

    const sentences = splitSentences(text);
    // Full sentences first (wrapped lines rejoined), then only lines that aren't a mid-sentence wrap
    const candidates = [...sentences, ...tokenizer.selfContainedLines(lines).filter((l) => l.length >= 20)];

    for (const item of candidates) {
      if (isBadSentence(item)) continue;

      // 3. Bold inline lead-in term ("**Mitosis** is the process...")
      const boldMatch = item.match(
        /^(?:The\s+|A\s+|An\s+)?\*\*([A-Za-z0-9\s\-]{2,42})\*\*\s*(?::|—|–|-|\s+(?:is|are|refers\s+to|means|describes|consists\s+of|represents|states\s+that))\s*(.{15,420})$/i
      );
      if (boldMatch && addCard(boldMatch[1], boldMatch[2].replace(/^(?:defined|known)\s+as\s+/i, ''), 'Key Term')) {
        continue;
      }

      // 4. Syntactic & Punctuation Definition Rules
      const cleanItem = cleanMarkdown(item);
      for (const rule of DEFINITION_RULES) {
        const m = cleanItem.match(rule.regex);
        if (m && m.groups) {
          const term = m.groups.term.trim();
          const acro = m.groups.acronym ? ` (${m.groups.acronym.trim()})` : '';
          let def = (m.groups.def || '').trim();
          // "...converted to the Fahrenheit This gas is called a Bose-Einstein scale": the def is a glued fragment
          if (rule.type === 'reverse_def' && /\b(?:This|These|That|Those|Such|It|They)(?:\s+\w+)?$/.test(def)) continue;
          // "Power: lim [f(x)]^n = L^n" is a formula label inside a theorem, not a glossary entry
          if (rule.type === 'glossary' && /[=→∞≠<>√]|^(?:lim|sin|cos|tan|log|ln)\b/.test(def.slice(0, 30))) continue;
          if (rule.type === 'copula') {
            const idx = cleanItem.indexOf(term);
            if (idx !== -1) {
              def = cleanItem
                .slice(idx + term.length)
                .replace(/^\s*\([^)]+\)\s*/, '')
                .replace(/^\s*(?:is\s+defined\s+as|can\s+be\s+defined\s+as|refers\s+to|denotes|is|are)\s+/i, '')
                .trim();
            }
          }
          if (addCard(`${term}${acro}`, def, 'Key Term')) break;
        }
      }
    }

    // 4b. Explicit "X is called a T" / "T is defined as" statements the rules above missed
    for (const d of dep('definitionMiner', './definition-miner.js').mineText(text, splitSentences)) {
      if (!isBadSentence(d.definition)) addCard(d.term, d.definition, 'Key Term');
    }

    // 5. Inline bold key terms ("... a different type of limit called a **one-sided limit**.")
    if (boldTerms) {
      const found = boldTerms.extractBoldTermCards(text, {
        tokenizer,
        isNoise,
        isValidTerm: (t) => isValidTerm(t, INVALID_TERM_STARTS),
      });
      for (const bt of found) addCard(bt.term, bt.back, 'Key Term');
    }

    return cards;
  }

  // Slide decks + Anki export live in slide-cards.js (re-exported here for existing callers).
  const slideCards = () => PDFStudy.slideCards || (typeof require === 'function' ? require('./slide-cards.js') : null);
  function extractSlideFlashcards(slides) {
    const { INVALID_TERM_STARTS } = getDeps().tokenizer;
    return slideCards().extractSlideFlashcards(slides, { isNoise, isValidTerm: (t) => isValidTerm(t, INVALID_TERM_STARTS) });
  }
  const exportAnkiTsv = (cards) => slideCards().exportAnkiTsv(cards);

  PDFStudy.flashcardEngine = { extractBookFlashcards, extractSlideFlashcards, exportAnkiTsv };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.flashcardEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
