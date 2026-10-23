import { TimestreamWriteClient, WriteRecordsCommand } from "@aws-sdk/client-timestream-write";

const ts = new TimestreamWriteClient({});

/** Best-effort time-series adherence record. DynamoDB DoseEvents remain the source the dashboards read. */
export async function recordDoseMetric(m: { patientId: string; drugId: string; status: string; time: Date }) {
  const DatabaseName = process.env.TIMESTREAM_DB, TableName = process.env.TIMESTREAM_TABLE;
  if (!DatabaseName || !TableName) return;
  try {
    await ts.send(new WriteRecordsCommand({
      DatabaseName, TableName,
      Records: [{
        Dimensions: [{ Name: "patientId", Value: m.patientId }, { Name: "drugId", Value: m.drugId }, { Name: "status", Value: m.status }],
        MeasureName: "dose", MeasureValue: "1", MeasureValueType: "BIGINT", Time: String(m.time.getTime()), TimeUnit: "MILLISECONDS",
      }],
    }));
  } catch (e) { console.warn("timestream write failed", (e as Error).name); }
}
