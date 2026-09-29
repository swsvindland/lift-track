import { useState } from "react";
import { Alert } from "react-native";
import { eq } from "drizzle-orm";
import { db, healthLinks, weightEntries } from "@/db";
import { massUnit, useLiftFormat } from "@/lib/format";
import { useStore } from "@/lib/store";
import { dayOf, fromKg, localDay, toKg, validDay } from "@/lib/metrics";
import { parseDecimal, useKitFormat } from "@/vector";

type RecordRow = { id: number; measuredAt: string; values: Record<string, number> };
type Form = { day: string; inputs: Record<string, string> };
export function useWeightLog() {
  const { weights, units, t, refresh } = useStore();
  const { weightText } = useLiftFormat();
  const format = useKitFormat();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [day, setDay] = useState(localDay());
  // The form as it opened: what `dirty` compares against, and what an untouched field still reads.
  const [initial, setInitial] = useState<Form>({ day: localDay(), inputs: {} });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(30);
  const rows: RecordRow[] = weights.map((w) => ({
    id: w.id,
    measuredAt: w.measuredAt,
    values: { weight: w.weightKg },
  }));
  const fields = ["weight"] as const;
  /** The field suffix: the locale's own symbol for the unit. */
  const unit = format.unitParts(2, massUnit(units)).unit;
  const display = (_key: string, value: number) => fromKg(value, units);
  /** A stored weight as Value parts, one decimal always so a column of weights lines up. */
  const reading = (key: string, value: number) => ({
    ...format.unitParts(display(key, value), massUnit(units), 1),
    value: format.number(display(key, value), 1),
  });
  /** Field text in the locale's digits and decimal mark (72,5 in de); parseDecimal reads it back. */
  const seed = (value: number) => format.number(value, Number.isInteger(value) ? 0 : 1);
  const dirty =
    day !== initial.day ||
    Object.keys({ ...initial.inputs, ...inputs }).some(
      (key) => (inputs[key] ?? "") !== (initial.inputs[key] ?? "")
    );
  const imported = editing
    ? db
        .select()
        .from(healthLinks)
        .all()
        .some(
          (link) =>
            link.origin === "health" && link.localKind === "weight" && link.localId === editing.id
        )
    : false;
  function launch(row: RecordRow | null) {
    const form: Form = {
      day: row ? dayOf(row.measuredAt) : localDay(),
      inputs: Object.fromEntries(
        Object.entries(row?.values ?? {}).map(([key, value]) => [
          key,
          seed(Math.round(display(key, value) * 10) / 10),
        ])
      ),
    };
    setEditing(row);
    setError("");
    setDay(form.day);
    setInputs(form.inputs);
    setInitial(form);
    setOpen(true);
  }
  function save() {
    if (busy || imported) return;
    if (!validDay(day)) {
      setError(t("invalidDate"));
      return;
    }
    const values: Record<string, number> = {};
    for (const key of fields) {
      const raw = inputs[key]?.trim();
      // Preserve canonical precision when a field wasn't changed in the editor.
      const original = editing?.values[key];
      const unchanged = original !== undefined && raw === initial.inputs[key];
      const value = unchanged ? original : toKg(parseDecimal(raw ?? "", format.tag) ?? NaN, units);
      if (!Number.isFinite(value) || value <= 0 || value > 500) {
        setError(t("invalidValue", { field: t(key), max: weightText(500, units) }));
        return;
      }
      values[key] = unchanged ? original : Math.round(value * 10000) / 10000;
    }
    if (!Object.keys(values).length) {
      setError(t("invalid"));
      return;
    }
    setBusy(true);
    try {
      const measuredAt =
        editing && dayOf(editing.measuredAt) === day
          ? editing.measuredAt
          : (day === localDay() ? new Date() : new Date(`${day}T12:00:00`)).toISOString();
      if (editing)
        db.update(weightEntries)
          .set({ weightKg: values.weight, measuredAt, updatedAt: new Date() })
          .where(eq(weightEntries.id, editing.id))
          .run();
      else db.insert(weightEntries).values({ weightKg: values.weight, measuredAt }).run();
      refresh();
      setOpen(false);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }
  function remove() {
    if (!editing) return;
    // vector: irreversible
    Alert.alert(t("delete"), t("deleteConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          try {
            db.delete(weightEntries).where(eq(weightEntries.id, editing.id)).run();
            refresh();
            setOpen(false);
          } catch {
            setError(t("error"));
          }
        },
      },
    ]);
  }
  return {
    rows,
    fields,
    unit,
    display,
    reading,
    open,
    editing,
    inputs,
    day,
    error,
    busy,
    dirty,
    imported,
    limit,
    setLimit,
    setOpen,
    setInputs,
    setDay,
    launch,
    save,
    remove,
  };
}

export type MeasurementLogState = ReturnType<typeof useWeightLog>;
