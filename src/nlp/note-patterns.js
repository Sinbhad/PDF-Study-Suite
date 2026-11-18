/**
 * Note Patterns: cards from text written the way students take notes, where the line is the unit and there
 * are no full stops or capitals to lean on (typed notes, handwriting recognition output):
 *   term - definition | term – definition | term: definition | term = definition     -> term card
 *   a = x, b = y, c = z                                                              -> one term card each
 *   A -> B   (also → and =>)                                                         -> cause / effect card
 *   A -> B -> C                                                                      -> sequence card
 *   Heading, then "- item" / "1. item" lines                                         -> list card, plus a
 *                                                                                       "Heading — label" card
 *                                                                                       for every "label: value" item
 *   Heading, then plain fact lines                                                   -> "Heading" key-fact card
 * parseLine(line)        -> null | { type: 'pair', term, definition } | { type: 'pairs', pairs } | { type: 'arrow', parts }
 * looksLikeNotes(text)   -> true when the text is line-shaped notes rather than wrapped prose
 * extractNoteCards(text) -> [{ front, back, category, kind, topic }] in document order
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const quality = () => dep('cardQuality', './card-quality.js');

  const BULLET_RE = /^\s*(?:[-*•▪◦‣–]|\d{1,2}[.)])\s+(?=\S)/;
  const ARROW_SPLIT_RE = /\s*(?:-+>|=+>|→|⇒|➔|➜)\s*/;
  const ARROW_AT_RE = /\s*(?:-+>|=+>|→|⇒|➔|➜)\s*\S/;
  // Labels that only mean something next to their heading ("mnemonic", "exceptions", "eg").
  const GENERIC_LABEL_RE =
    /^(?:mnemonic|note|notes|nb|eg|e\.g\.?|ex|example|examples|exam|tip|hint|remember|exceptions?|uses?|used\s+for|pros|cons|formula|units?|why|how|when|where|result|cause|causes|effect|effects)$/i;
  const VAGUE_HEADING_RE = /^(?:misc|miscellaneous|other|others|general|notes?|extra|random|todo|summary|review)$/i;
  const LIST_HEADING_RE =
    /^(?:types|kinds|stages|phases|steps|layers|levels|parts|components|factors|causes|effects|properties|characteristics|features|rules|advantages|disadvantages|functions|examples)\b/i;
  const MAX_LIST_ITEMS = 7;
  const MAX_EXTRA_LINES = 4;

  const tidy = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const wordCount = (s) => tidy(s).split(/\s+/).filter(Boolean).length;

  function goodTerm(term) {
    const t = tidy(term);
    if (!/^[A-Za-z0-9(]/.test(t) || !/[A-Za-z]/.test(t) || /[<>=]/.test(t)) return false;
    return quality().goodFront(t, { maxWords: 6 });
  }

  function goodDefinition(definition, term) {
    const d = tidy(definition);
    return d.length >= 3 && /[A-Za-z0-9]/.test(d) && quality().goodBack(d, term);
  }

  /** Index of the first separator of each kind; the earliest one decides how the line is read. */
  function firstSeparator(body) {
    const found = [
      { kind: 'colon', at: body.search(/:\s+\S/) }, // "10:30" has no space after the colon and is not a separator
      { kind: 'equals', at: body.search(/\s=\s+\S/) },
      { kind: 'dash', at: body.search(/\s[-–—]\s+\S/) },
      { kind: 'arrow', at: body.search(ARROW_AT_RE) },
    ].filter((f) => f.at >= 1);
    found.sort((a, b) => a.at - b.at);
    return found[0] || null;
  }

  /** "latency = delay, bandwidth = max rate" -> one pair per comma-separated segment, or null. */
  function inlinePairs(body) {
    const segments = body.split(/,\s+/);
    if (segments.length < 2) return null;
    const pairs = segments.map((seg) => seg.match(/^([A-Za-z][\w\s-]{0,30}?)\s+=\s+(\S.*)$/));
    if (!pairs.every(Boolean)) return null;
    return pairs.map((m) => ({ term: tidy(m[1]), definition: tidy(m[2]) }));
  }

  function parseLine(line) {
    const body = tidy(String(line || '').replace(BULLET_RE, ''));
    if (!/^[A-Za-z0-9("“]/.test(body)) return null;
    const sep = firstSeparator(body);
    if (!sep) return null;
    if (sep.kind === 'arrow') {
      const parts = body.split(ARROW_SPLIT_RE).map(tidy).filter(Boolean);
      const usable = parts.length >= 2 && parts.every((p) => wordCount(p) <= 12 && /[A-Za-z]/.test(p));
      return usable ? { type: 'arrow', parts } : null;
    }
    const many = sep.kind === 'equals' ? inlinePairs(body) : null;
    if (many && many.every((p) => goodTerm(p.term))) return { type: 'pairs', pairs: many };
    const term = tidy(body.slice(0, sep.at));
    const definition = tidy(body.slice(sep.at).replace(/^\s*[-–—=:]\s*/, ''));
    if (!goodTerm(term) || !goodDefinition(definition, term)) return null;
    return { type: 'pair', term, definition };
  }

  /** Line-shaped notes: short lines, few full stops, and a fair share of bullets or "term - definition" lines. */
  function looksLikeNotes(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !/^```/.test(l));
    if (lines.length < 4) return false;
    const stopped = lines.filter((l) => /[.!?]["”)]?$/.test(l)).length;
    const lengths = lines.map((l) => l.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const shaped = lines.filter((l) => BULLET_RE.test(l) || parseLine(l)).length;
    return stopped / lines.length <= 0.25 && median <= 70 && shaped / lines.length >= 0.3;
  }

  const isHeadingShape = (body) => wordCount(body) <= 6 && body.length <= 48 && !/[.!?;,]$/.test(body) && /^[A-Za-z0-9("“]/.test(body);
  const headingName = (body) => tidy(body).replace(/:$/, '').trim();

  /**
   * Walks the lines once and groups them: a block heading (first line after a blank line), sub-headings that
   * own the bullet lines under them, pair lines that own the bullets directly under them, and loose fact lines.
   */
  function readStructure(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
    const entries = [];
    let heading = null;
    let owner = null; // the entry that bullet lines attach to
    let block = 0; // blank lines separate blocks; a heading still names later blocks, but owns only its own fact lines
    const first = lines.findIndex((l) => l.trim());
    const titleLine = first >= 0 && !(lines[first + 1] || '').trim() ? first : -1; // a title standing alone

    lines.forEach((raw, i) => {
      const body = tidy(raw.replace(BULLET_RE, ''));
      const blankBefore = i === 0 || !lines[i - 1].trim();
      const next = lines[i + 1] || '';
      if (!body) {
        owner = null;
        block += 1;
        return;
      }
      if (i === titleLine) return;
      const topic = heading ? heading.name : '';
      const parsed = parseLine(body);

      if (BULLET_RE.test(raw)) {
        if (!owner && heading && heading.line === i - 1) owner = heading;
        if (owner) owner.items.push(body);
        if (parsed && parsed.type === 'pair' && owner && owner.kind !== 'pair') {
          entries.push({ kind: 'labelled', owner: owner.name, ...parsed, topic });
        } else if (parsed && parsed.type === 'arrow') {
          entries.push({ kind: 'arrow', parts: parsed.parts, topic, context: owner ? owner.name : topic });
        } else if (parsed && parsed.type === 'pair' && !owner) {
          entries.push({ kind: 'pair', ...parsed, items: [], topic });
        }
        return;
      }

      if (parsed && parsed.type === 'pairs') {
        parsed.pairs.forEach((p) => entries.push({ kind: 'pair', ...p, items: [], topic }));
        owner = null;
      } else if (parsed && parsed.type === 'pair') {
        const generic = GENERIC_LABEL_RE.test(parsed.term) && topic;
        const entry = generic
          ? { kind: 'labelled', owner: topic, ...parsed, topic }
          : { kind: 'pair', name: parsed.term, line: i, ...parsed, items: [], topic };
        entries.push(entry);
        owner = generic ? null : entry;
      } else if (parsed && parsed.type === 'arrow') {
        // A chain directly under "Encapsulation: ..." spells that term out; a single arrow is a fact of the heading.
        const chained = parsed.parts.length >= 3 && owner && owner.kind === 'pair' && owner.line === i - 1;
        entries.push({ kind: 'arrow', parts: parsed.parts, topic, context: chained ? owner.name : topic });
      } else if (isHeadingShape(body) && (BULLET_RE.test(next) || (blankBefore && next.trim()))) {
        const label = /:$/.test(body) && topic && !blankBefore;
        const name = label ? `${topic} — ${headingName(body)}` : headingName(body);
        const entry = { kind: 'heading', name, line: i, block, items: [], facts: [], topic: label ? topic : name };
        entries.push(entry);
        if (!label && (blankBefore || !heading)) heading = entry;
        owner = BULLET_RE.test(next) ? entry : null;
      } else if (heading && heading.block === block && /^[A-Za-z0-9("“]/.test(body)) {
        heading.facts.push(body); // "!! exam: ..." and other marked asides are not facts of the heading
        owner = null;
      }
    });
    return entries;
  }

  const bulletList = (items) => items.map((x) => `• ${x}`).join('\n');
  const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

  function arrowCard(entry) {
    const { parts } = entry;
    const lead = entry.context && !VAGUE_HEADING_RE.test(entry.context) ? `${entry.context}: ` : '';
    if (parts.length >= 3) {
      return { front: `${lead}${parts[0]} → ?`, back: parts.join(' → '), category: 'Sequence', kind: 'concept' };
    }
    return { front: `${lead}${parts[0]} → ?`, back: parts[1], category: 'Cause and Effect', kind: 'concept' };
  }

  function headingCards(entry, pairKeys) {
    const out = [];
    const items = entry.items;
    if (items.length >= 2 && items.length <= MAX_LIST_ITEMS) {
      const front = LIST_HEADING_RE.test(entry.name) ? `What are the ${items.length} ${lowerFirst(entry.name)}?` : entry.name;
      out.push({ front, back: bulletList(items), category: 'List', kind: 'overview' });
    } else if (items.length === 1 && wordCount(items[0]) >= 3) {
      out.push({ front: entry.name, back: items[0], category: 'Key Fact', kind: 'concept' });
    }
    const facts = entry.facts.slice(0, MAX_EXTRA_LINES);
    if (facts.length) {
      const taken = out.length || pairKeys.has(quality().frontKey(entry.name));
      const front = taken ? `${entry.name} — key facts` : entry.name;
      out.push({ front, back: facts.length === 1 ? facts[0] : bulletList(facts), category: 'Key Fact', kind: 'concept' });
    }
    return out;
  }

  function extractNoteCards(text) {
    const entries = readStructure(text);
    const pairKeys = new Set(entries.filter((e) => e.kind === 'pair').map((e) => quality().frontKey(e.term)));
    const cards = [];
    for (const entry of entries) {
      const made = [];
      if (entry.kind === 'pair') {
        const extra = entry.items.slice(0, MAX_EXTRA_LINES);
        const back = extra.length ? `${entry.definition}\n${bulletList(extra)}` : entry.definition;
        made.push({ front: entry.term, back, category: 'Key Term', kind: 'definition' });
      } else if (entry.kind === 'labelled') {
        made.push({ front: `${entry.owner} — ${entry.term}`, back: entry.definition, category: 'Key Fact', kind: 'concept' });
      } else if (entry.kind === 'arrow') {
        made.push(arrowCard(entry));
      } else if (entry.kind === 'heading') {
        made.push(...headingCards(entry, pairKeys));
      }
      for (const card of made) {
        if (quality().goodBack(card.back, card.front)) cards.push(quality().withTopic(card, entry.topic || entry.name || ''));
      }
    }
    return quality().dedupe(cards);
  }

  const api = { parseLine, looksLikeNotes, extractNoteCards, isBullet: (line) => BULLET_RE.test(line) };
  PDFStudy.notePatterns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
