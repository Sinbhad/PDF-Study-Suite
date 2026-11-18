/**
 * Chooses the upright view of a page for the line reader: straightens a crooked page (skew-angle.js gives the
 * angle, page-turn.js turns the bitmap) and finds out by reading whether it is upside down or on its side.
 *   open(gray, w, h, deg)       -> view { gray, width, height, angle, frame } (frame null: the page as given)
 *   pageBox(view, box)          -> a box found in the view, as a rectangle of the page as given
 *   planView(view, makePlan)    -> page-prep's plan of the view, without pieces lying off the page
 *   choose(gray, w, h, options) -> { view, plan, reads } after the orientation check
 * Orientation check: the three widest lines are read. When they read well, or one of them reads as sure, real
 * words (a caption on a slide of photographs), the page is upright and those reads are handed back for reuse,
 * so an ordinary page costs nothing extra. Only when they read badly are the same crops read turned by 180
 * degrees (a reversed pixel array, no new page plan; skipped when they read as nothing at all), and, if the
 * page also has lines running up it, the quarter turns. A different orientation is taken only when it reads
 * clearly better.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (ns, file) => PDFStudy[ns] || (typeof require === 'function' ? require(file) : null);
  const turn = () => need('hwPageTurn', './page-turn.js');
  const skew = () => need('hwSkewAngle', './skew-angle.js');

  const PROBES = 3; // lines read to judge an orientation
  const WIDE = 3; // a probe line is at least this many times wider than tall
  const SURE = 0.6; // mean confidence at which the page is taken as upright without looking further
  const BETTER = 0.2; // another orientation must beat the current one by this much mean confidence
  const CLEAR = 0.5; // ...and must itself read at least this well
  const CERTAIN = 0.85; // one probe line read this well, as real words, shows the page is upright on its own

  const keyOf = (b) => `${b.x},${b.y},${b.w},${b.h}`;

  /**
   * The page seen with its text lines level. `deg` is the slope of the lines on the page; when it is not a
   * number the angle is measured here.
   */
  function open(gray, w, h, deg) {
    const T = turn();
    const angle = T.fold(typeof deg === 'number' && isFinite(deg) ? deg : skew().estimate(gray, w, h).angle);
    if (!T.needsTurn(angle)) return { gray, width: w, height: h, angle: 0, frame: null };
    const frame = T.frame(w, h, angle);
    const turned = T.rotate({ data: gray, w, h, ch: 1 }, frame);
    return { gray: turned.data, width: frame.w, height: frame.h, angle, frame };
  }

  /** A box of the view in the pixels of the page as given (the smallest upright rectangle holding all of it). */
  function pageBox(view, box) {
    return view.frame ? view.frame.boxToSource(box) : box;
  }

  /**
   * Page plan of a view (`makePlan` is page-prep's plan). Turning adds corners that are not page: a piece
   * whose middle lies there (grain smeared outwards from the page edge) is left out.
   */
  function planView(view, makePlan) {
    const plan = makePlan(view.gray, view.width, view.height);
    const fr = view.frame;
    if (!fr) return plan;
    const onPage = (box) => {
      const c = fr.toSource(box.x + box.w / 2, box.y + box.h / 2);
      return c.x >= 0 && c.y >= 0 && c.x < fr.srcW && c.y < fr.srcH;
    };
    const lines = [];
    for (const line of plan.lines || []) {
      const regions = (line.regions || []).filter((reg) => onPage(reg.box));
      if (regions.length) lines.push(Object.assign({}, line, { index: lines.length, regions }));
    }
    return Object.assign({}, plan, { lines });
  }

  /**
   * The most line-like pieces of a plan: what the orientation is judged on. Longest for their height first
   * (then widest), so a caption is chosen before a wide block cut out of a photograph. Measured on a real deck
   * of 24 picture slides: by width alone the probes held a sure line of words on 11 of the 14 slides that had
   * one, by shape on all 14.
   */
  function probeBoxes(plan) {
    const boxes = [];
    for (const line of plan.lines || []) for (const reg of line.regions || []) if (reg.box && reg.box.w >= WIDE * reg.box.h) boxes.push(reg.box);
    return boxes.sort((a, b) => b.w / b.h - a.w / a.h || b.w - a.w).slice(0, PROBES);
  }

  /** The same crop turned by 180 degrees. */
  function reversed(crop) {
    return { data: crop.data.slice().reverse(), w: crop.w, h: crop.h };
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

  /**
   * A read that can only come from text the right way up: confidence of CERTAIN or more and real words in it
   * (two or more, or one of six letters). Text turned over or on its side reads as scattered characters.
   */
  function readsAsWords(read) {
    if (!read || !(read.confidence >= CERTAIN)) return false;
    const text = String(read.text || '');
    const words = (text.match(/[A-Za-z]{2,}/g) || []).length;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    return words >= 2 || letters >= 6;
  }

  /**
   * Confidence of each probe line of one view, read as it is (`plain`) and, when asked, turned by 180 degrees
   * (`flipped`). Reads of the lines as they are go into `reads` (box key -> what read() returned). Stops early,
   * `stopped: true`, when o.stopped() says the job was cancelled.
   */
  async function judge(view, plan, o, withFlip, known) {
    const reads = known || new Map();
    const out = { plain: [], flipped: [], reads, stopped: false };
    const halted = () => typeof o.stopped === 'function' && o.stopped();
    for (const box of probeBoxes(plan)) {
      const crop = o.crop(plan, view.gray, view.width, view.height, box);
      if (!reads.has(keyOf(box))) {
        if (halted()) return Object.assign(out, { stopped: true });
        reads.set(keyOf(box), await o.read(crop, plan, box));
      }
      out.plain.push(reads.get(keyOf(box)).confidence || 0);
      if (!withFlip) continue;
      if (halted()) return Object.assign(out, { stopped: true });
      out.flipped.push((await o.read(reversed(crop), plan, box)).confidence || 0);
    }
    return out;
  }

  /**
   * True when the same lines read the other way up are clearly the better read: well read as such, better on
   * average by BETTER, and better by that much on most lines (one line that failed to read must not turn a
   * page over).
   */
  function flipWins(j) {
    const wins = j.flipped.filter((c, i) => c >= j.plain[i] + BETTER).length;
    return mean(j.flipped) >= CLEAR && mean(j.flipped) >= mean(j.plain) + BETTER && wins * 2 > j.flipped.length;
  }

  /**
   * Upright view and page plan for the line reader.
   * @param {{angle?:number, plan:function, crop:function, read?:function, skip?:function, stopped?:function, upright?:boolean}} o
   *   plan(gray, w, h) and crop(plan, gray, w, h, box) are page-prep's; read(crop, plan, box) resolves to what
   *   the page's reader makes of the crop ({ confidence, ... }); without it the page is only straightened.
   *   upright true: the caller knows the page is the right way up (it has typed text): it is only straightened.
   *   skip(plan) true: do not probe this page (it will not be read). stopped() true: the job was cancelled.
   * @returns {Promise<{view:object, plan:object, reads:Map, work:{plans:number, reads:number}}>}
   *   reads: box key -> what read() returned, for reuse; work: page plans made and crops read to decide
   */
  async function choose(gray, w, h, o) {
    const work = { plans: 1, reads: 0 };
    const view = open(gray, w, h, o.angle);
    const plan = planView(view, o.plan);
    const asIs = { view, plan, reads: new Map(), work };
    if (typeof o.read !== 'function' || o.upright === true) return asIs;
    const counted = Object.assign({}, o, {
      read: (...args) => {
        work.reads += 1;
        return o.read(...args);
      },
    });
    const turned = (deg) => {
      const v = open(gray, w, h, deg);
      work.plans += 1;
      return { view: v, plan: planView(v, o.plan), reads: new Map(), work };
    };
    let best = 0;
    let flip = false;
    // a plan that will not be read (a page on its side shatters into hundreds of pieces) is not probed either
    if (!(o.skip && o.skip(plan))) {
      const first = await judge(view, plan, counted, false, asIs.reads);
      if (first.stopped || (first.plain.length && mean(first.plain) >= SURE)) return asIs;
      const firstReads = Array.from(asIs.reads.values());
      // one line that reads as sure, real words settles it, however badly the pictures around it read
      if (firstReads.some(readsAsWords)) return asIs;
      // lines that read as nothing at all are not text either way up: only the quarter turn is still tried
      const blank = firstReads.length > 0 && firstReads.every((r) => !String((r && r.text) || '').trim());
      if (blank) best = mean(first.plain);
      else {
        const again = await judge(view, plan, counted, true, asIs.reads);
        if (again.stopped) return asIs;
        flip = flipWins(again);
        best = flip ? mean(again.flipped) : mean(again.plain);
      }
    }
    let pick = null; // a quarter-turned view, when that reads clearly better still
    const side = skew().estimate(gray, w, h).sideways;
    if (side.strength > 0) {
      const cand = turned(90 + side.angle);
      const s = o.skip && o.skip(cand.plan) ? null : await judge(cand.view, cand.plan, counted, true, cand.reads);
      if (s && s.stopped) return asIs;
      const top = s ? Math.max(mean(s.plain), mean(s.flipped)) : 0;
      if (s && top >= CLEAR && top >= best + BETTER) {
        pick = cand;
        flip = flipWins(s);
      }
    }
    if (pick) return flip ? turned(pick.view.angle + 180) : pick;
    return flip ? turned(view.angle + 180) : asIs;
  }

  PDFStudy.hwUpright = { open, pageBox, planView, choose, keyOf, SURE, BETTER, CERTAIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwUpright;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
