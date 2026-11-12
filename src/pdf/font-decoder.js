/**
 * Per-page Font Decoder: resolves each PDF.js text item's real font (name, glyph names, char codes) so
 * math-glyphs.js can repair characters PDF.js mis-decodes, and recovers math glyphs whose control-char
 * Unicode (\t, \v, \f, \r) causes PDF.js getTextContent() to drop them (e.g. Larson δ and ‖).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const glyphs = () => PDFStudy.mathGlyphs || (typeof require === 'function' ? require('./math-glyphs.js') : null);

  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];

  function fontObject(page, id) {
    try {
      if (page.commonObjs.has && !page.commonObjs.has(id)) return null;
      return page.commonObjs.get(id) || null;
    } catch (_err) {
      return null;
    }
  }

  /** Per-font queues of { unicode, code } in content-stream order, from the page's showText ops. */
  function glyphQueues(opList, OPS) {
    const queues = new Map();
    if (!opList || !OPS || !opList.fnArray) return queues;
    let font = null;
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const a = opList.argsArray[i];
      if (fn === OPS.setFont) font = a && a[0];
      else if (fn === OPS.showText && font && a && Array.isArray(a[0])) {
        if (!queues.has(font)) queues.set(font, { list: [], pos: 0 });
        const q = queues.get(font).list;
        for (const g of a[0]) {
          if (g && typeof g === 'object' && !g.isSpace && g.unicode && g.unicode !== ' ') {
            q.push({ unicode: g.unicode, code: g.originalCharCode });
          }
        }
      }
    }
    return queues;
  }

  /** Recovers dropped 0x09..0x0D math glyphs and splits items where PDF.js glued a smaller shifted subscript/superscript ("an", "Sn", "can"). */
  function refineItems(page, items, opList, OPS) {
    const recovered = [];
    const drawn = [];
    if (!page || !opList || !OPS || !opList.fnArray) return items || [];
    const G = glyphs();
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    let tm = [1, 0, 0, 1, 0, 0];
    let tlm = [1, 0, 0, 1, 0, 0];
    let fontId = null;
    let fontSize = 10;
    let leading = 0;
    let charSpace = 0;
    let hScale = 1;
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const a = opList.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.beginText) tm = tlm = [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.setLeading) leading = a[0];
      else if (fn === OPS.setCharSpacing) charSpace = a[0];
      else if (fn === OPS.setHScale) hScale = a[0] / 100;
      else if (fn === OPS.setFont) [fontId, fontSize] = a;
      else if (fn === OPS.setTextMatrix) tm = tlm = a.slice();
      else if (fn === OPS.moveText) tm = tlm = mul(tlm, [1, 0, 0, 1, a[0], a[1]]);
      else if (fn === OPS.setLeadingMoveText) {
        leading = -a[1];
        tm = tlm = mul(tlm, [1, 0, 0, 1, a[0], a[1]]);
      } else if (fn === OPS.nextLine) tm = tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]);
      else if (fn === OPS.showText && fontId && Array.isArray(a[0])) {
        const f = fontObject(page, fontId);
        const fam = f ? G.familyInfo(f.name) : null;
        for (const g of a[0]) {
          if (typeof g === 'number') {
            tm = mul(tm, [1, 0, 0, 1, (-g / 1000) * fontSize * hScale, 0]);
            continue;
          }
          if (!g || typeof g !== 'object') continue;
          const m = mul(ctm, mul(tm, [fontSize * hScale, 0, 0, fontSize, 0, 0]));
          const gw = Math.abs(((g.width || 500) / 1000) * m[0]);
          const cp = g.unicode ? g.unicode.codePointAt(0) : -1;
          if (g.unicode && cp >= 32) drawn.push({ u: g.unicode, fontId, m, w: gw });
          else if (cp >= 9 && cp <= 13 && f && fam && (fam.isMath || fam.pi)) {
            const gn = (f.differences && f.differences[g.originalCharCode]) || (f.defaultEncoding && f.defaultEncoding[g.originalCharCode]);
            if (gn && gn !== 'space') {
              const ch = G.decodeChar(g.unicode, fam, gn);
              if (ch && ch.trim()) recovered.push({ str: ch, fontName: fontId, transform: m, width: gw, __recovered: true });
            }
          }
          tm = mul(tm, [1, 0, 0, 1, (((g.width || 0) / 1000) * fontSize + charSpace) * hScale, 0]);
        }
      }
    }
    if (!items) return recovered;
    const split = [];
    for (const it of items) {
      if (!it || typeof it.str !== 'string' || !/^[A-Za-z][A-Za-z0-9]{1,4}$/.test(it.str) || !it.transform) {
        split.push(it);
        continue;
      }
      const n = it.str.length;
      let hit = null;
      for (let k = 0; k + n <= drawn.length; k++) {
        const d0 = drawn[k];
        if (d0.fontId !== it.fontName || Math.abs(d0.m[4] - it.transform[4]) > 1.5 || Math.abs(d0.m[5] - it.transform[5]) > 1.5) continue;
        if (drawn.slice(k, k + n).map((d) => d.u).join('') === it.str) { hit = drawn.slice(k, k + n); break; }
      }
      const j = hit ? hit.findIndex((d, idx) => idx > 0 && Math.abs(d.m[3]) < Math.abs(hit[0].m[3]) * 0.82 &&
        Math.abs(d.m[5] - hit[0].m[5]) > Math.abs(hit[0].m[3]) * 0.1) : -1;
      if (j > 0) {
        split.push({ ...it, str: it.str.slice(0, j), transform: hit[0].m, width: Math.max(2, hit[j].m[4] - hit[0].m[4]) });
        split.push({ ...it, str: it.str.slice(j), transform: hit[j].m, width: hit.slice(j).reduce((s, d) => s + d.w, 0) });
      } else split.push(it);
    }
    return split.concat(recovered);
  }

  function recoverDroppedItems(page, opList, OPS) {
    return refineItems(page, null, opList, OPS);
  }

  /** Builds { name, fam, decode(str) } for one font id. */
  function makeDecoder(id, fontObj, realName, queue) {
    const G = glyphs();
    const fam = G.familyInfo(realName || (fontObj && fontObj.name) || '');
    const names = fontObj && (fontObj.differences || fontObj.defaultEncoding) ? fontObj : null;
    let inverse = null;
    const invert = () => {
      inverse = {};
      const map = fontObj && fontObj.toUnicode && (fontObj.toUnicode._map || fontObj.toUnicode.map);
      if (Array.isArray(map)) map.forEach((u, c) => { if (u !== undefined && !(u in inverse)) inverse[u] = c; });
      return inverse;
    };
    const glyphName = (code) => {
      if (!names || code === undefined || code === null) return null;
      return (names.differences && names.differences[code]) || (names.defaultEncoding && names.defaultEncoding[code]) || null;
    };
    const codeOf = (ch) => {
      if (queue) {
        for (let k = queue.pos; k < Math.min(queue.list.length, queue.pos + 6); k++) {
          if (queue.list[k].unicode === ch) {
            queue.pos = k + 1;
            return queue.list[k].code;
          }
        }
      }
      const cp = ch.codePointAt(0);
      return cp < 32 ? cp : (inverse || invert())[ch];
    };
    const needsWork = fam.isMath || fam.pi;
    return {
      name: realName || (fontObj && fontObj.name) || '',
      fam,
      decode(str) {
        if (!needsWork && !/[\u0000-\u001f\u007f-\u009f\uE000-\uF8FF\uFB00-\uFB06\uFFFD]/.test(str)) return str;
        return G.decodeString(str, fam, (ch) => (ch === ' ' || !names ? null : glyphName(codeOf(ch))));
      },
    };
  }

  function buildDecoders(page, items, fontNames, opList, OPS) {
    const out = new Map();
    const queues = glyphQueues(opList, OPS);
    const ids = [...new Set((items || []).map((i) => i && i.fontName).filter(Boolean))];
    for (const id of ids) {
      const obj = page && page.commonObjs ? fontObject(page, id) : null;
      const real = (fontNames && fontNames.get(id)) || (obj && obj.name) || id;
      out.set(id, makeDecoder(id, obj, real, queues.get(id)));
    }
    return out;
  }

  function plainDecoder(realName) {
    return makeDecoder(null, null, realName, null);
  }

  PDFStudy.fontDecoder = { buildDecoders, plainDecoder, glyphQueues, recoverDroppedItems, refineItems };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.fontDecoder;
  }
})(typeof window !== 'undefined' ? window : globalThis);
