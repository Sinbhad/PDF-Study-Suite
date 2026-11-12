/**
 * Block-level formatting on top of richText (inline math/code/scripts): turns plain study strings
 * into paragraphs, real ordered/unordered lists and tables, and guards against empty/garbage text.
 *   inline(text)        one-line rich HTML (newlines collapsed)            '' when there is nothing to show
 *   title(text, max)    inline + safe truncation; { html, full } so callers can add a hover title
 *   block(text)         `\n` -> paragraphs; consecutive `1. ` / `(a) ` / `• ` lines -> <ol>/<ul>;
 *                       inline "1. … 2. … 3. …" enumerations are split defensively
 *   table(rows)         string[][] -> <table> (first row is the header)
 * $$…$$ and ``` fences may span lines and are never split.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const RT = () => PDFStudy.richText || (typeof require === 'function' ? require('./rich-text.js') : null);
  const DECOR = /[✦✧❖➢➤►▶◆◇♦]\s*/g; // ornamental bullets from slide decks
  const UL = /^\s*(?:[•▪◦‣⁃∙]\s*|[-–—*]\s+)/;
  const OL_NUM = /^\s*(?:\d{1,2}[.)]|\(\d{1,2}\))\s+/;
  const OL_ALPHA = /^\s*\((?:[a-z]|[ivx]{2,4})\)\s+/;

  function clean(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(DECOR, '').replace(/[ \t]+\n/g, '\n').trim();
  }
  /** True when the text has something worth showing (a letter or digit), not just punctuation. */
  function hasContent(text) {
    return /[A-Za-z0-9À-ɏͰ-Ͽ∀-⋿]/.test(clean(text));
  }
  function inline(text) {
    const t = clean(text).replace(/\s*\n+\s*/g, ' ');
    return hasContent(t) ? RT().render(t) : '';
  }

  /** Cut at a word boundary without splitting a `$…$` run. */
  function safeCut(t, max) {
    let cut = t.slice(0, max).replace(/\s+\S*$/, '');
    if (((cut.match(/\$/g) || []).length) % 2) cut = cut.slice(0, cut.lastIndexOf('$'));
    return `${cut.trim()}…`;
  }
  function title(text, max = 160) {
    const t = clean(text).replace(/\s*\n+\s*/g, ' ');
    if (!hasContent(t)) return { html: '', full: '' };
    const full = RT().plain(t);
    return { html: RT().render(t.length > max ? safeCut(t, max) : t), full };
  }

  function splitLines(t) {
    const out = [];
    let buf = '';
    t.split('\n').forEach((ln) => {
      buf = buf ? `${buf}\n${ln}` : ln;
      const open = ((buf.match(/\$\$/g) || []).length % 2) || ((buf.match(/```/g) || []).length % 2);
      if (!open) { out.push(buf); buf = ''; }
    });
    if (buf) out.push(buf);
    return out;
  }
  const kindOf = (ln) => (UL.test(ln) ? 'ul' : OL_NUM.test(ln) ? 'ol' : OL_ALPHA.test(ln) ? 'alpha' : '');
  const strip = (ln) => ln.replace(UL, '').replace(OL_NUM, '').replace(OL_ALPHA, '');

  /** "Lead: 1. a 2. b 3. c" -> { lead, items } when the markers run 1,2,3… (or (a),(b),(c)…). */
  function splitEnum(line) {
    const mask = line.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|`[^`\n]+`/g, (m) => ' '.repeat(m.length));
    const styles = [(n) => `${n}.`, (n) => `(${n})`, (n) => `(${String.fromCharCode(96 + n)})`];
    for (const mk of styles) {
      const cuts = [];
      let from = 0;
      for (let n = 1; n <= 26; n++) {
        const tok = mk(n);
        let at = -1;
        for (let i = mask.indexOf(tok, from); i >= 0; i = mask.indexOf(tok, i + 1)) {
          const before = i === 0 ? ' ' : mask[i - 1];
          if (/\s/.test(before) && mask[i + tok.length] === ' ' && /\S/.test(mask[i + tok.length + 1] || '')) { at = i; break; }
        }
        if (at < 0) break;
        cuts.push(at);
        from = at + tok.length;
      }
      if (cuts.length >= 2) {
        return { lead: line.slice(0, cuts[0]).trim(), items: cuts.map((c, k) => line.slice(c, k + 1 < cuts.length ? cuts[k + 1] : line.length).trim()) };
      }
    }
    return null;
  }

  const para = (html) => (/<(?:div|pre)\b/.test(html) ? `<div class="para">${html}</div>` : `<p>${html}</p>`);
  function listHtml(kind, items) {
    const lis = items.filter(hasContent).map((it) => `<li>${RT().render(it)}</li>`).join('');
    if (!lis) return '';
    return kind === 'ul' ? `<ul>${lis}</ul>` : `<ol${kind === 'alpha' ? ' class="alpha"' : ''}>${lis}</ol>`;
  }

  function block(text) {
    const t = clean(text);
    if (!hasContent(t)) return '';
    const lines = [];
    splitLines(t).forEach((ln) => {
      if (!ln.trim()) return;
      const en = !kindOf(ln) && !ln.includes('```') ? splitEnum(ln) : null;
      if (!en) { lines.push(ln); return; }
      if (en.lead) lines.push(en.lead);
      lines.push(...en.items);
    });
    const out = [];
    for (let i = 0; i < lines.length;) {
      const k = kindOf(lines[i]);
      let j = i;
      while (k && j < lines.length && kindOf(lines[j]) === k) j++;
      if (k && (k === 'ul' || j - i >= 2)) {
        out.push(listHtml(k, lines.slice(i, j).map(strip)));
        i = j;
      } else {
        if (hasContent(lines[i])) out.push(para(RT().render(lines[i].trim())));
        i++;
      }
    }
    return out.join('');
  }

  /** rows: string[][]; the first row becomes the header when there are at least two rows. */
  function table(rows) {
    const clean2d = (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && r.some(hasContent));
    if (!clean2d.length) return '';
    const cols = Math.max(...clean2d.map((r) => r.length));
    const cells = (r, tag, attr) => Array.from({ length: cols }, (_, c) => `<${tag}${attr}>${inline(r[c]) }</${tag}>`).join('');
    const head = clean2d.length > 1 ? `<thead><tr>${cells(clean2d[0], 'th', ' scope="col"')}</tr></thead>` : '';
    const body = (head ? clean2d.slice(1) : clean2d).map((r) => `<tr>${cells(r, 'td', '')}</tr>`).join('');
    return `<div class="table-wrap"><table class="data-table">${head}<tbody>${body}</tbody></table></div>`;
  }

  PDFStudy.richBlocks = { clean, hasContent, inline, title, block, table, splitEnum };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.richBlocks;
})(typeof window !== 'undefined' ? window : globalThis);
