import { useState } from "react";
// eslint-disable-next-line no-restricted-imports -- the set grid's compact inputs (MIGRATION P1.2 sets)
import { Pressable, TextInput, View } from "react-native";
import { twMerge } from "tailwind-merge";
import type { Effort, SetKind } from "@/db";
import { loadValue, useLiftFormat } from "@/lib/format";
import { parseNumber, toKg, type Units } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/translations";
import type { SetRow as Row } from "@/lib/workouts";
import { ActionMenu, Icon, SignalCell, Text, tokens } from "@/vector";
import { EffortDot, effortOf } from "./effort";

const kindBadges: Record<SetKind, Message | ""> = {
  warmup: "setKindWarmupShort",
  working: "",
  drop: "setKindDropShort",
  myo: "setKindMyoShort",
};
const kindNames: Record<SetKind, Message> = {
  warmup: "setKindWarmup",
  working: "setKindWorking",
  drop: "setKindDrop",
  myo: "setKindMyo",
};

/** Column widths shared by the header and every row, so they line up. */
export const columns = {
  badge: "w-9",
  previous: "flex-1",
  weight: "w-18",
  reps: "w-14",
  rir: "w-11",
  done: "w-11",
};

/**
 * For the grid's column-header Labels (one line by default): shrinking to 80% before a fixed column clips them,
 * capped so the grid keeps its shape.
 */
export const fitted = {
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.8,
  maxFontSizeMultiplier: 1.3,
} as const;

const clean = (text: string) => text.replace(",", ".").trim();

export function SetRowView({
  row,
  number,
  previous,
  units,
  onChange,
  onComplete,
  onKind,
  onEffort,
  onDelete,
}: {
  row: Row;
  /** Working-set number, shown in the badge. */
  number: number;
  previous?: Row;
  units: Units;
  onChange: (patch: { weightKg?: number | null; reps?: number | null }) => void;
  onComplete: (patch: { weightKg?: number | null; reps?: number | null }) => void;
  onKind: (kind: SetKind) => void;
  onEffort: (effort: Effort | null) => void;
  onDelete: () => void;
}) {
  const { t } = useStore();
  const { setText } = useLiftFormat();
  const done = !!row.completedAt;
  const text = {
    weight: row.weightKg !== null ? loadValue(row.weightKg, units) : "",
    reps: row.reps !== null ? String(row.reps) : "",
  };
  const [weight, setWeight] = useState(text.weight);
  const [reps, setReps] = useState(text.reps);
  // Inputs keep their own text while typing; when the stored set changes underneath (a commit,
  // completion, Undo, a unit switch), they take the stored values. Adjusted during render, so
  // focus stays where it is.
  const stored = `${text.weight}|${text.reps}`;
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setWeight(text.weight);
    setReps(text.reps);
  }

  /** What the inputs say, as a patch; blank means "use the target". */
  const patch = () => {
    const w = parseNumber(clean(weight));
    const r = parseNumber(clean(reps));
    return {
      weightKg: clean(weight) === "" ? null : Number.isFinite(w) ? toKg(w, units) : row.weightKg,
      reps: clean(reps) === "" ? null : Number.isInteger(r) ? r : row.reps,
    };
  };
  const commit = () => {
    const next = patch();
    if (next.weightKg !== row.weightKg || next.reps !== row.reps) onChange(next);
  };

  // The set grid keeps its own compact inputs (Field is too wide for a row of four), in the field's tokens.
  const input =
    "h-11 rounded-control border border-field-border bg-field px-1 text-center text-field-foreground focus:border-focus";
  const inputFont = { fontFamily: tokens.fonts.mono, fontSize: 16 };
  const target = {
    weight: row.targetWeightKg !== null ? loadValue(row.targetWeightKg, units) : "",
    reps: row.targetReps !== null ? String(row.targetReps) : "",
  };
  const kindBadge = kindBadges[row.kind];
  const badge = kindBadge ? t(kindBadge) : String(number);
  const set = t("setBadge", { badge });
  return (
    <View className="flex-row items-center gap-1.5 px-1 py-1">
      <View className={columns.badge}>
        <ActionMenu
          accessibilityLabel={t("setKindOptions", { kind: t(kindNames[row.kind]), badge })}
          trigger={
            // 36pt wide in the grid; the slop makes the target 44.
            <Pressable
              hitSlop={4}
              className="h-11 items-center justify-center rounded-control active:bg-surface-secondary"
            >
              {/* Warm-up, drop and myo sets read as a muted letter; working sets as their number. */}
              <Text variant="readoutS" tone={row.kind === "working" ? "default" : "muted"}>
                {badge}
              </Text>
            </Pressable>
          }
          sections={[
            {
              title: t("setType"),
              actions: (Object.keys(kindNames) as SetKind[]).map((kind) => ({
                key: kind,
                label: t(kindNames[kind]),
                selected: row.kind === kind,
                onPress: () => onKind(kind),
              })),
            },
            {
              actions: [
                {
                  key: "delete",
                  label: t("deleteSet"),
                  icon: "delete",
                  destructive: true,
                  onPress: onDelete,
                },
              ],
            },
          ]}
        />
      </View>
      <View className={columns.previous}>
        {/* The one flexible column: a long line wraps inside the row's 44pt height instead of clipping. */}
        <Text variant="readoutXS" tone="muted" maxFontSizeMultiplier={fitted.maxFontSizeMultiplier}>
          {previous ? setText(previous, units, true) : "–"}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={t("setWeight", { set })}
        className={twMerge(columns.weight, input)}
        style={inputFont}
        maxFontSizeMultiplier={fitted.maxFontSizeMultiplier}
        value={weight}
        placeholder={target.weight || "0"}
        placeholderTextColorClassName="accent-field-placeholder"
        selectionColorClassName="accent-tint"
        onChangeText={setWeight}
        onEndEditing={commit}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
      <TextInput
        accessibilityLabel={t("setReps", { set })}
        className={twMerge(columns.reps, input)}
        style={inputFont}
        maxFontSizeMultiplier={fitted.maxFontSizeMultiplier}
        value={reps}
        placeholder={target.reps || "0"}
        placeholderTextColorClassName="accent-field-placeholder"
        selectionColorClassName="accent-tint"
        onChangeText={setReps}
        onEndEditing={commit}
        keyboardType="number-pad"
        selectTextOnFocus
      />
      {row.kind === "warmup" ? (
        <View className={columns.rir} />
      ) : (
        <EffortDot effort={effortOf(row)} label={set} onChange={onEffort} />
      )}
      {/* Done is the selection look (the icon): signal fill with a signal-ink check; the check is the cue. */}
      <SignalCell
        selected={done}
        accessibilityRole="checkbox"
        accessibilityLabel={t("setDone", { set })}
        onPress={() => onComplete(patch())}
        className={twMerge(columns.done, "p-0")}
      >
        <Icon name="check" size={24} tone="muted" />
      </SignalCell>
    </View>
  );
}
