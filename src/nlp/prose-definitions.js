/**
 * Prose Definitions: the terms running text introduces, each with the clause that defines it (not the whole
 * sentence when a clause can be cut out).
 *   copula + genus        "A market is any arrangement that ..."            -> "Any arrangement that ..."
 *   defining verb         "X refers to / occurs when / consists of / states that ..."
 *   naming                "... is called X", "an enzyme called X", "known as the X", "named this mechanism X"
 *   synonym               "the citric acid cycle, which is also known as the Krebs cycle"
 *   apposition            "the Bastille, a royal fortress and prison", "adenosine triphosphate (ATP), the molecule ..."
 *   reverse apposition    "A new assembly, the National Convention, proclaimed ..."
 *   relative clause       "a deadweight loss, which is the value of ...", "the Third Estate, who represented ..."
 *   predicate             "Two goods are substitutes if ..."
 *   notation              "The negation of p, denoted by ¬p, is the statement ..."
 * Bold terms (**term**, as the PDF loader marks emphasis) are trusted more: the sentence that introduces one
 * becomes its card even without a defining verb, and a term is never read past the bold run.
 * mine(sentences, { isNoise }) -> [{ term, back, strength, sentence }] best reading per term, in text order.
 *   strength 3 = a cut-out defining clause, 2 = a naming sentence, 1 = the sentence that introduces a bold term.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const quality = () => dep('cardQuality', './card-quality.js');
  const abbreviations = () => dep('abbreviations', './abbreviations.js');
  const stemNoise = () => dep('stemNoise', './stem-noise.js');

  const WORD = "[A-Za-z0-9][\\w'’+-]*";
  const TERM = `${WORD}(?:\\s+${WORD}){0,4}?`;
  const ABBR = '(?:\\s+\\([A-Za-z][A-Za-z0-9-]{0,9}\\))?'; // "(PCB)", and a one-letter symbol: "Gibbs Free Energy (G)"
  const PROPER = "[A-Z][\\w'’-]+(?:\\s+(?:of\\s+(?:the\\s+)?|the\\s+|and\\s+of\\s+the\\s+)?[A-Z][\\w'’-]+){0,6}";
  const ARTICLE_NP = '(?:an?|the)\\s+[a-z][^,;.]{6,160}';
  const MAX_SENTENCE_BACK = 320;

  const LEAD_COPULA_RE = new RegExp(`^(?:(?:A|An|The)\\s+)?(${TERM})${ABBR}\\s+(?:is|are)\\s+((?:an?|the|any|one\\s+of)\\s+.+)$`);
  const LEAD_VERB_RE = new RegExp(
    `^(?:(?:A|An|The)\\s+)?(${TERM})${ABBR}\\s+(refers?\\s+to|(?:is|are|can\\s+be)\\s+defined\\s+as|means|denotes|states\\s+that,?|` +
    'occurs?\\s+when|happens\\s+when|exists?\\s+when|consists?\\s+of|is\\s+composed\\s+of|is\\s+made\\s+up\\s+of|(?:is|are)\\s+used\\s+(?:to|for)|describes|involves)\\s+(.+)$');
  const DROPPED_VERB_RE = /^(?:refers?\s+to|(?:is|are|can\s+be)\s+defined\s+as|means|denotes|states\s+that,?)$/;
  const BOLD_ONLY_VERB_RE = /^(?:describes|involves|means)$/;
  const PREDICATE_RE =
    /^((?:An?|The|Two|Three)\s+[a-z][\w-]*(?:\s+[a-z][\w-]*){0,2}(?:\s+\$[^$]+\$)?|[A-Z][a-z]+)\s+(?:is|are)\s+(?:said\s+to\s+be\s+)?([a-z][a-z-]+(?:\s+[a-z][a-z-]+)?)\s+(?:if|when|whenever)\s+\S/;
  const CALLED_RE =
    /\b((?:is|are|was|were)\s+(?:also\s+|often\s+|sometimes\s+|usually\s+|commonly\s+|then\s+)?)?(also\s+)?(?:called|known\s+as|termed|referred\s+to\s+as|named)\s+(?:the\s+|an?\s+)?/g;
  const NAMING_RES = [
    new RegExp(`\\b(?:named|called|termed|dubbed)\\s+(?:this|that)\\s+[a-z]+\\s+(?:the\\s+)?(${TERM})(?=[.,;])`),
    new RegExp(`\\b(?:described|describes|refer(?:s|red)?\\s+to)\\s+(?:this|that)\\s+[a-z]+\\s+as\\s+(?:the\\s+|an?\\s+)?(${TERM})(?=[.,;])`),
  ];
  const APPOSITION_RE = new RegExp(`(^|\\s)(${PROPER})${ABBR},\\s+(${ARTICLE_NP})`, 'g');
  const ABBR_APPOSITION_RE = new RegExp(`((?:[a-z][\\w-]*\\s+){1,5})\\(([A-Z][A-Za-z0-9]{1,6})\\),\\s+(${ARTICLE_NP})`);
  const REVERSE_PROPER_RE = new RegExp(
    `(?:^|\\s)((?:An?|The|Their|His|Her|Its|a|an|the|their|his|her|its)\\s+[a-z][a-z\\s-]{3,50}),\\s+` +
    `(?:the\\s+(?:(?:more|most|less)\\s+)?(?:[a-z]+\\s+){0,2})?(${PROPER})(?=,|\\.?$)`, 'g');
  const REVERSE_COMMON_RE =
    /^(?:The|An?)\s+(?:[a-z][a-z-]*\s+){1,3}?[a-z][a-z-]*,\s+([a-z][\w-]+(?:\s+[a-z][\w-]+)?),\s+(?:is|are|was|were|[a-z]+s)\s/;
  const WHICH_IS_RE = new RegExp(
    '\\b(?:the|an?)\\s+((?:[a-z][\\w-]*\\s+){0,4}[a-z][\\w-]*)(?:\\s+of\\s+\\$[^$]+\\$)?,\\s+which\\s+(?:is|are)\\s+((?:an?|the)\\s+[^;.]{8,200})');
  const WHICH_MEANS_RE = /\b(?:by|of|in|through|to|into|with|as|the|an?)\s+((?:[a-z][\w-]*\s+){0,2}[a-z][\w-]*),\s+which\s+means\s+([^;.]{8,200})/;
  // "... with working memory, a system that both holds and manipulates information." (runs to the end of the sentence)
  const COMMON_APPOSITION_RE =
    /\b(?:with|by|of|in|to|into|as|called|the|an?)\s+((?:[a-z][\w-]*\s+){0,2}[a-z][\w-]*),\s+(an?\s+[a-z][^,;.]{4,80}\s(?:that|which|who|of|for|in|used)\s[^,;.]{3,120})(?=[.;]|$)/;
  const MAIN_CLAUSE_RESUMES_RE = /,\s+(?:equals?|is|are|was|were|has|have|can|will|does|gives|becomes|makes)\b.*$/;
  const PROPER_RELATIVE_RE = new RegExp(`(^|\\s)(${PROPER}),\\s+(which|who)\\s+([^,;.]{8,200})`, 'g');
  // "The negation of p, denoted by $\neg p$, is the statement ...": the whole statement is the answer, notation included.
  const NOTATION = '(?:\\$[^$]*\\$|[^,$]){1,60}?';
  const DENOTED_RE = new RegExp(`^The\\s+(${TERM})\\s+of\\s+${NOTATION},\\s+denoted\\s+by\\s+${NOTATION},\\s+is\\s+(?:the|an?)\\s+(?:\\$[^$]*\\$|[^.$]){8,240}(?:\\.[”"]?|$)`);
  const PERSON_PRONOUN_RE =/\b(?:his|her|their|he|she|they|him|them)\b/i;
  const THE_TERM_RE = new RegExp(`\\bthe\\s+term\\s+(${TERM})\\s+(?:means|refers\\s+to|denotes|describes)\\s+([^;.]{8,220})`);
  const LEAD_IN_RE =
    /^(?:In\s+general|Generally|Formally|Informally|In\s+short|Specifically|Technically|In\s+particular|More\s+precisely|Intuitively|Roughly\s+speaking|Simply\s+put|That\s+is),\s+/;
  const DEMONSTRATIVE_START_RE = /^(?:This|These|That|Those|Such)\b/;
  const OF_NOTATION_RE = new RegExp(`^The\\s+(${TERM})\\s+of\\s+(\\$[^$]{1,40}\\$)\\s+is\\s+(?:the\\s+(?:proposition|statement|set|expression|function|relation)\\s+)?(\\$[^$]{1,40}\\$)\\s*\\.?$`);
  const LAW_STATES_RE =
    /^(?:[A-Z][\w\s]{2,30}\d,\s+)?(?:the\s+)?((?:[A-Z][\w'’-]*\s+)?(?:[a-z][\w-]*\s+)?(?:law|laws|theorem|rule|principle|property|identity|identities|axiom))\s*,?\s+(?:states?|says?|asserts?)\s+that\s+(.{12,300})$/i;
  // ", as follows:" points at a display the card does not show.
  const LAW_TAIL_RE = /,?\s+(?:as\s+follows|as\s+shown|for\s+example)\b.*$/i;
  const LIST_CONTINUES_RE = /^,\s+[A-Z][\w'’-]*(?:,|\s+(?:and|or)\s)/;
  // A sentence that opens with the tail of a word broken at a line end ("tion are called tuples") lost its start.
  const WORD_TAIL_START_RE = /^(?:tion|sion|ment|ness|ity|ance|ence|ture|ing|ally|ible|able|ous|ive|ical)s?\b/;
  // "(this is known as the union rule)": the naming aside inside a rule's own sentence.
  const NAMING_ASIDE_RE = /\s*\((?:this|which)\s+is\s+(?:also\s+)?(?:known|called|referred\s+to)\s+(?:as\s+)?[^)]*\)/i;
  // References a cut-out clause cannot resolve.
  // ("those present during learning", "those who ...": a pronoun with its own modifier points nowhere.)
  const POINTS_AWAY_RE = /\b(?:such|these)\s+[a-z]+|\bthose\s+(?!present\b|who\b|that\b|which\b|of\b|in\b|at\b|with\b)[a-z]+|\bthis\s+[a-z]+/i;

  const TERM_STOP_RE =
    /^(?:if|when|whenever|because|since|and|or|but|that|which|who|from|in|on|at|for|with|to|by|is|are|was|were|has|have|had|can|will|as|than|while|where|so|it|they|we|you|rather|instead|here|there|also)$/i;
  // Subjects and predicates that are remarks about the text, not names of concepts.
  const GENERIC_HEAD_RE =
    /\b(?:answer|result|reason|problem|solution|idea|point|goal|purpose|example|difference|trick|advantage|disadvantage|rest|case|question|way|thing|following|latter|former|aim|challenge|issue|catch|downside|upside|alternative|remedy|consequence|outcome|conclusion|key|output)$/i;
  const GENERIC_LEAD_RE = /^(?:usual|main|key|only|first|second|third|next|last|final|other|same|simplest|best|worst|basic|whole|new|old|above|previous)\b/i;
  const VAGUE_DEFINITION_RE =
    /^(?:an?|the|any|one\s+of)\s+(?:same|case|only|good|bad|great|matter|bit|lot|fact|reason|result|common|example|few|most|best|worst|first|last|next|key|main|major|way|kind|sort|problem|question|answer|following|one|important|useful|simple|natural|special)\b/i;
  const PREDICATE_STOP_RE =
    /^(?:not|no|only|also|so|very|more|less|too|true|false|available|high|low|absent|present|possible|impossible|necessary|useful|important|easy|hard|difficult|simple|good|bad|best|ok|fine|correct|incorrect|wrong|right|helpful|common|rare|ready|done|large|small|big|different|same|clear|open|optional)\b|(?:ed|ing)$/i;
  const ADVERB_INSERT_RE = /ly$|^(?:however|therefore|though|instead|too|then|thus|moreover|namely|meanwhile|indeed|in\s+turn|of\s+course|for\s+example|for\s+instance|by\s+contrast|as\s+usual|in\s+fact|at\s+least)$/i;
  const FINITE_VERB_RE = /\s(?:is|are|was|were|has|have|had|can|could|will|would|must|should|may|might|does|do|did)\s/;
  const INTRO_PREPOSITION_RE = /(?:^|[.;]\s+)(?:In|On|At|For|With|By|From|To|After|Before|During|Under|Unlike|Like|As|Since|Until)\s+$/;

  const clean = (s) => quality().plain(s);
  const cap = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
  const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
  const sentenceBack = (s) => quality().tidySentence(s);
  const withoutAsides = (s) => quality().withoutAsides(s);

  const COORDINATE_RE = /;\s+|,\s+(?:whereas|while)\s+/;
  const defines = (clause) => LEAD_COPULA_RE.test(cap(clause)) || LEAD_VERB_RE.test(cap(clause));

  /**
   * The defining clause ends where the sentence moves on: at a semicolon, at ", whereas ...", or at ", and ..."
   * when what follows is a new statement ("..., and one set above ...", "..., and retrieval is the act of ...").
   */
  function cutClause(text) {
    const first = String(text).split(COORDINATE_RE)[0];
    const m = first.match(/^(.{6,}?),\s+(?:and|but|so)\s+(.+)$/);
    if (!m) return first;
    // What is left may be too thin to define anything ("a determinant, but it is not ..."); the caller checks its length.
    return /^(?:one|it|they|this|these|if|when|in)\b/.test(m[2]) || defines(m[2]) ? m[1] : first;
  }

  /** Later clauses of a sentence that define a term of their own ("..., whereas retroactive interference occurs when ..."). */
  function laterClauses(plain) {
    return plain.split(/;\s+|,\s+(?:whereas|while|and|but)\s+/).slice(1).filter(defines).map(cap);
  }

  /** Bold runs of a raw sentence; a run split by a line wrap ("**tab char-** **acters**") is one term. */
  const boldRuns = (raw) => dep('boldTerms', './bold-terms.js').runs(raw);
  const joinWrappedBold = (raw) => dep('boldTerms', './bold-terms.js').joinWrapped(raw);

  const SENTENCE_OPENER_RE =
    /^(?:In|A|An|The|When|If|For|This|These|To|As|It|We|You|One|Each|Some|Most|Many|There|However|Because|Although|While|Since|Suppose|Consider|Let|Note)$/;

  /**
   * A heading the sentence splitter left glued to the sentence under it ("Primary Keys When designing a
   * database, ..."): a run of capitalised words that ends in an ordinary sentence opener loses the heading.
   */
  function dropGluedHeading(plain) {
    const words = String(plain).split(' ');
    let run = 0;
    while (run < words.length && run < 10 && (/^[A-Z][\w'’-]*$/.test(words[run]) || (run > 0 && /^(?:of|and|the|in|for|to|that|are|not|with|an?)$/.test(words[run])))) run++;
    const opener = run - 1;
    if (opener < 2 || !SENTENCE_OPENER_RE.test(words[opener])) return plain;
    return words.slice(opener).join(' ');
  }

  /** The term that follows a naming cue: the bold run if there is one, else words up to a function word. */
  function readTerm(rest, bold) {
    const marked = bold.find((b) => rest.toLowerCase().startsWith(b.toLowerCase()));
    if (marked) return marked;
    const out = [];
    const words = rest.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const bare = word.replace(/[.,;:!?"”)]+$/, '');
      if (!bare || /^[($]/.test(word) || TERM_STOP_RE.test(bare)) break;
      if (out.length && /ing$/.test(bare) && /^(?:to|with|of|from|in|on)$/.test(words[i + 1] || '')) break; // "the eigenvalue corresponding to"
      if (out.length && bare === 'of' && /^\$|^[A-Za-z]\b[.,;]?$/.test(words[i + 1] || '')) break; // "eigenvector of $A$": notation, not name
      if (out.length && /^[A-Z]/.test(out[0]) && /^[a-z]+ed$/.test(bare)) break; // "the Directory governed from 1795"
      out.push(bare);
      if (bare !== word || out.length >= 5) break;
    }
    while (out.length && /^(?:of|the|a|an)$/i.test(out[out.length - 1])) out.pop();
    return out.join(' ');
  }

  /** "... enters the citric acid cycle" -> "the citric acid cycle": the noun phrase a following clause renames. */
  function nounPhraseBefore(before) {
    const head = String(before).replace(/[,\s]+(?:which|that)?\s*$/, '');
    const withArticle = head.match(/\b((?:the|an?)\s+(?:[a-z][\w-]*\s+){0,3}[a-z][\w-]*)$/);
    const bare = head.match(/\b(?:as|of|in|by|into|to|called)\s+((?:[a-z][\w-]*\s+)?[a-z][\w-]*)$/); // "store glucose as starch"
    return withArticle ? withArticle[1] : bare ? bare[1] : '';
  }

  /** An appositive that runs on through a list: "an assembly of the clergy, the nobility and the commoners". */
  function extendApposition(start, rest) {
    let out = start;
    for (const segment of rest.split(/,\s+/).slice(1)) {
      if (!/^(?:the|an?|and)\s/.test(segment) || FINITE_VERB_RE.test(` ${segment.split(/\s+(?:that|which|who)\s+/)[0]} `)) break;
      out = `${out}, ${segment}`;
    }
    return out.replace(/[.!?]+$/, '');
  }

  const isPhrase = (np) => !FINITE_VERB_RE.test(` ${np.split(/\s+(?:that|which|who)\s+/)[0]} `);

  /**
   * The sentence before "This set is called the empty set." as the term's answer: "There is a special set that
   * has no elements." -> "A special set that has no elements." Nothing when that sentence itself leans on
   * another ("... difficult to detect this error.") or already names the term.
   */
  function definitionBefore(prev, term) {
    // "For example, the notation {a, b, c, d} represents ...": an illustration of the term, not what it is.
    if (!prev || /^(?:for\s+(?:example|instance)|e\.g\.)/i.test(prev)) return '';
    const sc = dep('selfContained', './self-contained.js');
    const back = sentenceBack(prev).replace(/^There\s+(?:is|are|exists?)\s+/, '');
    if (!back || new RegExp(`\\b${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(back)) return '';
    if (sc && (sc.unresolvedBack(back) || sc.addressesReader(back))) return '';
    return cap(back);
  }

  /**
   * "A set is an unordered collection of objects, called elements": the sentence defines its subject (set); a
   * word it names on the way (elements) would get the set's definition as its answer.
   */
  function definesAnother(plain, term) {
    const lead = cap(plain).match(LEAD_COPULA_RE);
    return Boolean(lead) && quality().frontKey(lead[1]) !== quality().frontKey(term);
  }

  /** Every definitional reading of one sentence. ctx: { plain, bold, prev, next, dangling }. */
  function readSentence(ctx) {
    const { plain, bold, prev, dangling } = ctx;
    const found = [];
    const isBold = (term) => bold.some((b) => b.toLowerCase() === String(term).toLowerCase());
    const add = (term, back, strength, opts = {}) => {
      const marked = isBold(term);
      const named = abbreviations().attach(clean(term), plain);
      if (!quality().goodFront(named, { maxWords: opts.proper ? 10 : 6 })) return;
      if (!marked && !opts.proper && (GENERIC_HEAD_RE.test(term) || GENERIC_LEAD_RE.test(term))) return;
      const answer = withoutAsides(back);
      // A cut-out clause that points outside itself ("a means to study such collections") does not define anything.
      if (strength >= 3 && !marked && POINTS_AWAY_RE.test(answer)) return;
      if (!answer || answer.length > MAX_SENTENCE_BACK + 140 || !quality().goodBack(answer, named)) return;
      found.push({ term: cap(named), back: answer, strength: marked ? strength + 0.5 : strength });
    };
    const withPrev = () => (prev ? `${sentenceBack(prev)} ${plain}` : '');

    /** "<term> is a ..." / "<term> refers to ..." at the start of a sentence or of one of its later clauses. */
    const readLead = (text) => {
      const copula = text.match(LEAD_COPULA_RE);
      if (copula && (isBold(copula[1]) || !VAGUE_DEFINITION_RE.test(copula[2]))) {
        const clause = cutClause(copula[2]);
        if (wordCount(clause) >= 3) add(copula[1], quality().tidyClause(clause), 3);
      }
      const verb = text.match(LEAD_VERB_RE);
      if (verb && (isBold(verb[1]) || !BOLD_ONLY_VERB_RE.test(verb[2]))) {
        const statement = /^states/.test(verb[2]) ? verb[3].split(/;\s+/)[0] : cutClause(verb[3]);
        add(verb[1], quality().tidyClause(DROPPED_VERB_RE.test(verb[2]) ? statement : `${verb[2]} ${statement}`), 3);
      }
    };

    if (!dangling) readLead(cap(plain.replace(LEAD_IN_RE, '')));
    laterClauses(plain).forEach(readLead);
    // "Identities 10 and 11, the commutative laws, state that ...": a named law and what it says.
    // "The contrapositive of $p \to q$ is the proposition $\neg q \to \neg p$.": a construction stated in notation.
    const formed = plain.match(OF_NOTATION_RE);
    if (formed) add(formed[1], `The ${formed[1]} of ${formed[2]} is ${formed[3].replace(/\.\$$/, '$')}.`, 3);
    const law = plain.match(LAW_STATES_RE);
    if (law) add(law[1], quality().tidyClause(cutClause(law[2]).replace(LAW_TAIL_RE, '')), 3);
    const termed = plain.match(THE_TERM_RE);
    if (termed) add(termed[1], quality().tidyClause(termed[2]), 3);
    const denoted = plain.match(DENOTED_RE);
    if (denoted) add(denoted[1], denoted[0].trim(), 3);
    if (!dangling) {
      const predicate = plain.match(PREDICATE_RE);
      if (predicate && !PREDICATE_STOP_RE.test(predicate[2])) add(predicate[2], sentenceBack(plain), 2);

      for (const m of plain.matchAll(APPOSITION_RE)) {
        const opener = m.index === 0 && !/\s/.test(m[2]) && !isBold(m[2]);
        if (opener || INTRO_PREPOSITION_RE.test(plain.slice(0, m.index + m[1].length)) || !isPhrase(m[3])) continue;
        const whole = extendApposition(m[3], plain.slice(m.index + m[0].length - m[3].length));
        add(m[2], quality().tidyClause(whole), 3, { proper: true });
      }
      const abbr = plain.match(ABBR_APPOSITION_RE);
      const long = abbr ? abbreviations().longFormBefore(abbr[1], abbr[2], true) : '';
      if (long && isPhrase(abbr[3])) add(long, quality().tidyClause(abbr[3]), 3);

      for (const m of plain.matchAll(REVERSE_PROPER_RE)) {
        // "Considering the other columns, Quantity, Price, and ExtendedPrice ...": a name opening a list is one
        // of several items, not what the noun phrase before it renames.
        const listed = LIST_CONTINUES_RE.test(plain.slice(m.index + m[0].length));
        if (isPhrase(m[1]) && !listed) add(m[2], sentenceBack(plain), 2, { proper: true });
      }
      const insert = plain.match(REVERSE_COMMON_RE);
      if (insert && !ADVERB_INSERT_RE.test(insert[1])) add(insert[1], sentenceBack(plain), 2);

      const which = plain.match(WHICH_IS_RE) || plain.match(WHICH_MEANS_RE);
      if (which) add(which[1], quality().tidyClause(which[2].replace(MAIN_CLAUSE_RESUMES_RE, '')), 3);
      const apposed = plain.match(COMMON_APPOSITION_RE);
      if (apposed && isPhrase(apposed[2])) add(apposed[1], quality().tidyClause(apposed[2]), 3);
      for (const m of plain.matchAll(PROPER_RELATIVE_RE)) {
        const opener = m.index === 0 && !/\s/.test(m[2]);
        // "Kronecker, who did not agree ..." / "..., who introduced their use" is a remark about a person, not a definition.
        const aside = (m[3] === 'who' && !/\s/.test(m[2])) || PERSON_PRONOUN_RE.test(m[4]);
        if (!opener && !aside) add(m[2], quality().tidyClause(m[4]), 3, { proper: true });
      }
    }

    for (const m of plain.matchAll(CALLED_RE)) {
      const rest = plain.slice(m.index + m[0].length);
      const term = readTerm(rest, bold);
      if (!term) continue;
      const subject = plain.slice(0, m.index).trim();
      const tail = rest.slice(term.length).replace(/^\s*\([^)]*\)/, '').replace(/[.\s]+$/, '');
      const renamed = /\balso\b/.test(m[0]) ? nounPhraseBefore(subject) : '';
      if (renamed) add(term, `Another name for ${renamed}.`, 3);
      else if (dangling && DEMONSTRATIVE_START_RE.test(plain)) {
        // "<definition>. This is called X": the sentence before is the answer, when it stands on its own.
        const defined = definitionBefore(prev, term);
        if (defined) add(term, defined, 3);
      } else if (dangling) {
        // "However, if A → (B, C), then A → B and A → C (this is known as the decomposition rule)": the
        // sentence itself states the rule once its connective and its naming aside are gone.
        const own = sentenceBack(plain.replace(NAMING_ASIDE_RE, ''));
        const sc = dep('selfContained', './self-contained.js');
        if (own && own.length < plain.length && sc && !sc.unresolvedBack(own)) add(term, own, 2);
      }
      else if (m[1] && !tail && wordCount(subject) >= 4 && wordCount(subject) <= 25 && !/\bwhat$/i.test(subject)) add(term, quality().tidyClause(subject), 3);
      else if (!definesAnother(plain, term)) add(term, sentenceBack(plain), 2);
    }
    for (const re of NAMING_RES) {
      const m = plain.match(re);
      if (m) add(m[1], withPrev() || sentenceBack(plain), 2);
    }
    // Bold terms no pattern explained: how the sentence introduces each one (bold-terms.js).
    const explained = new Set(found.map((f) => quality().frontKey(f.term)));
    return found.concat(dep('boldTerms', './bold-terms.js').introductions(ctx, explained));
  }

  function mine(sentences, opts = {}) {
    const isNoise = opts.isNoise || (() => false);
    const raw = (sentences || []).map(joinWrappedBold);
    const plains = raw.map(clean).map(dropGluedHeading);
    const best = new Map();
    plains.forEach((plain, i) => {
      if (!plain || /\?\s*$/.test(plain) || isNoise(plain) || plain.length > MAX_SENTENCE_BACK + 200 || WORD_TAIL_START_RE.test(plain)) return;
      const usable = (s) => (s && s.length <= MAX_SENTENCE_BACK && !isNoise(s) ? s : '');
      const ctx = { plain, bold: boldRuns(raw[i]), prev: usable(plains[i - 1]), next: usable(plains[i + 1]), dangling: stemNoise().isDangling(plain) };
      for (const reading of readSentence(ctx)) {
        const key = quality().frontKey(reading.term);
        const held = best.get(key);
        if (!held) best.set(key, { ...reading, sentence: raw[i], order: best.size });
        else if (reading.strength > held.strength) Object.assign(held, reading, { sentence: raw[i] });
      }
    });
    return [...best.values()].sort((a, b) => a.order - b.order).map(({ order, ...reading }) => reading);
  }

  const api = { mine, boldRuns, dropGluedHeading, definitionBefore };
  PDFStudy.proseDefinitions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
