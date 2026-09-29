import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { equipmentLabels, matchExercise, muscleLabels, primaryMuscles } from "@/lib/exercises";
import { muscles, type Equipment, type Muscle } from "@/lib/exercises/types";
import { readBuilderHints } from "@/lib/lift-ai";
import { useModel } from "@/lib/use-model";
import { useExercises } from "@/lib/exercise-store";
import { setPendingDraft } from "@/lib/draft-store";
import {
  buildProgram,
  sessionMinutes,
  splits,
  type Experience,
  type SessionMinutes,
} from "@/lib/program-builder";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/translations";
import { activeGym, listGyms } from "@/lib/workouts";
import { useGymSummary } from "@/components/gyms/gym-summary";
import {
  Button,
  Choices,
  Editor,
  Field,
  Label,
  ListRow,
  Meta,
  Note,
  Panel,
  Text,
  useKitFormat,
  useKitStrings,
} from "@/vector";

const dayOptions = ["2", "3", "4", "5", "6"] as const;
const minuteOptions = sessionMinutes.map(String) as `${SessionMinutes}`[];
const weekOptions = ["4", "5", "6"] as const;
const experienceOptions = ["beginner", "intermediate", "advanced"] as const;

const MAX_PRIORITIES = 3;
const steps: Message[] = ["buildProgram", "bringUp", "bringDown"];

type Props = { open: boolean; close: () => void };

/** A few questions, muscles to bring up, muscles to bring down, then the editor opens. */
export function ProgramBuilderSheet(props: Props) {
  return props.open ? <OpenBuilder {...props} /> : null;
}

