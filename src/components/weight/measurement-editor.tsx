import type { ReactNode } from "react";
import { DateInput, Editor, ErrorText, Text } from "@/vector";
import { useStore } from "@/lib/store";
import type { MeasurementLogState } from "./use-weight-log";

export function MeasurementEditor({
  title,
  log,
  children,
}: {
  title: string;
  log: MeasurementLogState;
  children: ReactNode;
}) {
  const { t } = useStore();
  const { editing, open, setOpen, busy, dirty, imported, day, setDay, error, save, remove } = log;
  return (
    <Editor
      title={title}
      open={open}
      close={() => setOpen(false)}
      busy={busy}
      dirty={dirty}
      // Imported records are managed by their source: nothing to save, but they can still be deleted.
      primary={imported ? undefined : { label: t("save"), onPress: save }}
      destructive={editing ? { label: t("delete"), onPress: remove } : undefined}
    >
      {imported && <Text tone="muted">{t("syncHelp")}</Text>}
      <DateInput label={t("date")} value={day} onChange={setDay} disabled={imported} />
      {children}
      <ErrorText message={error} />
    </Editor>
  );
}
