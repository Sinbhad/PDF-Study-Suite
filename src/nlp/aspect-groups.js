/**
 * Aspect Groups: drug and disease slides often set an aspect word on a line of its own and the facts on the
 * lines after it, all at one indent level ("Absorption" / "Completely absorbed by PO route" / "Poor oral
 * bioavailability ..."), or run the aspect into its fact ("Adverse Effects None are documented ...").
 *   flatGroups(outline)   -> [{ head, items }]  an aspect line heads the same-level lines that follow it, up to
 *                            the next aspect line or a line higher in the outline; deeper lines are left out
 *   inlineAspect(line)    -> { label, value } | null  "Adverse Effects None are documented" -> label + value
 * The aspect vocabulary is slide-subjects.js ASPECT_RE (pharmacokinetics, absorption, treatment, ...).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const aspectRe = () => dep('slideSubjects', './slide-subjects.js').ASPECT_RE;

  const MAX_ITEMS = 7;
  const MAX_ASPECT_WORDS = 3;
  // An aspect run into a capitalised fact: "Adverse Effects None are ...", "Pharmacodynamics in worm Altered ...".
  const MAX_INLINE_LABEL_WORDS = 4;

  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isAspect = (text) => {
    const t = tidy(text).replace(/:$/, '');
    return t.split(/\s+/).length <= MAX_ASPECT_WORDS && aspectRe().test(t);
  };
  /** The line opens with an aspect word ("Metabolism can kill ...", "Distribution Blood saturation"). */
  const opensWithAspect = (text) => {
    const words = tidy(text).split(/\s+/);
    for (let n = Math.min(MAX_ASPECT_WORDS, words.length - 1); n >= 1; n--) {
      if (aspectRe().test(words.slice(0, n).join(' ').replace(/:$/, ''))) return true;
    }
    return false;
  };

  function flatGroups(outline) {
    const nodes = (outline || []).filter((n) => n && n.text);
    const groups = [];
    nodes.forEach((node, i) => {
      if (!isAspect(node.text)) return;
      const next = nodes[i + 1];
      if (next && next.level > node.level) return; // a real outline heading: slide-model already groups it
      const items = [];
      for (let k = i + 1; k < nodes.length && nodes[k].level >= node.level && items.length < MAX_ITEMS; k++) {
        if (nodes[k].level > node.level) continue; // recognised handwriting and sub-points sit deeper
        if (isAspect(nodes[k].text) || opensWithAspect(nodes[k].text)) break;
        items.push(nodes[k].text);
      }
      if (items.length) groups.push({ head: tidy(node.text).replace(/:$/, ''), items });
    });
    return groups;
  }

  function inlineAspect(line) {
    const words = tidy(line).split(/\s+/);
    for (let n = Math.min(MAX_INLINE_LABEL_WORDS, words.length - 2); n >= 1; n--) {
      const label = words.slice(0, n).join(' ');
      const rest = words.slice(n);
      // The aspect may carry a short qualifier ("Pharmacodynamics in worm"); the fact starts with a capital.
      const aspectAt = [1, 2].find((k) => k <= n && aspectRe().test(words.slice(0, k).join(' ')));
      const shouted = /^[A-Z]+$/.test(rest[0]) && rest[0].length > 4; // "Absorption NOT ..." is emphasis, not a fact's start
      if (!aspectAt || !/^[A-Z]/.test(rest[0]) || shouted) continue;
      if (n > aspectAt && !/^(?:in|of|for|on)$/.test(words[aspectAt])) continue;
      return { label, value: rest.join(' ') };
    }
    return null;
  }

  const api = { flatGroups, inlineAspect, isAspect };
  PDFStudy.aspectGroups = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
