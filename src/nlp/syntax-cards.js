/**
 * Syntax Cards: the templates a textbook's syntax box prints, as "How do you ...?" cards. A syntax box is
 * usually a diagram (code with callout labels around it) that reads as noise in one line; what it states
 * plainly is its template lines. Pure and DOM-free.
 *   fromBox(body) -> [{ front, back }]
 *     "To construct an array: new typeName[length]"      -> "How do you construct an array?" => `new typeName[length]`
 *     "The Enhanced for Loop Syntax for (typeName variable : collection) { statements } This variable ..."
 *                                                        -> "How do you write the enhanced for loop?" => the template
 *   A template ends where the box's prose or a callout label starts (a capitalised word); it must hold a
 *   placeholder the reader fills in (typeName, statements, condition) and balanced brackets.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const PURPOSE_RE = /\bTo\s+([a-z][a-z ]{3,40}?):\s+/g;
  // "<name of the construct> Syntax <template>": the box opens with its name, then the word Syntax
  const NAMED_RE = /^([A-Z][\w ]{2,40}?)\s+Syntax\s+(.*)$/;
  // A placeholder in a template: a camelCase name or one of the words books use for "fill this in"
  const PLACEHOLDER_RE = /\b[a-z]+[A-Z][A-Za-z]*\b|\b(?:statements?|condition|expression|variable|collection|initialization|update)\b/;
  const MAX_TEMPLATE_CHARS = 80;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\$/g, '').replace(/`/g, ' ').replace(/\s+/g, ' ').trim();

  /** The template at the start of `rest`: tokens up to the first capitalised word (prose or a callout label). */
  function template(rest) {
    const out = [];
    for (const token of rest.split(' ')) {
      if (/^[A-Z][a-z]+[.,:]?$/.test(token) && out.length) break;
      out.push(token);
    }
    const code = out.join(' ').replace(/[.,;:]+$/, '').trim();
    const balanced = (open, close) => code.split(open).length === code.split(close).length;
    if (!code || /^[A-Z]/.test(code) || code.length > MAX_TEMPLATE_CHARS || !PLACEHOLDER_RE.test(code)) return '';
    return balanced('(', ')') && balanced('{', '}') && balanced('[', ']') ? code : '';
  }

  function fromBox(body) {
    const flat = plain(body);
    const out = [];
    const add = (front, code) => {
      if (code && !out.some((c) => c.front === front)) out.push({ front, back: `\`${code}\`` });
    };
    const named = flat.match(NAMED_RE);
    // "To access an element" says nothing of what it is an element of: the box's name goes in front ("Arrays: ...")
    const boxName = named ? named[1].trim() : '';
    const stem = boxName.toLowerCase().replace(/^the\s+/, '').split(' ')[0].replace(/s$/, '');
    for (const m of flat.matchAll(PURPOSE_RE)) {
      const purpose = m[1].trim();
      const lead = boxName && stem && !purpose.includes(stem) ? `${boxName}: how` : 'How';
      add(`${lead} do you ${purpose}?`, template(flat.slice(m.index + m[0].length)));
    }
    if (named && !/^To\s/.test(named[2])) {
      const name = named[1].trim();
      const lower = name.toLowerCase();
      add(`How do you write ${/^the\s/.test(lower) ? lower : `a ${lower}`}?`, template(named[2]));
    }
    return out;
  }

  const api = { fromBox };
  PDFStudy.syntaxCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
