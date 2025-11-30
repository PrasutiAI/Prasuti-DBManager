import type { Express } from "express";
import { createServer, type Server } from "http";
import { neon } from "@neondatabase/serverless";
import { connectionConfigSchema, migrationRequestSchema, testConnectionRequestSchema, type ConnectionConfig, type TableInfo } from "@shared/schema";
import { fromZodError } from "zod-validation-error";

// Helper to build connection string
function getConnectionString(config: ConnectionConfig): string {
  if (config.connectionString) {
    return config.connectionString;
  }
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
}

// Helper to filter system tables
function isSystemTable(tableName: string): boolean {
  return tableName.startsWith("pg_") || tableName.startsWith("information_schema");
}

// Helper to apply table pattern filter
function matchesPattern(tableName: string, pattern?: string): boolean {
  if (!pattern) return true;
  try {
    // Convert SQL LIKE pattern to Regex
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escaped.replace(/%/g, '.*').replace(/_/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(tableName);
  } catch (e) {
    return true;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Test database connections
  app.post("/api/connect", async (req, res) => {
    try {
      const result = testConnectionRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: fromZodError(result.error).message 
        });
      }

      const { source, destination } = result.data;

      // Test source connection
      try {
        const sourceSql = neon(getConnectionString(source));
        await sourceSql`SELECT 1`;
      } catch (error: any) {
        return res.status(400).json({
          error: "Source connection failed",
          details: error.message
        });
      }

      // Test destination connection
      try {
        const destSql = neon(getConnectionString(destination));
        await destSql`SELECT 1`;
      } catch (error: any) {
        return res.status(400).json({
          error: "Destination connection failed",
          details: error.message
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Analyze source database tables
  app.post("/api/analyze", async (req, res) => {
    try {
      const result = migrationRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: fromZodError(result.error).message 
        });
      }

      const { source, tablePattern } = result.data;
      const sql = neon(getConnectionString(source));

      // Get all user tables
      const tables = await sql`
        SELECT 
          schemaname || '.' || tablename as table_name,
          pg_total_relation_size(schemaname || '.' || tablename) as size_bytes,
          n_live_tup as row_count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY table_name
      `;

      const tableInfos: TableInfo[] = tables
        .map((t: any) => ({
          name: t.table_name.replace('public.', ''),
          rows: parseInt(t.row_count) || 0,
          size: formatBytes(parseInt(t.size_bytes) || 0)
        }))
        .filter((t: TableInfo) => !isSystemTable(t.name))
        .filter((t: TableInfo) => matchesPattern(t.name, tablePattern));

      res.json({ tables: tableInfos });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate dry run execution plan
  app.post("/api/dry-run", async (req, res) => {
    try {
      const result = migrationRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: fromZodError(result.error).message 
        });
      }

      const { source, destination, tablePattern } = result.data;
      const sourceSql = neon(getConnectionString(source));

      // Get table schemas
      const tables = await sourceSql`
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `;

      // Group columns by table
      const tableSchemas = new Map<string, any[]>();
      for (const col of tables) {
        const tableName = col.table_name;
        if (isSystemTable(tableName) || !matchesPattern(tableName, tablePattern)) {
          continue;
        }
        if (!tableSchemas.has(tableName)) {
          tableSchemas.set(tableName, []);
        }
        tableSchemas.get(tableName)!.push(col);
      }

      // Generate execution plan
      const plan = Array.from(tableSchemas.keys()).map(tableName => {
        const columns = tableSchemas.get(tableName)!;
        const createColumns = columns.map((col: any) => 
          `${col.column_name} ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}${col.column_default ? ` DEFAULT ${col.column_default}` : ''}`
        ).join(',\n  ');

        return {
          tableName,
          actions: [
            `DROP TABLE IF EXISTS public.${tableName} CASCADE;`,
            `CREATE TABLE public.${tableName} (\n  ${createColumns}\n);`,
            `-- Copy data from source`,
          ]
        };
      });

      res.json({ plan });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate downloadable Python script
  app.post("/api/generate-script", async (req, res) => {
    try {
      const result = migrationRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: fromZodError(result.error).message 
        });
      }

      const { source, destination, tablePattern } = result.data;
      
      const scriptContent = `
import psycopg2
import sys
import re
from psycopg2 import sql

# Configuration generated from DB Replicator Pro
SOURCE_CONFIG = {
    "host": "${source.host || 'localhost'}",
    "port": "${source.port || '5432'}",
    "database": "${source.database || 'source_db'}",
    "user": "${source.user || 'postgres'}",
    "password": "${source.password || 'password'}",
    "dsn": "${source.connectionString || ''}"
}

DEST_CONFIG = {
    "host": "${destination.host || 'localhost'}",
    "port": "${destination.port || '5432'}",
    "database": "${destination.database || 'dest_db'}",
    "user": "${destination.user || 'postgres'}",
    "password": "${destination.password || 'password'}",
    "dsn": "${destination.connectionString || ''}"
}

TABLE_PATTERN = r"${tablePattern ? tablePattern.replace(/%/g, '.*').replace(/_/g, '.') : '.*'}"

def get_connection(config):
    if config.get("dsn"):
        return psycopg2.connect(config["dsn"])
    return psycopg2.connect(
        host=config["host"],
        port=config["port"],
        dbname=config["database"],
        user=config["user"],
        password=config["password"]
    )

def migrate():
    print("Connecting to databases...")
    try:
        source_conn = get_connection(SOURCE_CONFIG)
        dest_conn = get_connection(DEST_CONFIG)
        source_cur = source_conn.cursor()
        dest_cur = dest_conn.cursor()
        print("✓ Connections established.")
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        return

    # Fetch all user tables
    print("Fetching table list...")
    source_cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
    """)
    
    tables = [row[0] for row in source_cur.fetchall()]
    
    # Filter tables
    regex = re.compile(f"^{TABLE_PATTERN}$", re.IGNORECASE)
    tables_to_migrate = []
    
    for table in tables:
        # Skip system tables explicitly
        if table.startswith("pg_") or table.startswith("information_schema"):
            continue
            
        if regex.match(table):
            tables_to_migrate.append(table)
            
    print(f"✓ Found {len(tables_to_migrate)} tables to migrate: {tables_to_migrate}")
    
    for table in tables_to_migrate:
        print(f"\\nProcessing table: {table}...")
        
        try:
            # Get CREATE TABLE statement
            source_cur.execute(f"""
                SELECT 
                    'CREATE TABLE ' || quote_ident(table_name) || ' (' ||
                    string_agg(
                        quote_ident(column_name) || ' ' || 
                        data_type || 
                        CASE WHEN character_maximum_length IS NOT NULL 
                             THEN '(' || character_maximum_length || ')' 
                             ELSE '' END ||
                        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
                        ', '
                    ) || ');'
                FROM information_schema.columns
                WHERE table_name = '{table}' AND table_schema = 'public'
                GROUP BY table_name;
            """)
            
            create_stmt = source_cur.fetchone()
            if not create_stmt:
                print(f"  ⚠ Could not generate CREATE statement for {table}")
                continue
                
            # Drop existing table in destination
            dest_cur.execute(sql.SQL("DROP TABLE IF EXISTS {} CASCADE").format(sql.Identifier(table)))
            print(f"  ✓ Dropped existing table")
            
            # Create table in destination
            dest_cur.execute(create_stmt[0])
            dest_conn.commit()
            print(f"  ✓ Created table schema")
            
            # Copy data
            source_cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
            row_count = source_cur.fetchone()[0]
            
            print(f"  → Copying {row_count} rows...")
            
            # Use COPY for efficient data transfer
            source_cur.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(table)))
            columns = [desc[0] for desc in source_cur.description]
            
            rows_copied = 0
            batch_size = 1000
            while True:
                rows = source_cur.fetchmany(batch_size)
                if not rows:
                    break
                    
                # Insert batch
                args = ','.join(dest_cur.mogrify("({})".format(','.join(['%s'] * len(columns))), row).decode('utf-8') for row in rows)
                dest_cur.execute(
                    sql.SQL("INSERT INTO {} ({}) VALUES ".format(
                        sql.Identifier(table),
                        ','.join(sql.Identifier(c) for c in columns)
                    )).as_string(dest_conn) + args
                )
                
                rows_copied += len(rows)
                print(f"  → Progress: {rows_copied}/{row_count} rows", end='\\r')
            
            dest_conn.commit()
            print(f"\\n  ✓ Copied {rows_copied} rows successfully")
            
        except Exception as e:
            print(f"  ✗ Error processing {table}: {e}")
            dest_conn.rollback()
            continue
        
    source_conn.close()
    dest_conn.close()
    print("\\n✓ Migration complete!")

if __name__ == "__main__":
    migrate()
`;

      res.json({ script: scriptContent });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}

// Helper function to format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
