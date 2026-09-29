import { Fragment, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@/lib/data";
import { gymKinds, gymPresets, presetGym } from "@/lib/loads";
import { useStore } from "@/lib/store";
import { activeGym, listGyms, travelPlan } from "@/lib/workouts";
import {
  Button,
  DetailScreen,
  Icon,
  ListRow,
  Meta,
  Panel,
  SettingsSection,
  Status,
  Text,
} from "@/vector";
import { GymEditor, type EditableGym } from "./gym-editor";
import { useGymSummary } from "./gym-summary";
import { TravelBanner, TravelSheet } from "./travel";

/** Your gyms, a main one among them, and where you're training while away. */
export function GymsScreen() {
  const { units, t } = useStore();
  const summary = useGymSummary();
  const data = useQuery(
    () => ({ gyms: listGyms(units), main: activeGym(units), trip: travelPlan() }),
    [units]
  );
  const [editing, setEditing] = useState<EditableGym | null>(null);
  const [traveling, setTraveling] = useState(false);
  const unit = units === "metric" ? "kg" : "lb";

  return (
    <>
      <DetailScreen title={t("gyms")}>
        {data.trip ? (
          <TravelBanner onEdit={() => setTraveling(true)} />
        ) : (
          <Panel>
            <Panel.Title>{t("travelingQuestion")}</Panel.Title>
            <Panel.Description>{t("travelingPrompt")}</Panel.Description>
            <Panel.Footer>
              <Button variant="secondary" onPress={() => setTraveling(true)}>
                {t("startTrip")}
              </Button>
            </Panel.Footer>
          </Panel>
        )}

        <SettingsSection eyebrow={t("yourGyms")}>
          {data.gyms.map((gym, i) => (
            <Fragment key={gym.id}>
              {i > 0 && <View className="ms-4 h-px bg-separator" />}
              {/* A row of its own: the summary is facets (Meta), which a ListRow description cannot hold. */}
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(gym)}
                className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-surface-secondary"
              >
                <View className="flex-1 gap-1">
                  <Text variant="bodyStrong">{gym.name}</Text>
                  {(gym.id === data.main.id || gym.id === data.trip?.gym.id) && (
                    <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                      {gym.id === data.main.id && <Status state="ok" label={t("mainStatus")} />}
                      {gym.id === data.trip?.gym.id && (
                        <Status state="live" label={t("traveling")} />
                      )}
                    </View>
                  )}
                  <Meta items={summary(gym)} />
                </View>
                <Icon name="forward" size={17} tone="muted" />
              </Pressable>
            </Fragment>
          ))}
        </SettingsSection>

        <SettingsSection eyebrow={t("addGym")} footnote={t("addGymNote")}>
          {gymKinds.map((kind) => (
            <ListRow
              key={kind}
              title={gymPresets[kind].name}
              description={gymPresets[kind].description}
              trailing={<Icon name="add" size={17} tone="muted" />}
              onPress={() => setEditing(presetGym(kind, unit))}
            />
          ))}
        </SettingsSection>
      </DetailScreen>
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
