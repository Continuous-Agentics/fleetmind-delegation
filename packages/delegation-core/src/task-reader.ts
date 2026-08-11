import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  gsi1pk,
  gsi2pk,
  taskPK,
  TaskRecordSchema,
  type TaskRecord,
  type TaskStatus,
  type TaskSummary,
} from "./contracts.js";

export interface TaskReader {
  get(taskId: string): Promise<TaskRecord | undefined>;
  listByStatus(options: ListTasksOptions): Promise<TaskSummary[]>;
}

export interface ListTasksOptions {
  status: TaskStatus;
  project?: string;
  limit?: number;
  ascending?: boolean;
}

export interface DynamoDbTaskReaderConfig {
  tableName: string;
  region?: string;
}

/** Read-only DynamoDB implementation of the stable FleetMind task ledger. */
export class DynamoDbTaskReader implements TaskReader {
  private readonly tableName: string;
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(config: DynamoDbTaskReaderConfig, documentClient?: DynamoDBDocumentClient) {
    if (!config.tableName) throw new Error("A FleetMind delegation DynamoDB table name is required.");
    this.tableName = config.tableName;
    this.documentClient = documentClient ?? createDocumentClient(config.region);
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const result = await this.documentClient.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: taskPK(taskId) } }),
    );
    return result.Item ? TaskRecordSchema.parse(result.Item) : undefined;
  }

  async listByStatus(options: ListTasksOptions): Promise<TaskSummary[]> {
    const indexName = options.project ? "ProjectStatusIndex" : "StatusIndex";
    const hashKey = options.project ? "GSI1PK" : "GSI2PK";
    const hashValue = options.project
      ? gsi1pk(options.project, options.status)
      : gsi2pk(options.status);
    const summaries: TaskSummary[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const remaining = options.limit === undefined ? undefined : options.limit - summaries.length;
      if (remaining !== undefined && remaining <= 0) break;
      const result = await this.documentClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: indexName,
          KeyConditionExpression: `${hashKey} = :pk`,
          ExpressionAttributeValues: { ":pk": hashValue },
          ScanIndexForward: options.ascending !== false,
          Limit: remaining,
          ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        } satisfies QueryCommandInput),
      );
      summaries.push(...(result.Items ?? []).map((item) => toTaskSummary(TaskRecordSchema.parse(item))));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return summaries;
  }
}

function createDocumentClient(region?: string): DynamoDBDocumentClient {
  const resolvedRegion = region ?? process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"];
  if (!resolvedRegion) {
    throw new Error("DynamoDB region is not configured. Set awsRegion or AWS_REGION.");
  }
  const clientConfig: DynamoDBClientConfig = { region: resolvedRegion };
  return DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function toTaskSummary(item: TaskRecord): TaskSummary {
  return {
    task_id: item.task_id,
    project: item.project,
    status: item.status,
    delegated_at: item.delegated_at,
    worker: item.worker,
    task_s3_key: item.task_s3_key,
  };
}
