/**
 * Quiz Content Gate: decides which slides, lines and flashcards may become quiz material at all.
 * A question must test what the scope teaches, never the furniture around it: title, objective, case and
 * contact slides; patient signalment; URLs and figure captions; quips and asides ("Take a deep breath");
 * biography sidebars; praise or meta sentences ("... is the heart of the design process", "In this chapter
 * we ..."); the incidental content of an Example block; and recognition debris.
 *
 * What a slide, a line or a card IS (title, case, caption, signalment, link, annotation ...) is decided by the
 * shared PDFStudy.contentFilter (content-filter.js, slide-kinds.js), the one definition the cards and the
 * summary use too. This module adds only the quiz's own stricter rules on top: organising slides a quiz
 * should not draw facts from (outline, summary, take-home), praise and scene-setting sentences, asides to
 * the audience, inline citations, code identifiers and headings glued onto sentences.
 *
 *   slideIsContent(slide)          content slide that may supply facts
 *   lineIsContent(text, ctx)       one bullet or sentence that may supply a fact; ctx: { slide?, block? }
 *   cardIsContent(card)            a flashcard that may supply a fact
 *   isFillerText(text)             no study content by the shared filter or the quiz rules (also used on option text)
 *   isGarbled(text, wordCounts)    a token that is not word-shaped and that the scope never uses again
 *   isInkLine(bullet, slide)       a bullet set in an off-grid size: a recognised pen annotation, not slide text
 *   incidentalLines(text)          lines of book text inside an Example block, a sample list or a biography sidebar
 *   exampleTester(text)            (sentence) => true when the sentence sits in one of those lines
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const sn = () => dep('stemNoise', './stem-noise.js');

  const filter = () => dep('contentFilter', './content-filter.js');

  // Slides that organise a lecture rather than teach it: they announce or restate other slides, so a quiz takes
  // no facts from them. (Objectives, references, contact, closing and case slides are the shared filter's kinds.)
  const ADMIN_TITLE_RE =
    /^(?:(?:learning|course|lecture|session|today'?s?)\s+)?(?:objectives?|outcomes?|goals?|outline|agenda|overview|introduction|summary|review|recap|questions?|references?|resources|readings?|acknowledge?ments?|announcements?|housekeeping|thank\s+you|take[- ]home(?:\s+\w+)*|key\s+points|conclusions?|history|signalment|contact|office\s+hours|disclaimer|learning\s+objective\s+\d+)\b/i;
  // Case material one line still shows outside a case slide: breed shorthand, a presenting complaint.
  const PATIENT_LINE_RE = /\b(?:DSH|DLH|DMH)\b|\bpresent(?:ed|s)\s+(?:with|for)\b/;
  // Quips and asides: imperatives aimed at the audience, exclamations, a word repeated as a hint.
  const QUIP_RE =
    /^(?:remember\b|don'?t\s+(?:forget|panic|worry|memori[sz]e)|do\s+not\s+memori[sz]e|relax|good\s+luck|stay\s+tuned|warning\b|hint\b|fun\s+fact|pop\s+quiz|(?:any\s+)?questions\??$|thank|think\b|look\s+for\b|consider\b|note\b)|\btake\s+a\s+(?:deep\s+)?breath\b|\bsoapbox\b|!\s*$|(\b\w+\b)[.…!]+\s*\1\b/i;
  // Praise, scene-setting and sentences about the book or course rather than the subject.
  const META_RE =
    /\b(?:the\s+heart\s+of|is\s+(?:an?\s+)?(?:very|extremely|really)?\s*(?:important|useful|helpful|essential|interesting|powerful|convenient)\b|we\s+(?:then|now|first|next|also)?\s*(?:present|introduce|discuss|study|describe|consider|review|begin|turn\s+to)\b|(?:in|later\s+in|throughout)\s+this\s+(?:chapter|section|book|course|text|lecture)|we\s+(?:will|shall|now|have\s+(?:seen|introduced|learned))\b|as\s+the\s+reader\s+(?:can|will)|the\s+reader\b|this\s+book\b|you\s+(?:will|should|can|must|need)\b|let\s+us\b|let'?s\b|a\s+much\s+better\s+choice|in\s+my\s+(?:experience|opinion|practice)|\bI\s+(?:think|believe|prefer|recommend|like)\b|is\s+a\s+good\s+(?:idea|choice|practice))/i;
  // A citation inside a line: the line is a reference, or carries one the student is not asked about.
  const CITATION_RE = /\bet\s+al\.|\(\s*[A-Z][A-Za-z]+(?:\s+(?:et\s+al\.|and\s+[A-Z][A-Za-z]+))?,?\s+(?:19|20)\d\d\s*\)|\b(?:19|20)\d\d\)\s*$/;
  // Code and the names of an example's own tables and variables: OrderNumber, SKU_DATA, getValue(), "text";
  const CODE_RE = /^["'`].*["'`];$|;\s*$|==|\{\s*$|^\s*\}|\b[A-Z]+_[A-Z][A-Z_]*\b|\b[A-Z][a-z]{2,}(?:[A-Z][a-z]+)+\b|\b[a-z]{2,}(?:[A-Z][a-z]{2,})+\b|\w\(\)/;
  // A heading glued onto the sentence it heads: "Foreign Keys A foreign key is ...".
  const GLUED_HEADING_RE = /^((?:[A-Z][a-z]+\s+){1,4})(?:A|An|The)\s+([a-z]+)/;
  // A run of title-case words (or a symbol) and then a new sentence: "D Latch One way to ...",
  // "Positive-Edge-Triggered D Flip-Flop When the positive edge occurs ...".
  const TITLE_RUN_RE = /^(?:(?:[A-Z][\w’'-]*|X)\s+){2,}(?:When|One|The|A|An|In|If|For|To|This|Each|Some)\s+[a-z]/;
  // An Example block in book text runs from its heading to a blank line, the next block heading or its end mark.
  const EXAMPLE_HEADING_RE = /^\**\s*(?:EXAMPLE|Example)\s+\d/;
  const BLOCK_HEADING_RE = /^\**\s*(?:EXAMPLE|Example|DEFINITION|Definition|THEOREM|Theorem)\s+\d/;

  // Word-shaped tokens: a word, a hyphenated or apostrophised word, an acronym, a number, a unit.
  const WORD_SHAPED_RE = /^(?:[A-Za-z]+(?:[-'’][A-Za-z]+)*|[A-Z0-9]{1,6}s?|\d+(?:[.,]\d+)*%?|[A-Za-z]\d{0,2}|\d+[a-z]{1,3}|[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+|[A-Za-z]+_\{?[A-Za-z0-9]+\}?)$/;
  const EDGE_PUNCT_RE = /^[("“'‘[{]+|[)"”'’\]}.,;:!?]+$/g;
  const MAX_INK_SIZE_GAP = 0.15; // a typed size is a whole or half point; recognised ink lands anywhere

  /** Text that is never quiz material: anything the shared filter does not call content, then the quiz's own rules. */
  function isFillerText(text) {
    const s = String(text || '').replace(/\*\*|__/g, '').trim();
    if (!s) return true;
    if (filter().lineKind(s) !== 'content') return true;
    if (PATIENT_LINE_RE.test(s) || QUIP_RE.test(s) || META_RE.test(s)) return true;
    const prose = s.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' X ').replace(/\s+/g, ' ').trim();
    if (CITATION_RE.test(prose) || CODE_RE.test(prose) || isGluedHeading(prose)) return true;
    const noise = sn();
    return Boolean(noise && noise.isBiographical(s));
  }

  /** "Foreign Keys A foreign key is ...": the leading words come back, lower-cased, right after the article. */
  function isGluedHeading(s) {
    if (TITLE_RUN_RE.test(s)) return true;
    const m = s.match(GLUED_HEADING_RE);
    if (!m) return false;
    const lead = m[1].trim().toLowerCase().split(/\s+/);
    return lead.some((w) => w.replace(/s$/, '') === m[2].replace(/s$/, ''));
  }

  /** A slide a quiz may take facts from: the shared filter calls it content and it is no organising slide. */
  function slideIsContent(slide) {
    if (!slide) return false;
    // The extraction's own kind ('table', 'section') says how a slide is laid out, not whether it teaches.
    if (filter().slideKind(slide) !== 'content') return false;
    return !ADMIN_TITLE_RE.test(String(slide.title || '').trim());
  }

  /** ctx: { slide?, block? } as the shared filter's lineKind context. */
  function lineIsContent(text, ctx) {
    if (filter().lineKind(text, ctx || {}) !== 'content') return false;
    return !isFillerText(text);
  }

  /** Card kinds that carry no fact of their own: a reminder, a case prompt, a worked example. */
  const NON_FACT_SOURCE_KINDS = new Set(['note']);

  function cardIsContent(card) {
    if (!card) return false;
    if (card.sourceKind && NON_FACT_SOURCE_KINDS.has(card.sourceKind)) return false;
    if (/^(?:Worked Example|Slide Overview)$/.test(card.category || '')) return false;
    return !isFillerText(card.front) && !isFillerText(card.back) && !ADMIN_TITLE_RE.test(String(card.topic || '').trim());
  }

  /** Word -> how often the scope prints it (whitespace tokens, as printed). */
  function wordCounts(text) {
    const counts = new Map();
    for (const w of String(text || '').match(/\S+/g) || []) {
      const t = w.replace(EDGE_PUNCT_RE, '').replace(EDGE_PUNCT_RE, '');
      if (t) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return counts;
  }

  /** True when the text holds a token that is not word-shaped and that the scope prints only once. */
  function isGarbled(text, counts) {
    const plain = String(text || '').replace(/\$[^$]*\$/g, ' ').replace(/[®™©…]/g, ' ').replace(/[—–]/g, ' ');
    for (const raw of plain.match(/\S+/g) || []) {
      const tok = raw.replace(EDGE_PUNCT_RE, '').replace(EDGE_PUNCT_RE, '').replace(/-$/, '');
      if (!tok || tok.length < 3 || !/[A-Za-z]/.test(tok) || WORD_SHAPED_RE.test(tok)) continue;
      if (!counts || (counts.get(tok) || 0) <= 1) return true;
    }
    return false;
  }

  /**
   * A bullet in a type size nobody chose: typed slide text is set in whole or half points shared with
   * other lines, while a pen annotation turned into text by a recogniser lands on an arbitrary size of
   * its own ("a lot into" at 12.4pt among 24pt bullets). Only judged when the extraction kept sizes.
   */
  function isInkLine(bullet, slide) {
    const size = bullet && Number(bullet.fontSize);
    if (!Number.isFinite(size) || !slide || !Array.isArray(slide.nestedBullets)) return false;
    const offGrid = Math.abs(size * 2 - Math.round(size * 2)) > MAX_INK_SIZE_GAP;
    const shared = slide.nestedBullets.filter((b) => b !== bullet && Math.abs(Number(b.fontSize) - size) < 0.05).length;
    return offGrid && shared === 0;
  }

  // Where an example's lines start, looking back from its end marker ("◂" closes an example in many books).
  const EXAMPLE_START_RE = /^\**\s*(?:EXAMPLE|Example)\b|\bthe\s+following\b|^Consider\b|^Solution\b/;
  const EXAMPLE_END_MARK_RE = /[◂◀▪■□]\s*$/;
  const MAX_EXAMPLE_LOOKBACK = 12;
  const FALLBACK_EXAMPLE_LINES = 4;
  const NUMBERED_ITEM_RE = /^\$*\s*\d{1,2}\.\s/;
  const LIST_INTRO_RE = /\bthe\s+following\b.*[.:]\s*$/i;
  // A biography sidebar opens with the person's name in capitals and their years.
  const BIO_HEAD_RE = /^([A-Z][A-Z'’.-]+(?:\s+[A-Z][A-Z'’.-]+){0,3})\s*\(\s*(?:c\.\s*)?\d{3,4}/;
  const BIO_WINDOW_LINES = 30;
  const PERSONAL_RE = /\b(?:he|his|him|she|her|hers)\b/i;

  /**
   * Lines of book text that are incidental, not study content: an Example block (from its heading, or
   * back from its end marker), a numbered list of sample items introduced by "the following", and a
   * biography sidebar (from its NAME (years) heading, the lines that name the person or say he/she).
   */
  function incidentalLines(text) {
    const lines = String(text || '').split('\n');
    const marked = new Set();
    const markRange = (a, b) => {
      for (let i = Math.max(0, a); i <= Math.min(lines.length - 1, b); i++) marked.add(i);
    };
    lines.forEach((line, i) => {
      const l = line.trim();
      if (EXAMPLE_HEADING_RE.test(l)) {
        let end = i;
        while (end + 1 < lines.length && end - i < MAX_EXAMPLE_LOOKBACK * 2 && lines[end + 1].trim() &&
          !BLOCK_HEADING_RE.test(lines[end + 1].trim())) {
          end++;
          if (EXAMPLE_END_MARK_RE.test(lines[end])) break;
        }
        markRange(i, end);
      }
      if (EXAMPLE_END_MARK_RE.test(l)) {
        let start = i - FALLBACK_EXAMPLE_LINES;
        for (let k = i; k >= Math.max(0, i - MAX_EXAMPLE_LOOKBACK); k--) {
          if (EXAMPLE_START_RE.test(lines[k].trim())) {
            start = k;
            break;
          }
        }
        markRange(start, i);
      }
      if (LIST_INTRO_RE.test(l)) {
        let end = i;
        while (end + 1 < lines.length && NUMBERED_ITEM_RE.test(lines[end + 1].trim())) end++;
        if (end > i) markRange(i + 1, end);
      }
      const bio = l.match(BIO_HEAD_RE);
      if (bio) {
        const surname = bio[1].split(/\s+/).pop();
        const name = surname[0] + surname.slice(1).toLowerCase();
        marked.add(i);
        for (let k = i + 1; k < Math.min(lines.length, i + BIO_WINDOW_LINES); k++) {
          if (lines[k].includes(name) || PERSONAL_RE.test(lines[k])) marked.add(k);
        }
      }
    });
    return [...marked].sort((a, b) => a - b).map((i) => lines[i]);
  }

  const flat = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const PROBE_CHARS = 32;

  /** -> (sentence) => true when the sentence starts or ends inside an incidental part of `text`. */
  function exampleTester(text) {
    const incidental = flat(incidentalLines(text).join(' '));
    if (!incidental) return () => false;
    return (sentence) => {
      const s = flat(sentence);
      if (s.length < 12) return false;
      return incidental.includes(s.slice(0, PROBE_CHARS)) || incidental.includes(s.slice(-PROBE_CHARS));
    };
  }

  const api = {
    slideIsContent, lineIsContent, cardIsContent, isFillerText, isGarbled, wordCounts, isInkLine, exampleTester, incidentalLines,
    ADMIN_TITLE_RE,
  };
  PDFStudy.quizContent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
