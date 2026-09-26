import { useState } from "react";
import { Alert } from "react-native";
import { eq } from "drizzle-orm";
import { db, healthLinks, weightEntries } from "@/db";
import { useStore } from "@/lib/store";
import { dayOf, fromKg, localDay, parseNumber, toKg, validDay, weightUnit } from "@/lib/metrics";

type RecordRow = { id: number; measuredAt: string; values: Record<string, number> };
export function useWeightLog() {
  const { weights, units, t, number, refresh } = useStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [day, setDay] = useState(localDay());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(30);
  const rows: RecordRow[] = weights.map((w) => ({
    id: w.id,
    measuredAt: w.measuredAt,
    values: { weight: w.weightKg },
  }));
  const fields = ["weight"];
  const unit = weightUnit(units);
  const display = (_key: string, value: number) => fromKg(value, units);
  const format = (key: string, value: number) => `${number(display(key, value))} ${unit}`;
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
    setEditing(row);
    setError("");
    setDay(row ? dayOf(row.measuredAt) : localDay());
    setInputs(
      Object.fromEntries(
        Object.entries(row?.values ?? {}).map(([key, value]) => [
          key,
          String(Math.round(display(key, value) * 10) / 10),
        ])
      )
    );
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
      const unchanged =
        original !== undefined && raw === String(Math.round(display(key, original) * 10) / 10);
      const value = unchanged ? original : toKg(parseNumber(raw ?? ""), units);
      if (!Number.isFinite(value) || value <= 0 || value > 500) {
        setError(`${t(key)}: ${t("invalid")} (0–${format(key, 500)})`);
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
    format,
    open,
    editing,
    inputs,
    day,
    error,
    busy,
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
