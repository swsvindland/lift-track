import type { HealthAdapter, HealthRecord } from "./health-types";
export async function getHealthAdapter(): Promise<HealthAdapter> {
  const hc = await import("react-native-health-connect");
  if (
    (await hc.getSdkStatus()) !== hc.SdkAvailabilityStatus.SDK_AVAILABLE ||
    !(await hc.initialize())
  )
    throw new Error("healthUnavailable");
  return {
    async authorize(interactive = true) {
      const permissions = (["read", "write"] as const).map((accessType) => ({
        recordType: "Weight" as const,
        accessType,
      }));
      const granted = interactive
        ? await hc.requestPermission(permissions)
        : await hc.getGrantedPermissions();
      if (interactive) {
        // Older Health Connect versions do not support background access.
        try {
          await hc.requestPermission([
            { accessType: "read", recordType: "BackgroundAccessPermission" },
          ]);
        } catch {
          /* Foreground sync is still available. */
        }
      }
      if (
        permissions.some(
          (p) =>
            !granted.some(
              (g) =>
                "recordType" in g && g.recordType === p.recordType && g.accessType === p.accessType
            )
        )
      )
        throw new Error("syncFailed");
    },
    async read() {
      const records: HealthRecord[] = [];
      // Health Connect normally permits the 30 days before authorization; ask only for that window.
      const startTime = new Date(Date.now() - 29 * 86400000).toISOString();
      const endTime = new Date().toISOString();
      let pageToken: string | undefined;
      do {
        const result = await hc.readRecords("Weight", {
          timeRangeFilter: { operator: "between", startTime, endTime },
          pageSize: 1000,
          pageToken,
        });
        for (const record of result.records) {
          if (!record.metadata?.id) continue;
          records.push({
            id: record.metadata.id,
            kind: "weight",
            value: record.weight.inKilograms,
            measuredAt: record.time,
            clientId: record.metadata.clientRecordId,
          });
        }
        pageToken = result.pageToken;
      } while (pageToken);
      return records;
    },
    async write(record) {
      const ids = await hc.insertRecords([
        {
          recordType: "Weight",
          weight: { value: record.value, unit: "kilograms" },
          time: record.measuredAt,
          metadata: {
            clientRecordId: record.clientId,
            clientRecordVersion: record.version,
            recordingMethod: hc.RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY,
          },
        },
      ]);
      if (!ids[0]) throw new Error("syncFailed");
      return ids[0];
    },
    async remove(_kind, id) {
      await hc.deleteRecordsByUuids("Weight", [id], []);
    },
  };
}
