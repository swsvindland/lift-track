import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useThemeColor } from "heroui-native";
import { twMerge } from "tailwind-merge";
import { SystemIcon, SystemText as Text } from "@/components/system";
import { ActionMenu } from "@/components/ui";
import type { SetKind } from "@/db";
import { loadValue, setText } from "@/lib/format";
import { parseNumber, toKg, type Units } from "@/lib/metrics";
import type { SetRow as Row } from "@/lib/workouts";

const kindBadges: Record<SetKind, string> = { warmup: "W", working: "", drop: "D", myo: "M" };
const kindNames: Record<SetKind, string> = {
  warmup: "Warm-up",
  working: "Working set",
  drop: "Drop set",
  myo: "Myo-reps",
};

/** Column widths shared by the header and every row, so they line up. */
export const columns = {
  badge: "w-9",
  previous: "flex-1",
  weight: "w-[72px]",
  reps: "w-14",
  rir: "w-11",
  done: "w-11",
};

const clean = (text: string) => text.replace(",", ".").trim();

export function SetRowView({
  row,
  number,
  previous,
  units,
  onChange,
  onComplete,
  onKind,
  onDelete,
}: {
  row: Row;
  /** Working-set number, shown in the badge. */
  number: number;
  previous?: Row;
  units: Units;
  onChange: (patch: {
    weightKg?: number | null;
    reps?: number | null;
    rir?: number | null;
  }) => void;
  onComplete: (patch: {
    weightKg?: number | null;
    reps?: number | null;
    rir?: number | null;
  }) => void;
  onKind: (kind: SetKind) => void;
  onDelete: () => void;
}) {
  const placeholder = useThemeColor("field-placeholder");
  const foreground = useThemeColor("foreground");
  const done = !!row.completedAt;
  const text = {
    weight: row.weightKg !== null ? loadValue(row.weightKg, units) : "",
    reps: row.reps !== null ? String(row.reps) : "",
    rir: row.rir !== null ? String(row.rir) : "",
  };
  const [weight, setWeight] = useState(text.weight);
  const [reps, setReps] = useState(text.reps);
  const [rir, setRir] = useState(text.rir);
  // Inputs keep their own text while typing; when the stored set changes underneath (a commit,
  // completion, Undo, a unit switch), they take the stored values. Adjusted during render, so
  // focus stays where it is.
  const stored = `${text.weight}|${text.reps}|${text.rir}`;
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setWeight(text.weight);
    setReps(text.reps);
    setRir(text.rir);
  }

  /** What the inputs say, as a patch; blank means "use the target". */
  const patch = () => {
    const w = parseNumber(clean(weight));
    const r = parseNumber(clean(reps));
    const x = parseNumber(clean(rir));
    return {
      weightKg: clean(weight) === "" ? null : Number.isFinite(w) ? toKg(w, units) : row.weightKg,
      reps: clean(reps) === "" ? null : Number.isInteger(r) ? r : row.reps,
      rir: clean(rir) === "" ? null : Number.isFinite(x) && x <= 10 ? x : row.rir,
    };
  };
  const commit = () => {
    const next = patch();
    if (next.weightKg !== row.weightKg || next.reps !== row.reps || next.rir !== row.rir)
      onChange(next);
  };

  const input = "h-11 rounded-xl bg-surface-secondary px-1 text-center font-mono text-base";
  const target = {
    weight: row.targetWeightKg !== null ? loadValue(row.targetWeightKg, units) : "",
    reps: row.targetReps !== null ? String(row.targetReps) : "",
  };
  const badge = kindBadges[row.kind] || String(number);
  return (
    <View
      className={twMerge(
        "flex-row items-center gap-1.5 rounded-xl px-1 py-1",
        done && "bg-success-soft"
      )}
    >
      <View className={columns.badge}>
        <ActionMenu
          accessibilityLabel={`${kindNames[row.kind]} ${badge}, options`}
          trigger={
            <Pressable className="h-11 items-center justify-center rounded-xl">
              <Text
                className={twMerge(
                  "font-mono font-semibold",
                  row.kind === "working" ? "text-foreground" : "text-warning"
                )}
              >
                {badge}
              </Text>
            </Pressable>
          }
          sections={[
            {
              title: "Set type",
              actions: (Object.keys(kindNames) as SetKind[]).map((kind) => ({
                key: kind,
                label: kindNames[kind],
                selected: row.kind === kind,
                onPress: () => onKind(kind),
              })),
            },
            {
              actions: [
                {
                  key: "delete",
                  label: "Delete set",
                  icon: "trash-outline",
                  destructive: true,
                  onPress: onDelete,
                },
              ],
            },
          ]}
        />
      </View>
      <Text
        className={twMerge(columns.previous, "font-mono text-xs text-muted")}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {previous ? setText(previous, units, true) : "–"}
      </Text>
      <TextInput
        accessibilityLabel={`Set ${badge} weight`}
        className={twMerge(columns.weight, input)}
        style={{ color: String(foreground) }}
        value={weight}
        placeholder={target.weight || "0"}
        placeholderTextColor={String(placeholder)}
        onChangeText={setWeight}
        onEndEditing={commit}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
      <TextInput
        accessibilityLabel={`Set ${badge} reps`}
        className={twMerge(columns.reps, input)}
        style={{ color: String(foreground) }}
        value={reps}
        placeholder={target.reps || "0"}
        placeholderTextColor={String(placeholder)}
        onChangeText={setReps}
        onEndEditing={commit}
        keyboardType="number-pad"
        selectTextOnFocus
      />
      <TextInput
        accessibilityLabel={`Set ${badge} reps in reserve`}
        className={twMerge(columns.rir, input, "text-sm")}
        style={{ color: String(foreground) }}
        value={rir}
        placeholder={row.targetRir !== null ? String(row.targetRir) : "–"}
        placeholderTextColor={String(placeholder)}
        onChangeText={setRir}
        onEndEditing={commit}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`Set ${badge} done`}
        hitSlop={6}
        onPress={() => onComplete(patch())}
        className={twMerge(
          columns.done,
          "h-11 items-center justify-center rounded-xl",
          done ? "bg-success" : "bg-surface-secondary"
        )}
      >
        <SystemIcon name="checkmark" size={22} color={done ? "success-foreground" : "muted"} />
      </Pressable>
    </View>
  );
}
