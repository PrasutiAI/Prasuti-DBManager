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
