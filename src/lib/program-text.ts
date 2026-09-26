/* Reads a written program, pasted or photographed and run through text recognition:

     Day 1 – Upper
     1. Bench Press 3x6-8
     Pull-ups: 3 sets of 8–12
     Day 2 – Lower …

   Lines with sets and reps are exercises; other short lines start a new day. The on-device
   model handles layouts this can't. */

export type ParsedSlot = { name: string; sets: number; repMin: number; repMax: number };
export type ParsedDay = { name: string; slots: ParsedSlot[] };
export type ParsedProgram = { days: ParsedDay[]; unread: string[] };

const DASH = "[-–—]";
const RANGE = String.raw`(\d+)(?:\s*(?:${DASH}|to)\s*(\d+))?`;
const patterns = [
  // 3x8-12 · 3 × 8–12 · 3x8
  new RegExp(String.raw`(\d+)\s*[x×*]\s*${RANGE}`, "i"),
  // 3 sets of 8-12 (reps)
  new RegExp(String.raw`(\d+)\s*sets?\s*(?:of|x|×)?\s*${RANGE}`, "i"),
  // sets and reps in columns: "Bench Press   3   8-12"
  new RegExp(String.raw`\s(\d)\s+${RANGE}\s*(?:reps?)?\s*$`, "i"),
];

const clean = (name: string) =>
  name
    .replace(/^\s*(?:[-•*·]|\(?[a-z]?\d+[.)]|[a-z]\d?[.):])\s*/i, "")
    .replace(/[\s:,\-–—]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const dayLike =
  /^(day|week|workout|session|mon|tue|wed|thu|fri|sat|sun|upper|lower|push|pull|legs?|full|arms|chest|back|shoulders|[a-f]\b)/i;

function exerciseLine(line: string): ParsedSlot | null {
  for (const pattern of patterns) {
    const m = pattern.exec(line);
    if (!m) continue;
    const sets = +m[1];
    const repMin = +m[2];
    const repMax = m[3] ? +m[3] : repMin;
    const name = clean(line.slice(0, m.index));
    // A name is words; several numbers in it mean the line was really a whole table.
    const numbers = name.match(/\b\d+\b/g)?.length ?? 0;
    if (!/[a-z]{2}/i.test(name) || name.length > 50 || numbers > 1) continue;
    if (sets < 1 || sets > 10 || repMin < 1 || repMax > 100) continue;
    return { name, sets, repMin: Math.min(repMin, repMax), repMax: Math.max(repMin, repMax) };
  }
  return null;
}

export function parseProgramText(text: string): ParsedProgram {
  const days: ParsedDay[] = [];
  const unread: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const slot = exerciseLine(line);
    if (slot) {
      if (!days.length) days.push({ name: "Day 1", slots: [] });
      days[days.length - 1].slots.push(slot);
      continue;
    }
    const heading = clean(line.replace(/^#+\s*/, ""));
    // A day is named like one ("Day 2", "Push A", "Monday"), ends in a colon, or is in capitals;
    // anything else, such as a note about rest times, isn't read.
    const named =
      dayLike.test(heading) ||
      /:\s*$/.test(line) ||
      (/[A-Z]{3}/.test(heading) && heading === heading.toUpperCase());
    if (heading && heading.length <= 40 && named) {
      if (days.length && !days[days.length - 1].slots.length) days[days.length - 1].name = heading;
      else days.push({ name: heading, slots: [] });
    } else unread.push(line);
  }
  return { days: days.filter((d) => d.slots.length), unread };
}
