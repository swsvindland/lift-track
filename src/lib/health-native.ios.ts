import type { MetadataForQuantityIdentifier } from "@kingstinct/react-native-healthkit";
import type { HealthAdapter } from "./health-types";
export async function getHealthAdapter(): Promise<HealthAdapter> {
  // Lazy import: opening the app in Expo Go must not load an unavailable Nitro module.
  const hk = await import("@kingstinct/react-native-healthkit");
  const bodyMass = "HKQuantityTypeIdentifierBodyMass" as const;
  const workout = "HKWorkoutTypeIdentifier" as const;
  if (!hk.isHealthDataAvailable()) throw new Error("healthUnavailable");
  const shared = (type: typeof bodyMass | typeof workout) =>
    hk.authorizationStatusFor(type) === hk.AuthorizationStatus.sharingAuthorized;
  // Samples were written with their client id as HKSyncIdentifier, so one can be found by it.
  const saved = (id: string, clientId?: string) =>
    id
      ? { uuid: id }
      : {
          metadata: {
            withMetadataKey: "HKSyncIdentifier",
            operatorType: hk.ComparisonPredicateOperator.equalTo,
            value: clientId,
          },
        };
  // HealthKit fails a delete that matched nothing (the person removed the sample in Health, or it
  // was saved on a phone whose Health this one doesn't share); the sample is gone either way.
  const gone = (error: unknown) => {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    if (!/no data|errorNoData|code[ =]?11\b/i.test(`${code ?? ""} ${message ?? ""}`)) throw error;
  };
  return {
    async authorize(interactive = true) {
      if (interactive)
        await hk.requestAuthorization({ toRead: [bodyMass], toShare: [bodyMass, workout] });
      const access = {
        // iOS never says whether reading was allowed; a denied read just returns nothing.
        weightRead: true,
        weightWrite: shared(bodyMass),
        workoutWrite: shared(workout),
      };
      if (!access.weightWrite && !access.workoutWrite) throw new Error("syncFailed");
      return access;
    },
    async read() {
      const samples = await hk.queryQuantitySamples(bodyMass, {
        unit: "kg",
        limit: 0,
        ascending: true,
      });
      return samples.map((sample) => ({
        id: sample.uuid,
        kind: "weight" as const,
        value: sample.quantity,
        measuredAt: sample.startDate.toISOString(),
        clientId:
          typeof sample.metadata.HKSyncIdentifier === "string"
            ? sample.metadata.HKSyncIdentifier
            : undefined,
      }));
    },
    async write(record) {
      const date = new Date(record.measuredAt);
      // HealthKit 14.1 incorrectly intersects common metadata with Record<string, never>
      // for these identifiers. These are documented HK metadata keys; keep the workaround local.
      const metadata = {
        HKSyncIdentifier: record.clientId,
        HKSyncVersion: record.version,
        HKWasUserEntered: true,
      } as unknown as MetadataForQuantityIdentifier<typeof bodyMass>;
      const result = await hk.saveQuantitySample(
        bodyMass,
        "kg",
        record.value,
        date,
        date,
        metadata
      );
      if (!result) throw new Error("syncFailed");
      return result.uuid;
    },
    async remove(_kind, id, clientId) {
      if (!id && !clientId) return;
      await hk.deleteObjects(bodyMass, saved(id, clientId)).catch(gone);
    },
    async writeWorkout(w) {
      // Duration only: no energy estimate, so a watch that also recorded the session isn't
      // double counted in Activity.
      const result = await hk.saveWorkoutSample(
        hk.WorkoutActivityType.traditionalStrengthTraining,
        [],
        new Date(w.startedAt),
        new Date(w.endedAt),
        undefined,
        { HKSyncIdentifier: w.clientId, HKSyncVersion: w.version, HKWorkoutBrandName: w.title }
      );
      if (!result) throw new Error("syncFailed");
      return result.uuid;
    },
    async removeWorkout(id, clientId) {
      if (!id && !clientId) return;
      await hk.deleteObjects(workout, saved(id, clientId)).catch(gone);
    },
  };
}
