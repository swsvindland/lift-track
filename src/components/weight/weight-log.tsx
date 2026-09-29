import { Button, DetailScreen } from "@/vector";
import { useStore } from "@/lib/store";
import { useWeightLog } from "./use-weight-log";
import { WeightChart } from "@/components/progress/weight-chart";
import { WeightForm } from "./weight-form";
import { MeasurementHistory } from "./measurement-history";

export function WeightLog() {
  const { t } = useStore();
  const log = useWeightLog();
  return (
    <>
      <DetailScreen title={t("weight")}>
        <WeightChart />
        <Button onPress={() => log.launch(null)}>{t("addWeight")}</Button>
        <MeasurementHistory log={log} />
      </DetailScreen>
      <WeightForm log={log} />
    </>
  );
}
