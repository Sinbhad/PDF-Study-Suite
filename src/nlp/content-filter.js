/**
 * Content Filter: tells study content apart from what surrounds it on a slide or a page, so every generator
 * (cards, quiz, summary) can skip the same things. DOM-free; rules read layout, grammar and typography only.
 *   slideKind(slide, ctx)  'title' | 'objectives' | 'case' | 'contact' | 'references' | 'question' | 'content'
 *   slideKinds(slides)     the same for a whole deck: a case runs on over the slides that share its title
 *   lineKind(line, ctx)    'url' | 'caption' | 'citation' | 'signalment' | 'quip' | 'code' | 'biography' |
 *                          'example' | 'objective' | 'annotation' | 'folio' | 'content'
 *   isStudyContent(x)      a line (string or tagged line object) or a slide (an object with a title)
 *   isNotToMemorise(slide) the slide says, typed or in ink, that it is not to be learned ("Do not memorize", "FYI")
 *   slideLineFilter(slide, ctx) / deckStamps(slides)   slide-kinds.js (with slideKind / slideKinds)
 *   bookLineKinds(lines) / studyText(text)   running-text spans (content-spans.js)
 * Extraction tags win when present: line.isAnnotation, line.kind ('caption' | 'folio' | 'url' | 'objective' |
 * 'biography' | 'code'), slide.contentKind. Without them the text rules below decide.
 * ctx (optional): { inCase, inExample, inBiography, slideKind, index, hasQa }.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const EXTRACTION_LINE_KINDS = new Set(['caption', 'folio', 'url', 'objective', 'biography', 'code']);

  // A web address or e-mail; the line is a link when fewer than MIN_WORDS_BESIDE_LINK words remain without it.
  const LINK_RE = /(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b|\b[\w-]+\.(?:com|org|edu|net|gov)(?:\/\S*)?/gi;
  const MIN_WORDS_BESIDE_LINK = 4;

  // Figure captions: a figure/table label, a position word, a pointer to a mark in the picture, a credit.
  const CAPTION_START_RE =
    /^(?:fig(?:ure)?\.?\s*\d|table\s+\d|image|photo(?:graph)?|picture|source|credit|courtesy|(?:right|left|top|bottom|above|below|inset|center|centre)\s*[:–—-])/i;
  const CAPTION_MARK_RE =
    /\((?:[a-z]+\s+)?(?:arrows?|arrowheads?|asterisks?|stars?|circled?|inset|outlined|boxed)\)|\(\s*(?:red|blue|green|yellow|orange|purple|black|white|pink)\s*\)|\b(?:arrows?|arrowheads?)\s+(?:indicate|show|point)|\bphoto\s+(?:by|credit)\b|\bimage\s+courtesy\b|\bcourtesy\s+of\b|\(note\s+[^)]+\)|\bshown\s+in\s+(?:red|blue|green|yellow)\b/i;
  // An imaging or specimen description: "CT scan of a dog with ...", "View looking down into the canal ...".
  const SPECIMEN_RE = /^(?:CT|MRI|radiograph|x-ray|ultrasound|ultrasonograph|micrograph|photomicrograph|histolog\w*|gross\s+(?:appearance|image|specimen)|view\s+(?:of|looking|from)|close-up|cross[-\s]section|serial\s+sections?)\b/i;
  // Patients and specimens a picture is "of": a caption names the animal or person shown.
  const PATIENT = '(?:dog|cat|horse|cow|calf|bull|steer|heifer|mouse|rat|pig|sow|sheep|lamb|ewe|goat|kid|bird|foal|mare|puppy|kitten|rabbit|ferret|patient|man|woman|child|boy|girl|bovine|canine|feline|equine|ovine|caprine|porcine)';
  // A second caption often follows the first on the same line ("... in a mouse Subdural hemorrhage in a dog").
  const PICTURED_RE = new RegExp(`^(?:an?\\s+)?${PATIENT}s?\\s+(?:with|showing|after)\\b|\\b(?:in|from)\\s+an?\\s+(?:[a-z-]+\\s+){0,2}${PATIENT}(?=\\s*\\.?$|\\s+[A-Z])`, 'i');
  // "Granulomatous encephalitis (due to mycobacterial infection)": a lesion pictured, with its cause in brackets.
  const PICTURED_CAUSE_RE = /^[A-Z][^.!?]{3,80}\(due\s+to\s+[^)]+\)\s*$/;

  // References: author-initial lists, "et al.", DOIs, ISBNs, "Retrieved from", page ranges, journal + year.
  const CITATION_RE =
    /\bet\s+al\.?|\bdoi\s*:|\bISBN\b|\bretrieved\s+from\b|\bpp\.\s*\d|^\s*\[?\d{1,3}[\].]?\s*[A-Z][a-z]+,\s+(?:[A-Z]\.\s*){1,3}|\b[A-Z][a-z]+\.?\s+(?:J|Vet|Med|Sci|Res)\.?\s+\w*\.?\s*(?:19|20)\d\d\b/;
  const CITATION_ASIDE_RE = /\((?:[^()]*?(?:et\s+al|(?:19|20)\d\d)[^()]*?)\)/g;
  const MIN_WORDS_BESIDE_CITATION = 4;

  // Patient details: an age next to a sex or a name ("8y/o M/I Pug", "Three cats ranging in age from 1.5yrs").
  const AGE_RE =
    /\b\d+(?:\.\d+)?\s*(?:-|–|to)?\s*\d*(?:\.\d+)?\s*(?:y\/o|yo|yrs?|years?[\s-]+old|mos?[\s-]+old|months?[\s-]+old|wks?[\s-]+old|weeks?[\s-]+old|days?[\s-]+old)\b|\bin\s+age\s+from\b|\baged?\s+\d/i;
  const SEX_RE = /(?:^|[\s,(])(?:M\/?[INC]|F\/?[SI]|MN|FS|MC|FN|MI|FI)(?=[\s,)]|$)|\b(?:intact|spayed|neutered|castrated|gelding|entire)\b/;
  // History lines count as case material only inside a case ("Recent history of rain" is a fact elsewhere).
  const HISTORY_RE =
    /\b(?:\d+\s*[-–]?\s*\d*\s*(?:d|day|wk|week|mo|month|y|yr|year)s?\s+history|history\s+of|presented\s+(?:for|with|to)|presenting\s+(?:complaint|signs)|chief\s+complaint|owners?\s+(?:report|reports|noticed|states|says)|on\s+presentation|histories\s+include)\b/i;
  // "This bovine is Grade 5 lame and ...": a demonstrative pointing at the patient on the slide.
  const THIS_PATIENT_RE = new RegExp(`^(?:this|these|the)\\s+(?:[a-z-]+\\s+){0,2}${PATIENT}s?\\s+(?:is|are|was|were|has|had|presented|presents)\\b`, 'i');

  // Remarks about the course rather than the subject: exams, labs, reminders, thanks.
  const META_RE =
    /\b(?:(?:not\s+)?on\s+(?:the\s+)?exams?|exam\s+question|(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:need\s+to\s+)?(?:know|memori[sz]e)|need\s+to\s+know|memori[sz]e|office\s+hours?|homework|lab\s+will|lab\s+(?:requirements|attire|rules|schedule)|what\s+to\s+bring|dress\s+code|syllabus|attendance|due\s+date|(?:next|last)\s+(?:week|lecture|class|time)|same\s+as\s+last|upcoming\s+lectures?|take\s+a\s+deep\s+breath|any\s+questions|thank\s+you|kahoot|stay\s+tuned|fun\s+fact|hint[.…]*\s*hint|(?:the\s+)?correct\s+answer\s+on|soapbox|in\s+my\s+(?:experience|opinion))\b|\bDr\.\s+[A-Z][a-z]+\b(?!\s+(?:et\s+al|and\s+[A-Z]))/i;
  const SHOUT_MIN_WORDS = 3; // "LAB WILL HAVE LIVE COWS": three or more all-capital words is a remark, not a fact
  const SHOUT_SHARE = 0.85;

  // Program text: statement terminators, braces, declarations.
  // (A declaration must end like code: "static route = entered by admin" in notes is a definition.)
  const CODE_RE =
    /;\s*(?:\/\/.*)?$|^\s*[{}]\s*$|^\s*(?:public|private|protected|static|final|int|double|float|char|boolean|long|String|void|return|import|package|class)\s+[\w<>[\]]+.*[;{)]\s*$|^\s*[\w.]+(?:\[[^\]]*\])+\s*=\s*[^=]|^\s*(?:for|while|if)\s*\(.*\)\s*\{?\s*$/;

  // A biography sidebar opens with a name in capitals and the person's dates: "GEORGE BOOLE (1815–1864)".
  const BIO_HEAD_RE =
    /^[A-Z][A-Z'’.\- ]{2,40}\s*\((?:c\.\s*)?\d{3,4}(?:\s*(?:B\.?\s?C\.?(?:\s?E\.?)?|A\.?\s?D\.?|C\.?E\.?))?\s*[–—-]\s*(?:c\.\s*)?\d{3,4}/;
  const EXAMPLE_HEAD_RE = /^(?:\*\*)?(?:EXAMPLE|Example|WORKED\s+EXAMPLE|Worked\s+Example)\s+\d+(?:\.\d+)*\b|^Solution\s*[:.]/;

  // Course-goal verbs that open a learning objective ("Describe ...", "Be able to ...").
  const OBJECTIVE_VERB_RE =
    /^(?:[•·\-–]\s*)?(?:Define|Describe|Explain|List|Identify|Recogni[sz]e|Understand|Compare|Contrast|Analy[sz]e|Discuss|Outline|Utili[sz]e|Apply|Draw|Calculate|Differentiate|Distinguish|Summari[sz]e|Interpret|Evaluate|Name|State|Use|Know|Be\s+able\s+to)\b/;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const words = (s) => plain(s).split(/\s+/).filter(Boolean);
  const textOf = (line) => (line && typeof line === 'object' ? line.text : line);

  function isShouting(text) {
    const caps = words(text).filter((w) => /^[A-Z][A-Z'’!.,-]{2,}$/.test(w));
    const longWords = words(text).filter((w) => /[A-Za-z]{3,}/.test(w));
    return caps.length >= SHOUT_MIN_WORDS && caps.length >= longWords.length * SHOUT_SHARE;
  }

  function isLink(text) {
    const t = plain(text);
    if (!t.match(LINK_RE)) return false;
    return words(t.replace(LINK_RE, ' ')).length < MIN_WORDS_BESIDE_LINK;
  }

  function isCaption(text) {
    const t = plain(text);
    // "Ultrasound is extremely valuable for ..." states a fact; "CT scan of a dog with ..." describes a picture.
    const describes = SPECIMEN_RE.test(t) && !/\b(?:is|are|was|were|can|has|have|should|must|will)\b/.test(t);
    return CAPTION_START_RE.test(t) || CAPTION_MARK_RE.test(t) || describes || PICTURED_RE.test(t) || PICTURED_CAUSE_RE.test(t);
  }

  function isCitation(text) {
    const t = plain(text);
    if (!CITATION_RE.test(t)) return false;
    const rest = t.replace(CITATION_ASIDE_RE, ' ');
    return CITATION_RE.test(rest) || words(rest).length < MIN_WORDS_BESIDE_CITATION;
  }

  /** Age together with a sex or a proper name: a patient's signalment line. */
  function isSignalment(text, ctx = {}) {
    const t = plain(text);
    if (AGE_RE.test(t) && (SEX_RE.test(t) || /^[A-Z][a-z]+\s/.test(t) || ctx.inCase)) return true;
    if (THIS_PATIENT_RE.test(t)) return true;
    return Boolean(ctx.inCase) && HISTORY_RE.test(t);
  }

  function isQuip(text) {
    const t = plain(text);
    return META_RE.test(t) || isShouting(t);
  }

  function lineKind(line, ctx = {}) {
    if (line && typeof line === 'object') {
      if (line.isAnnotation) return 'annotation';
      if (EXTRACTION_LINE_KINDS.has(line.kind)) return line.kind;
    }
    const t = plain(textOf(line));
    if (!t) return 'content';
    if (ctx.inCode) return 'code';
    if (ctx.inBiography || BIO_HEAD_RE.test(t)) return 'biography';
    if (ctx.inExample || EXAMPLE_HEAD_RE.test(t)) return 'example';
    if (isLink(t)) return 'url';
    if (isCitation(t)) return 'citation';
    if (isCaption(t)) return 'caption';
    if (isSignalment(t, ctx)) return 'signalment';
    if (isQuip(t)) return 'quip';
    if (CODE_RE.test(t)) return 'code';
    if (ctx.slideKind === 'objectives' && OBJECTIVE_VERB_RE.test(t)) return 'objective';
    return 'content';
  }

  // Slide-level classification lives in slide-kinds.js, running-text spans in content-spans.js.
  const slides = () => dep('slideKinds', './slide-kinds.js');
  const spans = () => dep('contentSpans', './content-spans.js');
  const slideKind = (slide, ctx) => slides().slideKind(slide, ctx);
  const slideKinds = (list, opts) => slides().slideKinds(list, opts);
  const slideLineFilter = (slide, ctx, clean) => slides().slideLineFilter(slide, ctx, clean);
  const deckStamps = (list, clean) => slides().deckStamps(list, clean);
  const lineQualifiers = (slide, clean) => slides().lineQualifiers(slide, clean);
  const keyLines = (slide, clean) => slides().keyLines(slide, clean);
  const bookLineKinds = (lines, opts) => spans().bookLineKinds(lines, opts);
  const studyText = (text, opts) => spans().studyText(text, opts);

  // The lecturer marks a slide or a table as not to be learned: "Do not memorize", "you don't need to know
  // this", "FYI", "not on the exam" (typed or written on the slide in ink).
  const NOT_TO_MEMORISE_RE =
    /\b(?:do\s*n[o'’]?t|don['’]?t|no\s+need\s+to|not\s+necessary\s+to|need\s+not)\s+(?:need\s+to\s+)?(?:memori[sz]e|know|learn)\b|^\s*FYI\s*[.!:]?\s*$|\bfor\s+your\s+information\b|\bnot\s+(?:on|in)\s+(?:the\s+|your\s+)?(?:exam|test|quiz)\b|\bwon['’]?t\s+be\s+(?:tested|examined|on\s+the\s+exam)\b/i;

  /** Does the slide say (in type or in ink) that its content is not to be memorised? */
  function isNotToMemorise(slide) {
    if (!slide || typeof slide !== 'object') return false;
    const lines = [slide.title, ...(slide.bullets || []), ...(slide.annotations || []).map(textOf)];
    return lines.some((l) => NOT_TO_MEMORISE_RE.test(plain(l)));
  }

  function isStudyContent(item, ctx = {}) {
    if (item && typeof item === 'object' && 'title' in item && !('text' in item)) {
      const kind = slideKind(item, ctx);
      return kind === 'content' || kind === 'question';
    }
    return lineKind(item, ctx) === 'content';
  }

  const api = {
    slideKind, slideKinds, lineKind, isStudyContent, isNotToMemorise, slideLineFilter, deckStamps, lineQualifiers, keyLines,
    bookLineKinds, studyText,
    isCaption, isCitation, isLink, isSignalment, isQuip, BIO_HEAD_RE, EXAMPLE_HEAD_RE, CODE_RE, META_RE, HISTORY_RE, THIS_PATIENT_RE,
  };
  PDFStudy.contentFilter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
