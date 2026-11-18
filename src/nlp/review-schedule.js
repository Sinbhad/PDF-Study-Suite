/**
 * Spaced-repetition scheduler for flashcards (DOM-free). Written for this project from the published
 * description of SM-2: every card has an ease factor and an interval in days; a good answer multiplies
 * the interval by the ease, a failed answer starts the card again. Four answers instead of SM-2's six:
 *   again -> forgotten: back in today's queue, ease - 0.20
 *   hard  -> remembered with effort: interval x 1.2, ease - 0.15
 *   good  -> remembered: 1 day, then 6 days, then interval x ease
 *   easy  -> effortless: like good, with a bonus on the interval, ease + 0.15
 * Schedule shape: { reps, lapses, interval (days), ease, due (ms), last (ms) }.
 * Due dates are whole local days, so "due today" means the same thing all day.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const GRADES = ['again', 'hard', 'good', 'easy'];
  const START_EASE = 2.5;
  const MIN_EASE = 1.3;
  const FIRST_INTERVAL = 1;
  const SECOND_INTERVAL = 6;
  const EASY_FIRST_INTERVAL = 4;
  const EASY_BONUS = 1.3;
  const HARD_FACTOR = 1.2;
  const MAX_INTERVAL = 365;

  const fresh = () => ({ reps: 0, lapses: 0, interval: 0, ease: START_EASE, due: 0, last: 0 });

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Midnight `days` local days after `ms` (calendar arithmetic, so daylight saving cannot drift it). */
  function addDays(ms, days) {
    const d = new Date(startOfDay(ms));
    d.setDate(d.getDate() + days);
    return d.getTime();
  }

  function nextInterval(s, grade) {
    if (grade === 'again') return 0;
    if (grade === 'hard') return s.reps === 0 ? FIRST_INTERVAL : Math.max(s.interval + 1, Math.round(s.interval * HARD_FACTOR));
    if (grade === 'easy') {
      if (s.reps === 0) return EASY_FIRST_INTERVAL;
      return Math.max(s.interval + 1, Math.round(s.interval * (s.ease + 0.15) * EASY_BONUS));
    }
    if (s.reps === 0) return FIRST_INTERVAL;
    if (s.reps === 1) return Math.max(s.interval + 1, SECOND_INTERVAL);
    return Math.max(s.interval + 1, Math.round(s.interval * s.ease));
  }

  function nextEase(ease, grade) {
    const delta = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 }[grade];
    return Math.max(MIN_EASE, Math.round((ease + delta) * 100) / 100);
  }

  /** The schedule after answering `grade` at time `now`; the input is not modified. */
  function answer(schedule, grade, now) {
    if (!GRADES.includes(grade)) throw new Error(`Unknown grade: ${grade}`);
    const s = { ...fresh(), ...(schedule || {}) };
    const interval = Math.min(MAX_INTERVAL, nextInterval(s, grade));
    const failed = grade === 'again';
    return {
      reps: failed ? 0 : s.reps + 1,
      lapses: s.lapses + (failed && s.reps > 0 ? 1 : 0),
      interval,
      ease: nextEase(s.ease, grade),
      due: failed ? now : addDays(now, interval),
      last: now,
    };
  }

  /** A card that was never answered is new, and new cards are due straight away. */
  const isDue = (schedule, now) => !schedule || !schedule.last || schedule.due <= now;

  /** Days until each answer would bring the card back: { again: 0, hard: 1, good: 1, easy: 4 }. */
  function preview(schedule) {
    const s = { ...fresh(), ...(schedule || {}) };
    const out = {};
    GRADES.forEach((g) => { out[g] = Math.min(MAX_INTERVAL, nextInterval(s, g)); });
    return out;
  }

  /** 0 -> 'today', 1 -> '1d', 45 -> '6w', 200 -> '7mo'. */
  function intervalLabel(days) {
    if (days <= 0) return 'today';
    if (days < 14) return `${days}d`;
    if (days < 60) return `${Math.round(days / 7)}w`;
    return `${Math.round(days / 30)}mo`;
  }

  /** Earliest due time among schedules that are not due yet (0 when there is none). */
  function nextDue(schedules, now) {
    const later = (schedules || []).filter((s) => s && s.last && s.due > now).map((s) => s.due);
    return later.length ? Math.min(...later) : 0;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '12 Nov' (the year is added when it is not the current one). */
  function shortDate(ms, now) {
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date(now === undefined ? Date.now() : now).getFullYear();
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
  }

  /** 'today', 'tomorrow' or 'on 21 Nov', for "the next card is due …". */
  function dayLabel(ms, now) {
    if (ms < addDays(now, 1)) return 'today';
    if (ms < addDays(now, 2)) return 'tomorrow';
    return `on ${shortDate(ms, now)}`;
  }

  const api = { GRADES, START_EASE, MIN_EASE, fresh, answer, isDue, preview, intervalLabel, nextDue, startOfDay, addDays, shortDate, dayLabel };
  PDFStudy.reviewSchedule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
