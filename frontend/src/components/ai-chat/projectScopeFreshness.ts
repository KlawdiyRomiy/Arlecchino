export type TimestampedProjectRecord = {
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function isFreshProjectRecord(
  record: TimestampedProjectRecord,
  scopeActivatedAt: number,
): boolean {
  const timestamp = Date.parse(record.createdAt || record.updatedAt || "");
  return (
    Number.isFinite(timestamp) && timestamp > 0 && timestamp >= scopeActivatedAt
  );
}
