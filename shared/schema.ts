import { z } from "zod";

// Database connection schema
export const connectionConfigSchema = z.object({
  host: z.string().optional(),
  port: z.string().optional(),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  connectionString: z.string().optional(),
}).refine((data) => {
  if (data.connectionString && data.connectionString.length > 0) return true;
  return data.host && data.port && data.database && data.user && data.password;
}, {
  message: "Either connection string or all connection details required",
});

export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;

// Table info schema
export const tableInfoSchema = z.object({
  name: z.string(),
  rows: z.number(),
  size: z.string(),
});

export type TableInfo = z.infer<typeof tableInfoSchema>;

// Migration request
export const migrationRequestSchema = z.object({
  source: connectionConfigSchema,
  destination: connectionConfigSchema,
  tablePattern: z.string().optional(),
});

export type MigrationRequest = z.infer<typeof migrationRequestSchema>;

// Test connection request
export const testConnectionRequestSchema = z.object({
  source: connectionConfigSchema,
  destination: connectionConfigSchema,
});

export type TestConnectionRequest = z.infer<typeof testConnectionRequestSchema>;

// Database Manager Schemas

// Table column information
export const tableColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  isNullable: z.boolean(),
  defaultValue: z.string().nullable(),
  maxLength: z.number().nullable(),
  isPrimaryKey: z.boolean(),
  ordinalPosition: z.number(),
});

export type TableColumn = z.infer<typeof tableColumnSchema>;

// Table structure with columns
export const tableStructureSchema = z.object({
  tableName: z.string(),
  columns: z.array(tableColumnSchema),
  primaryKeys: z.array(z.string()),
  rowCount: z.number(),
  sizeBytes: z.number(),
});

export type TableStructure = z.infer<typeof tableStructureSchema>;

// Paginated table data
export const tableDataPageSchema = z.object({
  tableName: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.any())),
  totalRows: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type TableDataPage = z.infer<typeof tableDataPageSchema>;

// Database selection (source or destination)
export const dbSelectionSchema = z.enum(["source", "destination"]);
export type DbSelection = z.infer<typeof dbSelectionSchema>;

// Request to fetch table data
export const fetchTableDataRequestSchema = z.object({
  db: dbSelectionSchema,
  tableName: z.string(),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(25),
  orderBy: z.string().optional(),
  orderDir: z.enum(["asc", "desc"]).optional().default("asc"),
  search: z.string().optional(),
});

export type FetchTableDataRequest = z.infer<typeof fetchTableDataRequestSchema>;

// Row mutation (insert/update/delete)
export const rowMutationSchema = z.object({
  db: dbSelectionSchema,
  tableName: z.string(),
  operation: z.enum(["insert", "update", "delete"]),
  data: z.record(z.any()).optional(),
  where: z.record(z.any()).optional(),
});

export type RowMutation = z.infer<typeof rowMutationSchema>;

// Backup request
export const backupRequestSchema = z.object({
  db: dbSelectionSchema,
  selectedTables: z.array(z.string()).optional(),
  includeData: z.boolean().optional().default(true),
});

export type BackupRequest = z.infer<typeof backupRequestSchema>;
