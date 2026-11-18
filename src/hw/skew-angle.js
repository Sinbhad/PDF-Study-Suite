/**
 * Measures how far the writing on a page is turned (a hand-held photo, a scan laid down crooked). DOM-free.
 *   estimate(gray, w, h) -> { angle, strength, sideways: { angle, strength } }
 * `angle` is the slope of the text lines in degrees: positive when a line drops towards the right (image y
 * grows downwards). It is 0 when no clear direction is found, so a drawing or an empty page is never turned.
 *
 * Method: the page is shrunk and flattened (page-flatten.js, so shading and a dark desk do not count as ink),
 * and its darkness is summed along lines at each trial angle. Along the true text direction the sums jump
 * between full (a written line) and empty (the gap under it); at any other angle they smear out. The angle with
 * the sharpest jumps wins: a coarse pass over +-15 degrees, then a fine pass around the best.
 * `sideways` is the same measurement for lines running up the page (a page turned a quarter): callers use it
 * only as a candidate to check by reading, because a ruled margin line or the edge of the sheet also scores there.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (ns, file) => PDFStudy[ns] || (typeof require === 'function' ? require(file) : null);

  const SMALL = 800; // longest side of the copy the angle is measured on
  const MAX_ANGLE = 15; // degrees searched each way
  const COARSE = 0.5;
  const FINE = 0.05;
  const MAX_POINTS = 40000; // ink pixels used; more are thinned evenly
  const MIN_POINTS = 150; // fewer ink pixels than this: nothing to measure
  const FAINT = 24; // darkness below this is paper grain
  /** The best angle must beat the typical angle by this factor, or the page has no clear text direction. */
  const MIN_STRENGTH = 2;
  /** Lines up the page are offered as a candidate only when they are at least this strong beside the level ones. */
  const SIDEWAYS_SHARE = 0.5;

  /** Area-averaged copy shrunk by the whole factor `f`. */
  function shrink(gray, w, h, f) {
    const sw = Math.max(1, Math.floor(w / f));
    const sh = Math.max(1, Math.floor(h / f));
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let sum = 0;
        for (let dy = 0; dy < f; dy++) {
          const o = (y * f + dy) * w + x * f;
          for (let dx = 0; dx < f; dx++) sum += gray[o + dx];
        }
        out[y * sw + x] = sum / (f * f);
      }
    }
    return { data: out, w: sw, h: sh };
  }

  /** Ink pixels of a flattened page as parallel arrays: position and darkness (0..255). */
  function inkPoints(flat, w, h) {
    let count = 0;
    for (let i = 0; i < flat.length; i++) if (255 - flat[i] > FAINT) count++;
    const step = Math.max(1, Math.ceil(count / MAX_POINTS));
    const n = Math.ceil(count / step);
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const ws = new Float32Array(n);
    let seen = 0;
    let k = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dark = 255 - flat[y * w + x];
        if (dark <= FAINT) continue;
        if (seen++ % step) continue;
        xs[k] = x;
        ys[k] = y;
        ws[k] = dark;
        k++;
      }
    }
    return { xs: xs.subarray(0, k), ys: ys.subarray(0, k), ws: ws.subarray(0, k), count: k };
  }

  /**
   * Sharpness of the darkness profile across lines sloped by `deg`: the sum of squared steps between neighbouring
   * profile bins. `along` holds each point's position along a line, `across` its position across the lines.
   */
  function sharpness(along, across, ws, deg, bins, span) {
    const t = Math.tan((deg * Math.PI) / 180);
    const prof = new Float32Array(bins + 2);
    const shift = span * Math.abs(t) + 1;
    for (let i = 0; i < ws.length; i++) {
      const r = across[i] - along[i] * t + shift;
      const b = Math.floor(r);
      const f = r - b;
      prof[b] += ws[i] * (1 - f);
      prof[b + 1] += ws[i] * f;
    }
    // Steps are taken between bins two apart on a profile smoothed over three. At exactly 0 degrees every pixel
    // of a row lands in one bin, with no sharing between neighbours, so the raw profile is at its roughest there
    // whatever the page holds; the smoothing takes that advantage away.
    let sum = 0;
    for (let i = 3; i < prof.length - 1; i++) {
      const here = prof[i - 1] + 2 * prof[i] + prof[i + 1];
      const back = prof[i - 3] + 2 * prof[i - 2] + prof[i - 1];
      const d = here - back;
      sum += d * d;
    }
    return sum;
  }

  const median = (list) => {
    const s = Array.from(list).sort((a, b) => a - b);
    return s[s.length >> 1];
  };

  /** Best line slope within +-MAX_ANGLE for lines running along `along`: { angle, strength, score }. */
  function search(along, across, ws, span, extent) {
    const bins = Math.ceil(extent + 2 * span * Math.tan((MAX_ANGLE * Math.PI) / 180)) + 4;
    const score = (deg) => sharpness(along, across, ws, deg, bins, span);
    const coarse = [];
    for (let a = -MAX_ANGLE; a <= MAX_ANGLE + 1e-9; a += COARSE) coarse.push([a, score(a)]);
    let best = coarse[0];
    for (const c of coarse) if (c[1] > best[1]) best = c;
    const typical = median(coarse.map((c) => c[1]));
    const fine = [];
    for (let a = best[0] - COARSE; a <= best[0] + COARSE + 1e-9; a += FINE) fine.push([a, score(a)]);
    let top = 0;
    for (let i = 1; i < fine.length; i++) if (fine[i][1] > fine[top][1]) top = i;
    let angle = fine[top][0];
    if (top > 0 && top < fine.length - 1) {
      // the peak of the parabola through the best fine step and its two neighbours
      const y0 = fine[top - 1][1];
      const y1 = fine[top][1];
      const y2 = fine[top + 1][1];
      const bend = y0 - 2 * y1 + y2;
      if (bend < 0) angle += (FINE * (y0 - y2)) / (2 * bend);
    }
    const atEdge = Math.abs(best[0]) >= MAX_ANGLE - 1e-9; // still rising at the end of the range: not a real peak
    return { angle, strength: typical > 0 && !atEdge ? fine[top][1] / typical : 0, score: fine[top][1] };
  }

  const NONE = { angle: 0, strength: 0, sideways: { angle: 0, strength: 0 } };

  /**
   * @param {Uint8Array} gray page bitmap (ink dark or light; a dark page is inverted by the flattening)
   * @returns {{angle:number, strength:number, sideways:{angle:number, strength:number}}} degrees; angle 0 when unsure
   */
  function estimate(gray, w, h) {
    if (!gray || w < 16 || h < 16) return NONE;
    const small = shrink(gray, w, h, Math.max(1, Math.ceil(Math.max(w, h) / SMALL)));
    const { flat } = need('hwFlatten', './page-flatten.js').flatten(small.data, small.w, small.h);
    const pts = inkPoints(flat, small.w, small.h);
    if (pts.count < MIN_POINTS) return NONE;
    const level = search(pts.xs, pts.ys, pts.ws, small.w, small.h);
    const turned = search(pts.ys, pts.xs, pts.ws, small.h, small.w);
    const sure = level.strength >= MIN_STRENGTH;
    // lines running up the page: across = x, along = y, so the slope found there has the opposite sense
    const likely = turned.strength >= MIN_STRENGTH && turned.strength >= SIDEWAYS_SHARE * level.strength;
    const sideways = likely ? { angle: -turned.angle, strength: turned.strength } : NONE.sideways;
    return { angle: sure ? level.angle : 0, strength: level.strength, sideways };
  }

  PDFStudy.hwSkewAngle = { estimate, MAX_ANGLE, MIN_STRENGTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwSkewAngle;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
