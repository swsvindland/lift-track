export type HealthKind = "weight";
export type HealthRecord = {
  id: string;
  kind: HealthKind;
  value: number;
  measuredAt: string;
  clientId?: string;
};
export type HealthWrite = Omit<HealthRecord, "id"> & { clientId: string; version: number };
/** A finished workout, written as a strength-training session. */
export type HealthWorkout = {
  clientId: string;
  version: number;
  startedAt: string;
  endedAt: string;
  title: string;
};
/** What the user allowed. Sync uses whatever was granted and skips the rest. */
export type HealthAccess = { weightRead: boolean; weightWrite: boolean; workoutWrite: boolean };
export type HealthAdapter = {
  /** Resolves to what was granted; nothing (older fakes) means everything. */
  authorize: (interactive?: boolean) => Promise<HealthAccess | void>;
  read: () => Promise<HealthRecord[]>;
  write: (record: HealthWrite) => Promise<string>;
  remove: (kind: HealthKind, id: string) => Promise<void>;
  writeWorkout?: (workout: HealthWorkout) => Promise<string>;
  removeWorkout?: (id: string) => Promise<void>;
};
