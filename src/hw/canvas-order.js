/**
 * Reading order for a canvas page. The lines read from all tiles (boxes in overview pixels) are grouped into
 * blocks of lines that sit right under one another, blocks that lie close together form a topic cluster, and
 * clusters are read one after the other, so two topics side by side on the page never interleave.
 *   arrange(lines) -> { lines (ordered, each with cluster and group), clusters, groups, lineHeight }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const median = (nums) => {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    return s[s.length >> 1];
  };

  function sets(n) {
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (a) => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    return { find, join: (a, b) => { parent[find(a)] = find(b); } };
  }

  const boxOf = (items) => {
    const x = Math.min(...items.map((i) => i.box.x));
    const y = Math.min(...items.map((i) => i.box.y));
    return { x, y, w: Math.max(...items.map((i) => i.box.x + i.box.w)) - x, h: Math.max(...items.map((i) => i.box.y + i.box.h)) - y };
  };

  /** Two tiles can overlap: of two boxes covering mostly the same ink, keep the surer (then the longer) read. */
  function dedupe(lines) {
    const drop = new Set();
    for (let i = 0; i < lines.length; i++) for (let j = 0; j < i; j++) {
      if (drop.has(i) || drop.has(j)) continue;
      const a = lines[i].box;
      const b = lines[j].box;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix <= 0 || iy <= 0 || ix * iy < 0.6 * Math.min(a.w * a.h, b.w * b.h)) continue;
      const better = (lines[i].confidence || 0) * Math.sqrt(a.w) >= (lines[j].confidence || 0) * Math.sqrt(b.w);
      drop.add(better ? j : i);
    }
    return lines.filter((_l, i) => !drop.has(i));
  }

  /** Top to bottom in rows: items whose tops lie above the bottom of the row's first item read left to right. */
  function banded(items) {
    const byTop = items.slice().sort((a, b) => a.box.y - b.box.y);
    const out = [];
    let row = [];
    let floor = 0;
    const flush = () => { out.push(...row.sort((a, b) => a.box.x - b.box.x)); row = []; };
    for (const it of byTop) {
      if (row.length && it.box.y >= floor) flush();
      if (!row.length) floor = it.box.y + it.box.h;
      else floor = Math.min(floor, it.box.y + it.box.h);
      row.push(it);
    }
    flush();
    return out;
  }

  /** Blocks: a line joins the line right above it (small vertical gap, overlapping or left-aligned). */
  function blocks(lines, medH) {
    const s = sets(lines.length);
    for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines.length; j++) {
      const a = lines[i].box;
      const b = lines[j].box;
      if (b.y <= a.y) continue;
      const gap = b.y - (a.y + a.h);
      const over = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const aligned = Math.abs(a.x - b.x) < 2 * medH;
      if (gap >= -0.6 * medH && gap <= 0.8 * medH && (over > 0 || (aligned && over > -3 * medH))) s.join(i, j);
    }
    const byRoot = new Map();
    lines.forEach((l, i) => {
      const r = s.find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(l);
    });
    return Array.from(byRoot.values()).map((ls) => ({ lines: ls.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x), box: boxOf(ls) }));
  }

  /** Topic clusters: blocks whose boxes are within `reach` px of each other. */
  function clustersOf(groups, reach) {
    const s = sets(groups.length);
    for (let i = 0; i < groups.length; i++) for (let j = 0; j < i; j++) {
      const a = groups[i].box;
      const b = groups[j].box;
      const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
      const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      if (dx <= reach && dy <= reach) s.join(i, j);
    }
    const byRoot = new Map();
    groups.forEach((g, i) => {
      const r = s.find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(g);
    });
    return Array.from(byRoot.values()).map((gs) => ({ groups: banded(gs), box: boxOf(gs) }));
  }

  /**
   * @param {Array<{box:{x,y,w,h}, text:string, confidence:number}>} lines boxes in one shared pixel space
   * @returns {{lines:object[], clusters:number, groups:number, lineHeight:number}} the same line objects, ordered,
   *   each given `cluster` and `group` (both count up through the page)
   */
  function arrange(lines) {
    const kept = dedupe((lines || []).filter((l) => l && l.box && l.box.w > 0 && l.box.h > 0));
    const medH = median(kept.map((l) => l.box.h));
    const topics = banded(clustersOf(blocks(kept, medH), 3 * medH));
    const out = [];
    let group = 0;
    topics.forEach((topic, cluster) => {
      for (const g of topic.groups) {
        for (const l of g.lines) out.push(Object.assign(l, { cluster, group }));
        group++;
      }
    });
    return { lines: out, clusters: topics.length, groups: group, lineHeight: medH };
  }

  PDFStudy.hwCanvasOrder = { arrange, dedupe, banded };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCanvasOrder;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
