import { useState } from "react";
import { View } from "react-native";
import { useQuery, write } from "@/lib/data";
import { gymPresets, presetGym, type GymKind } from "@/lib/loads";
import { localDay, shortDay } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import { activeGym, addGym, endTravel, listGyms, startTravel, travelPlan } from "@/lib/workouts";
import {
  Button,
  ChipRow,
  Editor,
  Label,
  Meta,
  Note,
  Panel,
  Status,
  Stepper,
  Text,
  useKitStrings,
} from "@/vector";
import { useGymSummary } from "./gym-summary";

/** Presets offered for a trip; a full gym is rarely what you find on the road. */
const tripKinds: GymKind[] = ["hotel", "apartment", "none", "home", "full"];
/** Trip lengths offered as one tap, in days. */
const tripLengths = ["3", "7", "14"] as const;
const MAX_DAYS = 90;

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000);

/** A saved gym (by id) or a preset kind, as one chip key. */
const gymKey = (id: number) => `gym:${id}`;

type Props = { open: boolean; close: () => void };

/** Where you'll train while away and until when. */
export function TravelSheet(props: Props) {
  return props.open ? <OpenTravelSheet {...props} /> : null;
}

function OpenTravelSheet({ open, close }: Props) {
  const { units, locale, t } = useStore();
  const strings = useKitStrings();
  const count = useCount();
  const summary = useGymSummary();
  const today = localDay();
  const data = useQuery(() => {
    const main = activeGym(units);
    return { main, gyms: listGyms(units).filter((g) => g.id !== main.id), trip: travelPlan() };
  }, [units]);
  // A saved gym by id, or a preset to create on Start.
  const [initialChoice] = useState<number | GymKind>(
    () => data.trip?.gym.id ?? data.gyms.at(-1)?.id ?? "hotel"
  );
  const [choice, setChoice] = useState(initialChoice);
  const [initialUntil] = useState(() => data.trip?.until ?? addDays(today, 6));
  const [until, setUntil] = useState(initialUntil);
  const unit = units === "metric" ? "kg" : "lb";
  const chosen =
    typeof choice === "number"
      ? data.gyms.find((g) => g.id === choice)
      : { ...presetGym(choice, unit), id: undefined };
  const days = daysBetween(today, until) + 1;

  const start = () => {
    write(() => {
      const gymId = typeof choice === "number" ? choice : addGym(presetGym(choice, unit));
      startTravel(gymId, until);
    });
    close();
  };

  const saved = data.gyms.map((g) => gymKey(g.id));
  const pick = (key: string | null) => {
    // Tapping the chosen gym again keeps it: a trip always has somewhere to train.
    if (!key) return;
    const gym = data.gyms.find((g) => gymKey(g.id) === key);
    setChoice(gym ? gym.id : (key as GymKind));
  };

  return (
    <Editor
      title={data.trip ? t("changeYourTrip") : t("traveling")}
      open={open}
      close={close}
      dirty={choice !== initialChoice || until !== initialUntil}
      primary={{
        label: data.trip ? strings.save : t("startTrip"),
        onPress: start,
        disabled: !chosen,
      }}
    >
      <Text tone="muted">{t("travelSheetIntro")}</Text>
      <View className="gap-2">
        <Label accessibilityRole="header">{t("whereYouTrain")}</Label>
        {/* Your gyms first; after the divider, presets that are saved as a new gym on Start. */}
        <ChipRow
          values={[...saved, ...tripKinds]}
          groups={saved.length ? [saved, tripKinds] : undefined}
          value={typeof choice === "number" ? gymKey(choice) : choice}
          onChange={pick}
          label={(key) =>
            data.gyms.find((g) => gymKey(g.id) === key)?.name ?? gymPresets[key as GymKind].name
          }
          accessibilityLabel={t("whereYouTrain")}
        />
        {chosen && <Meta items={summary(chosen)} />}
        {chosen && typeof choice !== "number" && <Note>{t("savedAsNewGym")}</Note>}
      </View>
      <View className="gap-2">
        <Label accessibilityRole="header">{t("lastDayThere")}</Label>
        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
          <Stepper
            value={days}
            min={1}
            max={MAX_DAYS}
            label={t("lastDayThere")}
            format={(n) => shortDay(addDays(today, n - 1), locale, true)}
            onChange={(n) => setUntil(addDays(today, n - 1))}
          />
          <Note>{count(days, "dayCountOne", "dayCount")}</Note>
        </View>
        <ChipRow
          values={tripLengths}
          value={tripLengths.find((n) => Number(n) === days) ?? null}
          onChange={(n) => n && setUntil(addDays(today, Number(n) - 1))}
          label={(n) => t(n === "3" ? "weekend" : n === "7" ? "oneWeek" : "twoWeeks")}
          accessibilityLabel={t("tripLength")}
        />
      </View>
      {data.trip && (
        <Button
          variant="secondary"
          className="self-start"
          onPress={() => {
            write(endTravel);
            close();
          }}
        >
          {t("endTrip")}
        </Button>
      )}
    </Editor>
  );
}

/** Shows a trip in progress, with a way to end it early. Nothing when you're home. */
export function TravelBanner({ onEdit }: { onEdit?: () => void }) {
  const { locale, t } = useStore();
  const trip = useQuery(() => travelPlan(), []);
  if (!trip) return null;
  return (
    <Panel>
      <Status state="live" label={t("traveling")} />
      <Panel.Title>{trip.gym.name}</Panel.Title>
      <Panel.Description>
        {t("travelBannerBody", { date: shortDay(trip.until, locale, true) })}
      </Panel.Description>
      <Panel.Footer>
        {onEdit && (
          <Button variant="ghost" onPress={onEdit}>
            {t("changeTrip")}
          </Button>
        )}
        <Button variant="secondary" onPress={() => write(endTravel)}>
          {t("endTrip")}
        </Button>
      </Panel.Footer>
    </Panel>
  );
}
