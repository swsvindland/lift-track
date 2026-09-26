export type HealthKind = "weight";
export type HealthRecord = {
  id: string;
  kind: HealthKind;
  value: number;
  measuredAt: string;
  clientId?: string;
};
export type HealthWrite = Omit<HealthRecord, "id"> & { clientId: string; version: number };
export type HealthAdapter = {
  authorize: (interactive?: boolean) => Promise<void>;
  read: () => Promise<HealthRecord[]>;
  write: (record: HealthWrite) => Promise<string>;
  remove: (kind: HealthKind, id: string) => Promise<void>;
};
