import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand,
  UpdateCommand, DeleteCommand, TransactWriteCommand, BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { tableEnvVar } from "./tables.js";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

export function tn(table: string): string {
  const v = process.env[tableEnvVar(table)];
  if (!v) throw new Error(`Missing env ${tableEnvVar(table)}`);
  return v;
}

export async function getItem<T>(table: string, key: Record<string, unknown>): Promise<T | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: tn(table), Key: key }));
  return r.Item as T | undefined;
}
export async function putItem(table: string, item: Record<string, unknown>, condition?: string) {
  await ddb.send(new PutCommand({ TableName: tn(table), Item: item, ConditionExpression: condition }));
}
export async function deleteItem(table: string, key: Record<string, unknown>) {
  await ddb.send(new DeleteCommand({ TableName: tn(table), Key: key }));
}
export async function updateItem(table: string, key: Record<string, unknown>, patch: Record<string, unknown>, condition?: { expr: string; names?: Record<string, string>; values?: Record<string, unknown> } | string) {
  const cond = typeof condition === "string" ? { expr: condition } : condition;
  const names: Record<string, string> = {}; const values: Record<string, unknown> = {}; const sets: string[] = [];
  Object.entries(patch).forEach(([k, v], i) => {
    if (v === undefined) return;
    names[`#k${i}`] = k; values[`:v${i}`] = v; sets.push(`#k${i} = :v${i}`);
  });
  await ddb.send(new UpdateCommand({
    TableName: tn(table), Key: key, UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: { ...names, ...(cond?.names ?? {}) }, ExpressionAttributeValues: { ...values, ...(cond?.values ?? {}) }, ConditionExpression: cond?.expr,
  }));
}
export async function query<T>(table: string, opts: {
  index?: string; pk: string; pkValue: unknown; skName?: string; skBetween?: [string, string];
  skBeginsWith?: string; forward?: boolean; limit?: number; filter?: { expr: string; names?: Record<string, string>; values?: Record<string, unknown> };
}): Promise<T[]> {
  const names: Record<string, string> = { "#pk": opts.pk };
  const values: Record<string, unknown> = { ":pk": opts.pkValue };
  let kc = "#pk = :pk";
  if (opts.filter) { Object.assign(names, opts.filter.names ?? {}); Object.assign(values, opts.filter.values ?? {}); }
  if (opts.skName && opts.skBetween) { names["#sk"] = opts.skName; values[":a"] = opts.skBetween[0]; values[":b"] = opts.skBetween[1]; kc += " AND #sk BETWEEN :a AND :b"; }
  else if (opts.skName && opts.skBeginsWith) { names["#sk"] = opts.skName; values[":p"] = opts.skBeginsWith; kc += " AND begins_with(#sk, :p)"; }
  const out: T[] = []; let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: tn(table), IndexName: opts.index, KeyConditionExpression: kc,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      ScanIndexForward: opts.forward ?? true, ExclusiveStartKey, Limit: opts.limit, FilterExpression: opts.filter?.expr,
    }));
    out.push(...((r.Items ?? []) as T[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
    if (opts.limit && out.length >= opts.limit) break;
  } while (ExclusiveStartKey);
  return out;
}
export async function scan<T>(table: string, limit = 1000): Promise<T[]> {
  const out: T[] = []; let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: tn(table), ExclusiveStartKey }));
    out.push(...((r.Items ?? []) as T[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < limit);
  return out;
}
export async function transact(items: any[]) {
  await ddb.send(new TransactWriteCommand({ TransactItems: items }));
}
export async function batchPut(table: string, items: Record<string, unknown>[]) {
  for (let i = 0; i < items.length; i += 25) {
    let req = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; attempt < 5 && req.length; attempt++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [tn(table)]: req } }));
      req = (r.UnprocessedItems?.[tn(table)] as typeof req) ?? [];
      if (req.length) await new Promise((res) => setTimeout(res, 200 * (attempt + 1)));
    }
  }
}
export async function batchDelete(table: string, keys: Record<string, unknown>[]) {
  for (let i = 0; i < keys.length; i += 25) {
    let req = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    for (let attempt = 0; attempt < 5 && req.length; attempt++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [tn(table)]: req } }));
      req = (r.UnprocessedItems?.[tn(table)] as typeof req) ?? [];
      if (req.length) await new Promise((res) => setTimeout(res, 200 * (attempt + 1)));
    }
  }
}
export { tn as tableName };
