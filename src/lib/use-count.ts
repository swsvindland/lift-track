import { useKitFormat } from "@/vector";
import { useStore } from "./store";
import type { Message } from "./translations";

/**
 * "1 set", "3 sets": the locale's plural category picks the template, and the number is locale-formatted.
 * `one` is the template for the singular category ("{n} set"), `other` for everything else.
 */
export function useCount() {
  const { t } = useStore();
  const format = useKitFormat();
  return (n: number, one: Message, other: Message, digits = 0) =>
    t(format.plural(n) === "one" ? one : other, { n: format.number(n, digits) });
}
