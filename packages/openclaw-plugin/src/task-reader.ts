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
} from "@continuous-agentics/delegation-core";

export interface TaskSummary {
  task_id: string;
  project: string;
  status: TaskStatus;
  delegated_at: string;
  worker: string;
  task_s3_key: string;
}

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
    const result = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: `${hashKey} = :pk`,
        ExpressionAttributeValues: { ":pk": hashValue },
        ScanIndexForward: options.ascending !== false,
        Limit: options.limit,
      } satisfies QueryCommandInput),
    );
    return (result.Items ?? []).map(toTaskSummary);
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

function toTaskSummary(item: Record<string, unknown>): TaskSummary {
  return {
    task_id: String(item.task_id),
    project: String(item.project),
    status: item.status as TaskStatus,
    delegated_at: String(item.delegated_at),
    worker: String(item.worker),
    task_s3_key: String(item.task_s3_key),
  };
}
