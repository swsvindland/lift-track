/* Turns a typed or dictated workout into exercises and sets, without a model:
   "bench 225x5x3, incline db 30s for 12 12 10, pull ups bw 3x8 rir 2".
   Covers the shorthand lifters write; the on-device model handles anything looser. */

export type LoadUnit = "kg" | "lb";
export type ParsedSet = {
  weight: number | null;
  unit: LoadUnit | null;
  reps: number;
  rir: number | null;
};
export type ParsedExercise = { name: string; sets: ParsedSet[] };
export type ParsedWorkout = { exercises: ParsedExercise[]; unread: string[] };

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const X = String.raw`\s*[x×*]\s*`;
const unitOf = (text: string): LoadUnit | null =>
  /\b(kg|kgs|kilos?)\b/i.test(text) ? "kg" : /\b(lb|lbs|pounds?)\b/i.test(text) ? "lb" : null;
const num = (text: string) => Number(text.replace(",", "."));

const numberWords: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  fifteen: "15",
  twenty: "20",
};

/** Dictation writes "three sets of ten at 100 pounds"; make it look typed. */
function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/g,
      (w) => numberWords[w]
    )
    .replace(/\b(\d+)\s*(?:by|times)\s*(\d+)/g, "$1x$2")
    .replace(/(\d)\s*s\b/g, "$1") // "30s" dumbbells
    .replace(/\s+/g, " ")
    .trim();
}

/** One chunk: an exercise name followed by what was done. */
function parseChunk(raw: string): ParsedExercise | null {
  const text = normalize(raw);
  const first = text.search(/\d|\bbw\b|\bbodyweight\b/);
  if (first <= 0) return null;
  const name = text
    .slice(0, first)
    .replace(/[:\-–—,@]+\s*$/, "")
    .trim();
  const rest = text.slice(first);
  // Prose ("the first two were 40 for twelve") isn't shorthand; leave it for the model.
  if (!/[a-z]/.test(name) || /\b(the|were|was|did|first|last|then|my|some|one|two)\b/.test(name))
    return null;
  const unit = unitOf(rest);
  const bodyweight = /\b(bw|bodyweight)\b/.test(rest);
  const rirMatch = /\b(?:rir\s*(\d+)|(\d+)\s*rir|(\d+)\s*in reserve)\b/.exec(rest);
  const rir = rirMatch ? num(rirMatch[1] ?? rirMatch[2] ?? rirMatch[3]) : null;
  const body = rest.replace(/\b(?:rir\s*\d+|\d+\s*rir|\d+\s*in reserve)\b/g, " ");
  const sets = (weight: number | null, reps: number[]) =>
    reps
      .filter((r) => r > 0 && r <= 100)
      .map((r) => ({ weight, unit: weight ? unit : null, reps: r, rir }));

  let m: RegExpExecArray | null;
  // 3x10 @ 50 · 3 sets of 10 at 50
  if (
    (m = new RegExp(String.raw`(\d+)${X}(\d+)\s*(?:@|at)\s*${NUM}`).exec(body)) ||
    (m = new RegExp(
      String.raw`(\d+)\s*sets? of\s*(\d+)(?:\s*reps?)?\s*(?:@|at|with)\s*${NUM}`
    ).exec(body))
  )
    return { name, sets: sets(num(m[3]), Array(Math.min(20, +m[1])).fill(+m[2])) };
  // 225x5x3 — load, reps, sets
  if ((m = new RegExp(String.raw`${NUM}${X}(\d+)${X}(\d+)`).exec(body)))
    return { name, sets: sets(num(m[1]), Array(Math.min(20, +m[3])).fill(+m[2])) };
  // 100 for 8 8 7 · 100: 8, 8, 7
  if (
    (m = new RegExp(
      String.raw`${NUM}\s*(?:kg|kgs|lbs?|pounds?|kilos?)?\s*(?:for|:)\s*((?:\d+[\s,/]*)+)`
    ).exec(body))
  )
    return { name, sets: sets(num(m[1]), m[2].match(/\d+/g)!.map(Number)) };
  // 8, 8, 7 at 100
  if (
    (m = new RegExp(String.raw`((?:\d+[\s,/]+)*\d+)\s*(?:reps?\s*)?(?:@|at)\s*${NUM}`).exec(body))
  )
    return { name, sets: sets(num(m[2]), m[1].match(/\d+/g)!.map(Number)) };
  // 3 sets of 10 · 3x10 (no load: bodyweight, or sets × reps)
  if (
    (m = new RegExp(String.raw`(\d+)\s*sets? of\s*(\d+)`).exec(body)) ||
    (m = new RegExp(String.raw`(\d+)${X}(\d+)`).exec(body))
  ) {
    const a = +m[1];
    const b = +m[2];
    // "100x8" is a load and reps; "3x10" is sets and reps.
    if (!bodyweight && (a > 10 || unit)) return { name, sets: sets(a, [b]) };
    return { name, sets: sets(bodyweight ? 0 : null, Array(Math.min(20, a)).fill(b)) };
  }
  return null;
}

const split = (text: string) =>
  text
    .split(/\n|;|,?\s+then\s+|\.\s+(?=[a-z])/i)
    .flatMap((part) =>
      // A comma starts a new exercise only when letters follow ("…x3, incline db 30 for 12").
      part.split(/,\s*(?=[a-z]{2,}(?:\s|$))/i)
    )
    .map((part) => part.trim())
    .filter(Boolean);

export function parseWorkoutText(text: string): ParsedWorkout {
  const exercises: ParsedExercise[] = [];
  const unread: string[] = [];
  for (const chunk of split(text)) {
    const parsed = parseChunk(chunk);
    if (parsed?.sets.length) exercises.push(parsed);
    else unread.push(chunk);
  }
  return { exercises, unread };
}
