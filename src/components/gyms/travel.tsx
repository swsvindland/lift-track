import { useState } from "react";
import { View } from "react-native";
import {
  Chip,
  SystemButton,
  SystemIcon,
  SystemIconButton,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { Editor } from "@/components/ui";
import { useQuery, write } from "@/lib/data";
import { gymPresets, presetGym, type GymKind } from "@/lib/loads";
import { localDay, shortDay } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { activeGym, addGym, endTravel, listGyms, startTravel, travelPlan } from "@/lib/workouts";
import { gymSummary } from "./gym-summary";

/** Presets offered for a trip; a full gym is rarely what you find on the road. */
const tripKinds: GymKind[] = ["hotel", "apartment", "none", "home", "full"];

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000);

type Props = { open: boolean; close: () => void };

/** Where you'll train while away and until when. */
export function TravelSheet(props: Props) {
  return props.open ? <OpenTravelSheet {...props} /> : null;
}

function OpenTravelSheet({ open, close }: Props) {
  const { units, language } = useStore();
  const today = localDay();
  const data = useQuery(() => {
    const main = activeGym(units);
    return { main, gyms: listGyms(units).filter((g) => g.id !== main.id), trip: travelPlan() };
  }, [units]);
  // A saved gym by id, or a preset to create on Start.
  const [choice, setChoice] = useState<number | GymKind>(
    () => data.trip?.gym.id ?? data.gyms.at(-1)?.id ?? "hotel"
  );
  const [until, setUntil] = useState(data.trip?.until ?? addDays(today, 6));
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

  return (
    <Editor
      title={data.trip ? "Change your trip" : "Traveling"}
      open={open}
      close={close}
      footer={
        <SystemButton isDisabled={!chosen} onPress={start}>
          {data.trip ? "Save" : "Start trip"}
        </SystemButton>
      }
    >
      <Text className="text-muted">
        Program sessions swap each exercise this gym can&apos;t do for the closest one it can, with
        loads it can make. Your program keeps its place. Back home, loads pick up from before you
        left.
      </Text>
      <View className="gap-2">
        <SystemLabel>Where you&apos;ll train</SystemLabel>
        <View className="flex-row flex-wrap gap-2">
          {data.gyms.map((g) => (
            <Chip
              key={g.id}
              label={g.name}
              selected={choice === g.id}
              onPress={() => setChoice(g.id)}
            />
          ))}
          {tripKinds.map((kind) => (
            <Chip
              key={kind}
              label={`+ ${gymPresets[kind].name}`}
              selected={choice === kind}
              onPress={() => setChoice(kind)}
            />
          ))}
        </View>
        {chosen && (
          <Text className="text-sm text-muted">
            {gymSummary(chosen)}
            {typeof choice === "number"
              ? ""
              : ". Saved as a new gym you can change in Settings › Gyms."}
          </Text>
        )}
      </View>
      <View className="gap-2">
        <SystemLabel>Last day there</SystemLabel>
        <SystemPanel className="flex-row items-center justify-between gap-3">
          <SystemIconButton
            icon="remove"
            accessibilityLabel="One day earlier"
            isDisabled={until <= today}
            onPress={() => setUntil(addDays(until, -1))}
          />
          <View className="flex-1 items-center">
            <Text className="text-lg font-semibold">{shortDay(until, language, true)}</Text>
            <Text className="text-sm text-muted">
              {days} {days === 1 ? "day" : "days"}
            </Text>
          </View>
          <SystemIconButton
            icon="add"
            accessibilityLabel="One day later"
            isDisabled={days >= 90}
            onPress={() => setUntil(addDays(until, 1))}
          />
        </SystemPanel>
        <View className="flex-row flex-wrap gap-2">
          {[
            ["Weekend", 3],
            ["A week", 7],
            ["Two weeks", 14],
          ].map(([label, n]) => (
            <Chip
              key={label}
              label={String(label)}
              selected={days === n}
              onPress={() => setUntil(addDays(today, Number(n) - 1))}
            />
          ))}
        </View>
      </View>
      {data.trip && (
        <SystemButton
          variant="secondary"
          icon="home-outline"
          onPress={() => {
            write(endTravel);
            close();
          }}
        >
          I&apos;m back
        </SystemButton>
      )}
    </Editor>
  );
}

/** Shows a trip in progress, with a way to end it early. Nothing when you're home. */
export function TravelBanner({ onEdit }: { onEdit?: () => void }) {
  const { language } = useStore();
  const trip = useQuery(() => travelPlan(), []);
  if (!trip) return null;
  return (
    <SystemPanel className="gap-2">
      <View className="flex-row items-center gap-2">
        <SystemIcon name="airplane-outline" size={18} color="muted" />
        <Text className="flex-1 font-semibold">Traveling · {trip.gym.name}</Text>
      </View>
      <Text className="text-sm text-muted">
        Through {shortDay(trip.until, language, true)}. Sessions use what&apos;s there; your usual
        loads pick up when you&apos;re back.
      </Text>
      <View className="flex-row gap-2">
        {onEdit && (
          <SystemButton variant="ghost" className="flex-1" onPress={onEdit}>
            Change
          </SystemButton>
        )}
        <SystemButton
          variant="secondary"
          className="flex-1"
          icon="home-outline"
          onPress={() => write(endTravel)}
        >
          I&apos;m back
        </SystemButton>
      </View>
    </SystemPanel>
  );
}