function OpenBuilder({ open, close }: Props) {
  const { units, t } = useStore();
  const strings = useKitStrings();
  const format = useKitFormat();
  const summary = useGymSummary();
  const { all, settings } = useExercises();
  const [days, setDays] = useState<(typeof dayOptions)[number]>("4");
  const [minutes, setMinutes] = useState<(typeof minuteOptions)[number]>("60");
  const [weeks, setWeeks] = useState<(typeof weekOptions)[number]>("5");
  const [experience, setExperience] = useState<Experience>("intermediate");
  const [priorities, setPriorities] = useState<Muscle[]>([]);
  const [deprioritized, setDeprioritized] = useState<Muscle[]>([]);
  const [gyms] = useState(() => listGyms(units));
  const [firstGymId] = useState(() => activeGym(units).id);
  const [gymId, setGymId] = useState(firstGymId);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [wish, setWish] = useState("");
  const [reading, setReading] = useState(false);
  const [kit, setKit] = useState<Equipment[] | null>(null);
  const [avoid, setAvoid] = useState<{ label: string; ids: string[] }[]>([]);
  const model = useModel();

  /** Fills the answers from a sentence; what hurts is left out of this program only. */
  const fillFromWords = async () => {
    setReading(true);
    try {
      const hints = await readBuilderHints(wish, model.generate);
      if (hints.days) setDays(String(hints.days) as (typeof dayOptions)[number]);
      if (hints.minutes) setMinutes(String(hints.minutes) as (typeof minuteOptions)[number]);
      if (hints.weeks) setWeeks(String(hints.weeks) as (typeof weekOptions)[number]);
      if (hints.experience) setExperience(hints.experience);
      if (hints.priorities.length) setPriorities(hints.priorities);
      if (hints.deprioritized.length) setDeprioritized(hints.deprioritized);
      setKit(hints.equipment ?? null);
      setAvoid(
        hints.avoid.flatMap((phrase) => {
          const { exercise } = matchExercise(all, phrase);
          if (!exercise) return [];
          // "overhead press" means the movement; "barbell overhead press" means that one exercise.
          const general =
            !/\b(barbell|bb|dumbbell|db|machine|cable|smith|ez|kettlebell|band)\b/i.test(phrase);
          const ids = general
            ? all
                .filter(
                  (e) =>
                    e.pattern === exercise.pattern &&
                    primaryMuscles(e).some((m) => exercise.muscles[m] === 1)
                )
                .map((e) => e.id)
            : [exercise.id];
          return [{ label: general ? phrase : exercise.name, ids }];
        })
      );
    } finally {
      setReading(false);
    }
  };

  const build = () => {
    const gym = gyms.find((g) => g.id === gymId) ?? activeGym(units);
    const draft = buildProgram(
      {
        days: Number(days),
        minutes: Number(minutes) as SessionMinutes,
        weeks: Number(weeks),
        experience,
        priorities,
        deprioritized: deprioritized.filter((m) => !priorities.includes(m)),
        equipment: kit ? gym.equipment.filter((e) => kit.includes(e)) : gym.equipment,
        excluded: gym.excluded,
        included: gym.included,
        settings: [
          ...settings,
          ...avoid
            .flatMap((a) => a.ids)
            .map((exerciseId) => ({
              exerciseId,
              avoid: true,
              favorite: false,
              restSeconds: null,
              note: "",
            })),
        ],
      },
      all
    );
    setPendingDraft({ ...draft, gymId: gym.id });
    close();
    router.push("/program");
  };

  const go = (next: number) => {
    setStep(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const toggle = (list: Muscle[], set: (next: Muscle[]) => void, m: Muscle) =>
    set(list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  const picked = step === 1 ? priorities : deprioritized;
  // Any answer away from the defaults is work a stray swipe would lose.
  const dirty =
    step > 0 ||
    !!wish.trim() ||
    days !== "4" ||
    minutes !== "60" ||
    weeks !== "5" ||
    experience !== "intermediate" ||
    gymId !== firstGymId ||
    priorities.length > 0 ||
    deprioritized.length > 0;
  const experienceLabel = (e: Experience) =>
    e === "beginner"
      ? t("underN", { n: format.number(1) })
      : e === "intermediate"
        ? format.range(1, 3)
        : t("nOrMore", { n: format.number(3) });
  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0];

  return (
    <Editor
      title={t(steps[step])}
      open={open}
      close={close}
      dirty={dirty}
      scrollRef={scrollRef}
      footer={
        step > 0 ? (
          <Button variant="secondary" size="lg" onPress={() => go(step - 1)}>
            {strings.back}
          </Button>
        ) : undefined
      }
      primary={{
        label:
          step === steps.length - 1
            ? t("build")
            : step > 0 && !picked.length
              ? t("skip")
              : t("nextStep"),
        onPress: step < steps.length - 1 ? () => go(step + 1) : build,
      }}
    >
      {step === 0 && (
        <>
          <View className="gap-2">
            <Field
              label={t("describeWhatYouWant")}
              value={wish}
              onChange={setWish}
              placeholder={t("builderPlaceholder")}
              multiline
            />
            <Button
              variant="secondary"
              icon={model.available ? "analysis" : undefined}
              disabled={!wish.trim()}
              loading={reading}
              loadingLabel={t("reading")}
              onPress={() => void fillFromWords()}
            >
              {t("fillFromThis")}
            </Button>
            {kit && (
              <Note>
                {t("usingOnly", { list: format.list(kit.map((e) => equipmentLabels[e])) })}
              </Note>
            )}
            {avoid.length > 0 && (
              <Note>{t("leavingOut", { list: format.list(avoid.map((a) => a.label)) })}</Note>
            )}
            {!model.available && (
              <Text variant="caption" tone="muted">
                {t("builderNoModel")}
              </Text>
            )}
          </View>
          <View className="gap-2">
            <Label accessibilityRole="header">{t("gym")}</Label>
            <Choices
              values={gyms.map((g) => String(g.id))}
              value={String(gymId)}
              onChange={(id) => setGymId(Number(id))}
              label={(id) => gyms.find((g) => String(g.id) === id)?.name ?? ""}
              accessibilityLabel={t("gym")}
            />
            {gym && <Meta items={summary(gym)} />}
            <Note>{t("addGymsInSettings")}</Note>
          </View>
          <View className="gap-2">
            <Label accessibilityRole="header">{t("daysAWeek")}</Label>
            <Choices
              values={dayOptions}
              value={days}
              onChange={setDays}
              label={(d) => format.number(Number(d))}
              accessibilityLabel={t("daysAWeek")}
              mono
            />
            <Note>{splits[Number(days)].name}</Note>
          </View>
          <View className="gap-2">
            <Label accessibilityRole="header">{t("minutesASession")}</Label>
            <Choices
              values={minuteOptions}
              value={minutes}
              onChange={setMinutes}
              label={(m) => format.number(Number(m))}
              accessibilityLabel={t("minutesASession")}
              mono
            />
          </View>
          <View className="gap-2">
            <Label accessibilityRole="header">{t("yearsLifting")}</Label>
            <Choices
              values={experienceOptions}
              value={experience}
              onChange={setExperience}
              label={experienceLabel}
              accessibilityLabel={t("yearsLifting")}
            />
          </View>
          <View className="gap-2">
            <Label accessibilityRole="header">{t("weeksBeforeDeload")}</Label>
            <Choices
              values={weekOptions}
              value={weeks}
              onChange={setWeeks}
              label={(w) => format.number(Number(w))}
              accessibilityLabel={t("weeksBeforeDeload")}
              mono
            />
          </View>
        </>
      )}
      {step === 1 && (
        <MuscleList
          note={t("bringUpNote", { n: format.number(MAX_PRIORITIES) })}
          options={muscles}
          selected={priorities}
          full={priorities.length >= MAX_PRIORITIES}
          onToggle={(m) => toggle(priorities, setPriorities, m)}
        />
      )}
      {step === 2 && (
        <>
          <MuscleList
            note={t("bringDownNote")}
            options={muscles.filter((m) => !priorities.includes(m))}
            selected={deprioritized}
            onToggle={(m) => toggle(deprioritized, setDeprioritized, m)}
          />
          <Note>{t("builderFinalNote")}</Note>
        </>
      )}
    </Editor>
  );
}

/** Muscles by body region, so a long list reads in chunks. */
const regions: { name: Message; muscles: Muscle[] }[] = [
  { name: "regionChestBack", muscles: ["chest", "lats", "upperBack", "traps"] },
  { name: "regionShoulders", muscles: ["frontDelts", "sideDelts", "rearDelts"] },
  { name: "regionArms", muscles: ["biceps", "triceps", "forearms"] },
  { name: "regionCore", muscles: ["abs", "lowerBack"] },
  { name: "regionLegs", muscles: ["glutes", "quads", "hamstrings", "adductors", "calves"] },
];

/** A switch per muscle, grouped by region. Once `full`, the others wait (disabled) until one is turned off. */
function MuscleList({
  note,
  options,
  selected,
  full = false,
  onToggle,
}: {
  note: string;
  options: readonly Muscle[];
  selected: Muscle[];
  full?: boolean;
  onToggle: (m: Muscle) => void;
}) {
  const { t } = useStore();
  return (
    <>
      <Note>{note}</Note>
      {regions.map((region) => {
        const shown = region.muscles.filter((m) => options.includes(m));
        if (!shown.length) return null;
        return (
          <View key={region.name} className="gap-2">
            <Label accessibilityRole="header">{t(region.name)}</Label>
            <Panel inset="none">
              {shown.map((m) => (
                <ListRow
                  key={m}
                  title={muscleLabels[m]}
                  trailing="toggle"
                  toggleValue={selected.includes(m)}
                  onToggle={() => onToggle(m)}
                  disabled={full && !selected.includes(m)}
                />
              ))}
            </Panel>
          </View>
        );
      })}
    </>
  );
}
