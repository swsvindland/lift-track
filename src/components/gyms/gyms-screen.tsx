import { useState } from "react";
import { Pressable, View } from "react-native";
import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import {
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { Screen } from "@/components/ui";
import { useQuery } from "@/lib/data";
import { gymKinds, gymPresets, presetGym } from "@/lib/loads";
import { useStore } from "@/lib/store";
import { activeGym, listGyms, travelPlan } from "@/lib/workouts";
import { GymEditor, type EditableGym } from "./gym-editor";
import { gymSummary } from "./gym-summary";
import { TravelBanner, TravelSheet } from "./travel";

/** Your gyms, a main one among them, and where you're training while away. */
export function GymsScreen() {
  const { units } = useStore();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const data = useQuery(
    () => ({ gyms: listGyms(units), main: activeGym(units), trip: travelPlan() }),
    [units]
  );
  const [editing, setEditing] = useState<EditableGym | null>(null);
  const [traveling, setTraveling] = useState(false);
  const unit = units === "metric" ? "kg" : "lb";

  return (
    <>
      <Screen title="Gyms" nativeHeader>
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Gyms",
            headerBackButtonDisplayMode: "minimal",
            headerStyle: { backgroundColor: background },
            headerTintColor: foreground,
            contentStyle: { backgroundColor: background },
          }}
        />
        {data.trip ? (
          <TravelBanner onEdit={() => setTraveling(true)} />
        ) : (
          <SystemPanel className="gap-3">
            <Text className="font-semibold">Traveling?</Text>
            <Text className="text-sm text-muted">
              Pick the gym you&apos;ll use and your last day there. Sessions adapt until then, and
              your program carries on when you&apos;re back.
            </Text>
            <SystemButton
              variant="secondary"
              icon="airplane-outline"
              onPress={() => setTraveling(true)}
            >
              I&apos;m traveling
            </SystemButton>
          </SystemPanel>
        )}

        <View className="gap-2">
          <SystemLabel>Your gyms</SystemLabel>
          {data.gyms.map((gym) => (
            <Pressable
              key={gym.id}
              accessibilityRole="button"
              onPress={() => setEditing(gym)}
              className="flex-row items-center gap-3 rounded-2xl bg-surface p-4 active:opacity-70"
            >
              <View className="flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text className="font-semibold" numberOfLines={1}>
                    {gym.name}
                  </Text>
                  {gym.id === data.main.id && <Badge label="Main" />}
                  {gym.id === data.trip?.gym.id && <Badge label="Traveling" />}
                </View>
                <Text className="text-sm text-muted" numberOfLines={2}>
                  {gymSummary(gym)}
                </Text>
              </View>
              <SystemIcon name="chevron-forward" color="muted" />
            </Pressable>
          ))}
        </View>

        <View className="gap-2">
          <SystemLabel>Add a gym</SystemLabel>
          <SystemPanel className="gap-1">
            {gymKinds.map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                onPress={() => setEditing(presetGym(kind, unit))}
                className="min-h-11 flex-row items-center gap-3 py-2 active:opacity-60"
              >
                <View className="flex-1 gap-0.5">
                  <Text>{gymPresets[kind].name}</Text>
                  <Text className="text-sm text-muted">{gymPresets[kind].description}</Text>
                </View>
                <SystemIcon name="add" size={18} color="muted" />
              </Pressable>
            ))}
          </SystemPanel>
          <Text className="text-sm text-muted">
            Each starts from typical equipment; turn equipment and single exercises on or off to
            match the real thing.
          </Text>
        </View>
      </Screen>
      {editing && (
        <GymEditor
          open
          close={() => setEditing(null)}
          gym={editing}
          isMain={editing.id === data.main.id}
        />
      )}
      <TravelSheet open={traveling} close={() => setTraveling(false)} />
    </>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-accent-soft px-2 py-0.5">
      <Text className="text-xs text-accent-soft-foreground">{label}</Text>
    </View>
  );
}
