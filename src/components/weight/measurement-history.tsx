import { View } from "react-native";
import { Button, Heading, Panel, RecordRow, SystemState, Value, useKitFormat } from "@/vector";
import { useStore } from "@/lib/store";
import type { MeasurementLogState } from "./use-weight-log";

export function MeasurementHistory({ log }: { log: MeasurementLogState }) {
  const { t, date } = useStore();
  const format = useKitFormat();
  const { rows, fields, reading, limit, setLimit, launch } = log;

  return (
    <>
      <View className="flex-row items-baseline justify-between gap-3">
        <Heading level={3}>{t("history")}</Heading>
        <Value value={format.number(rows.length)} size="xs" tone="muted" />
      </View>
      {!rows.length ? (
        <SystemState kind="empty" message={t("empty")} />
      ) : (
        // One weight per record: the row opens the editor, where it can also be deleted.
        <Panel inset="none">
          {rows.slice(0, limit).map((row) => (
            <RecordRow
              key={row.id}
              time={date(row.measuredAt)}
              title={t(fields[0])}
              value={<Value {...reading(fields[0], row.values[fields[0]])} />}
              onPress={() => launch(row)}
            />
          ))}
        </Panel>
      )}
      {rows.length > limit && (
        <Button variant="ghost" onPress={() => setLimit(limit + 30)}>
          {t("showMore")}
        </Button>
      )}
    </>
  );
}
