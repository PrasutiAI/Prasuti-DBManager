import type { Express } from "express";
import { createServer, type Server } from "http";
import { neon } from "@neondatabase/serverless";
import { 
  connectionConfigSchema, 
  migrationRequestSchema, 
  testConnectionRequestSchema, 
  fetchTableDataRequestSchema,
  rowMutationSchema,
  backupRequestSchema,
  dbSelectionSchema,
  type ConnectionConfig, 
  type TableInfo,
  type TableColumn,
  type TableStructure,
  type TableDataPage,
  type DbSelection
} from "@shared/schema";
import { fromZodError } from "zod-validation-error";

// Helper to get database URL based on selection
function getDatabaseUrl(db: DbSelection): string | undefined {
  return db === "source" ? process.env.DATABASE_URL_OLD : process.env.DATABASE_URL_NEW;
}

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

  // Check if environment variables are configured
  app.get("/api/config", async (_req, res) => {
    const hasOldDb = !!process.env.DATABASE_URL_OLD;
    const hasNewDb = !!process.env.DATABASE_URL_NEW;
    res.json({ 
      hasEnvConfig: hasOldDb && hasNewDb,
      sourceConfigured: hasOldDb,
      destinationConfigured: hasNewDb
    });
  });

  // Quick connect using environment variables
  app.post("/api/quick-connect", async (_req, res) => {
    const sourceUrl = process.env.DATABASE_URL_OLD;
    const destUrl = process.env.DATABASE_URL_NEW;

    if (!sourceUrl || !destUrl) {
      return res.status(400).json({ 
        error: "Environment variables DATABASE_URL_OLD and DATABASE_URL_NEW must be set" 
      });
    }

    try {
      // Test source connection
      const sourceSql = neon(sourceUrl);
      await sourceSql`SELECT 1`;

      // Test destination connection
      const destSql = neon(destUrl);
      await destSql`SELECT 1`;

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Analyze using environment variables
  app.post("/api/quick-analyze", async (req, res) => {
    const sourceUrl = process.env.DATABASE_URL_OLD;
    const { tablePattern } = req.body;

    if (!sourceUrl) {
      return res.status(400).json({ error: "DATABASE_URL_OLD not configured" });
    }

    try {
      const sql = neon(sourceUrl);
      const tables = await sql`
        SELECT 
          schemaname || '.' || relname as table_name,
          pg_total_relation_size(schemaname || '.' || relname) as size_bytes,
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

  // Quick dry-run using environment variables
  app.post("/api/quick-dry-run", async (req, res) => {
    const sourceUrl = process.env.DATABASE_URL_OLD;
    const { tablePattern } = req.body;

    if (!sourceUrl) {
      return res.status(400).json({ error: "DATABASE_URL_OLD not configured" });
    }

    try {
      const sql = neon(sourceUrl);
      const tables = await sql`
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

  // Execute migration using environment variables
  app.post("/api/quick-migrate", async (req, res) => {
    const sourceUrl = process.env.DATABASE_URL_OLD;
    const destUrl = process.env.DATABASE_URL_NEW;
    const { tablePattern, selectedTables, tableDataFlags } = req.body;

    if (!sourceUrl || !destUrl) {
      return res.status(400).json({ error: "Database URLs not configured" });
    }

    try {
      const sourceSql = neon(sourceUrl);
      const destSql = neon(destUrl);

      // Get tables to migrate
      const tables = await sourceSql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      let tablesToMigrate = tables
        .map((t: any) => t.table_name)
        .filter((name: string) => !isSystemTable(name))
        .filter((name: string) => matchesPattern(name, tablePattern));

      // If specific tables selected, filter to those
      if (selectedTables && selectedTables.length > 0) {
        tablesToMigrate = tablesToMigrate.filter((name: string) => selectedTables.includes(name));
      }

      const results: any[] = [];

      for (const tableName of tablesToMigrate) {
        try {
          // Get column info
          const columns = await sourceSql`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${tableName}
            ORDER BY ordinal_position
          `;

          // Build CREATE TABLE statement
          const columnDefs = columns.map((col: any) => {
            let def = `"${col.column_name}" ${col.data_type}`;
            if (col.character_maximum_length) {
              def += `(${col.character_maximum_length})`;
            }
            if (col.is_nullable === 'NO') {
              def += ' NOT NULL';
            }
            if (col.column_default) {
              def += ` DEFAULT ${col.column_default}`;
            }
            return def;
          }).join(', ');

          // Drop and recreate table
          await destSql(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
          await destSql(`CREATE TABLE "${tableName}" (${columnDefs})`);

          // Check if should copy data for this table
          const shouldCopyData = tableDataFlags && tableDataFlags[tableName] !== false;

          let rowsCopied = 0;
          if (shouldCopyData) {
            const data = await sourceSql(`SELECT * FROM "${tableName}"`);
            
            for (const row of data) {
              const cols = Object.keys(row);
              const vals = Object.values(row);
              const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
              const colNames = cols.map(c => `"${c}"`).join(', ');
              await destSql(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`, vals);
              rowsCopied++;
            }
          }

          results.push({ table: tableName, status: 'success', rowsCopied });
        } catch (error: any) {
          results.push({ table: tableName, status: 'error', error: error.message });
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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

  // Generate and download SQL backup from source (before migration)
  app.post("/api/download-source-backup", async (req, res) => {
    const sourceUrl = process.env.DATABASE_URL_OLD;
    const { selectedTables, tablePattern } = req.body;

    if (!sourceUrl) {
      return res.status(400).json({ error: "DATABASE_URL_OLD not configured" });
    }

    try {
      const sql = neon(sourceUrl);

      // Get list of tables to backup
      let tables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      let tablesToBackup = tables.map((t: any) => t.table_name)
        .filter((name: string) => !isSystemTable(name))
        .filter((name: string) => matchesPattern(name, tablePattern));

      // If specific tables provided, use those
      if (selectedTables && selectedTables.length > 0) {
        tablesToBackup = tablesToBackup.filter((name: string) => selectedTables.includes(name));
      }

      let sqlDump = "-- Database Backup (Source - Before Migration)\n";
      sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
      sqlDump += "-- Format: SQL\n\n";

      // Dump each table
      for (const tableName of tablesToBackup) {
        try {
          // Get table structure
          const columns = await sql`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${tableName}
            ORDER BY ordinal_position
          `;

          // Build CREATE TABLE
          const columnDefs = columns.map((col: any) => {
            let def = `"${col.column_name}" ${col.data_type}`;
            if (col.character_maximum_length) {
              def += `(${col.character_maximum_length})`;
            }
            if (col.is_nullable === 'NO') {
              def += ' NOT NULL';
            }
            if (col.column_default) {
              def += ` DEFAULT ${col.column_default}`;
            }
            return def;
          }).join(',\n  ');

          sqlDump += `\n-- Table: ${tableName}\n`;
          sqlDump += `DROP TABLE IF EXISTS "${tableName}" CASCADE;\n`;
          sqlDump += `CREATE TABLE "${tableName}" (\n  ${columnDefs}\n);\n`;

          // Get data
          const data = await sql(`SELECT * FROM "${tableName}"`);

          if (data.length > 0) {
            sqlDump += `\n-- Data for ${tableName}\n`;
            for (const row of data) {
              const cols = Object.keys(row);
              const vals = cols.map(c => {
                const val = row[c];
                if (val === null) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                return val;
              });
              sqlDump += `INSERT INTO "${tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});\n`;
            }
          }
        } catch (error: any) {
          sqlDump += `\n-- Error dumping table ${tableName}: ${error.message}\n`;
        }
      }

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="backup_source_${new Date().toISOString().split('T')[0]}.sql"`);
      res.send(sqlDump);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate and download SQL backup from destination (after migration)
  app.post("/api/download-backup", async (req, res) => {
    const destUrl = process.env.DATABASE_URL_NEW;
    const { selectedTables } = req.body;

    if (!destUrl) {
      return res.status(400).json({ error: "DATABASE_URL_NEW not configured" });
    }

    try {
      const sql = neon(destUrl);

      // Get list of tables to backup
      let tables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      let tablesToBackup = tables.map((t: any) => t.table_name);

      // If specific tables provided, use those
      if (selectedTables && selectedTables.length > 0) {
        tablesToBackup = tablesToBackup.filter((name: string) => selectedTables.includes(name));
      }

      let sqlDump = "-- Database Backup\n";
      sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
      sqlDump += "-- Format: SQL\n\n";

      // Dump each table
      for (const tableName of tablesToBackup) {
        try {
          // Get table structure
          const columns = await sql`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${tableName}
            ORDER BY ordinal_position
          `;

          // Build CREATE TABLE
          const columnDefs = columns.map((col: any) => {
            let def = `"${col.column_name}" ${col.data_type}`;
            if (col.character_maximum_length) {
              def += `(${col.character_maximum_length})`;
            }
            if (col.is_nullable === 'NO') {
              def += ' NOT NULL';
            }
            if (col.column_default) {
              def += ` DEFAULT ${col.column_default}`;
            }
            return def;
          }).join(',\n  ');

          sqlDump += `\n-- Table: ${tableName}\n`;
          sqlDump += `DROP TABLE IF EXISTS "${tableName}" CASCADE;\n`;
          sqlDump += `CREATE TABLE "${tableName}" (\n  ${columnDefs}\n);\n`;

          // Get data
          const data = await sql(`SELECT * FROM "${tableName}"`);

          if (data.length > 0) {
            sqlDump += `\n-- Data for ${tableName}\n`;
            for (const row of data) {
              const cols = Object.keys(row);
              const vals = cols.map(c => {
                const val = row[c];
                if (val === null) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                return val;
              });
              sqlDump += `INSERT INTO "${tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});\n`;
            }
          }
        } catch (error: any) {
          sqlDump += `\n-- Error dumping table ${tableName}: ${error.message}\n`;
        }
      }

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="backup_${new Date().toISOString().split('T')[0]}.sql"`);
      res.send(sqlDump);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ DATABASE MANAGER API ROUTES ============

  // List all tables in a database with details
  app.get("/api/db/tables", async (req, res) => {
    try {
      const db = dbSelectionSchema.parse(req.query.db || "source");
      const dbUrl = getDatabaseUrl(db);

      if (!dbUrl) {
        return res.status(400).json({ 
          error: `${db === "source" ? "DATABASE_URL_OLD" : "DATABASE_URL_NEW"} not configured` 
        });
      }

      const sql = neon(dbUrl);
      const tables = await sql`
        SELECT 
          t.table_name,
          COALESCE(s.n_live_tup, 0) as row_count,
          COALESCE(pg_total_relation_size('public.' || t.table_name), 0) as size_bytes
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON t.table_name = s.relname
        WHERE t.table_schema = 'public' 
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `;

      const tableInfos: TableInfo[] = tables
        .map((t: any) => ({
          name: t.table_name,
          rows: parseInt(t.row_count) || 0,
          size: formatBytes(parseInt(t.size_bytes) || 0)
        }))
        .filter((t: TableInfo) => !isSystemTable(t.name));

      res.json({ tables: tableInfos, db });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get table structure (columns, constraints)
  app.get("/api/db/structure/:tableName", async (req, res) => {
    try {
      const db = dbSelectionSchema.parse(req.query.db || "source");
      const { tableName } = req.params;
      const dbUrl = getDatabaseUrl(db);

      if (!dbUrl) {
        return res.status(400).json({ 
          error: `${db === "source" ? "DATABASE_URL_OLD" : "DATABASE_URL_NEW"} not configured` 
        });
      }

      const sql = neon(dbUrl);

      // Get columns
      const columns = await sql`
        SELECT 
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          c.ordinal_position,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' 
            AND tc.table_name = ${tableName}
            AND tc.table_schema = 'public'
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_schema = 'public' AND c.table_name = ${tableName}
        ORDER BY c.ordinal_position
      `;

      if (columns.length === 0) {
        return res.status(404).json({ error: `Table '${tableName}' not found` });
      }

      const tableColumns: TableColumn[] = columns.map((col: any) => ({
        name: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === 'YES',
        defaultValue: col.column_default,
        maxLength: col.character_maximum_length ? parseInt(col.character_maximum_length) : null,
        isPrimaryKey: col.is_primary_key,
        ordinalPosition: parseInt(col.ordinal_position)
      }));

      // Get row count and size
      const stats = await sql`
        SELECT 
          COALESCE(n_live_tup, 0) as row_count,
          COALESCE(pg_total_relation_size('public.' || ${tableName}), 0) as size_bytes
        FROM pg_stat_user_tables
        WHERE relname = ${tableName}
      `;

      const structure: TableStructure = {
        tableName,
        columns: tableColumns,
        primaryKeys: tableColumns.filter(c => c.isPrimaryKey).map(c => c.name),
        rowCount: stats.length > 0 ? parseInt(stats[0].row_count) || 0 : 0,
        sizeBytes: stats.length > 0 ? parseInt(stats[0].size_bytes) || 0 : 0
      };

      res.json(structure);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get table data with pagination (with SQL injection protection)
  app.post("/api/db/data", async (req, res) => {
    try {
      const result = fetchTableDataRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).message });
      }

      const { db, tableName, page, pageSize, orderBy, orderDir, search } = result.data;
      const dbUrl = getDatabaseUrl(db);

      if (!dbUrl) {
        return res.status(400).json({ 
          error: `${db === "source" ? "DATABASE_URL_OLD" : "DATABASE_URL_NEW"} not configured` 
        });
      }

      // Validate table name (alphanumeric and underscore only - prevents SQL injection)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name' });
      }

      const sql = neon(dbUrl);
      const offset = (page - 1) * pageSize;

      // Get column names for the table (for validation)
      const columnsResult = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
        ORDER BY ordinal_position
      `;

      if (columnsResult.length === 0) {
        return res.status(404).json({ error: `Table '${tableName}' not found` });
      }

      const columnNames: string[] = columnsResult.map((c: any) => c.column_name);

      // Validate orderBy column against actual columns (prevents SQL injection)
      let validOrderBy: string | null = null;
      if (orderBy && columnNames.includes(orderBy)) {
        // Additional validation - column names must be valid identifiers
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(orderBy)) {
          validOrderBy = orderBy;
        }
      }

      // Sanitize search - escape special characters and use parameterized query
      const searchParam = search && search.trim() ? `%${search.trim()}%` : null;

      // Build queries using parameterized values for data, validated identifiers for structure
      let countQuery: string;
      let dataQuery: string;
      const params: any[] = [];

      if (searchParam) {
        // Build search conditions with parameterized search value
        const searchConditions = columnNames
          .filter(col => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col))
          .map((col) => `CAST("${col}" AS TEXT) ILIKE $1`)
          .join(' OR ');
        
        params.push(searchParam);
        countQuery = `SELECT COUNT(*) as total FROM "${tableName}" WHERE ${searchConditions}`;
        
        if (validOrderBy) {
          dataQuery = `SELECT * FROM "${tableName}" WHERE ${searchConditions} ORDER BY "${validOrderBy}" ${orderDir === 'desc' ? 'DESC' : 'ASC'} LIMIT $2 OFFSET $3`;
        } else {
          dataQuery = `SELECT * FROM "${tableName}" WHERE ${searchConditions} ORDER BY 1 LIMIT $2 OFFSET $3`;
        }
        params.push(pageSize, offset);
      } else {
        countQuery = `SELECT COUNT(*) as total FROM "${tableName}"`;
        
        if (validOrderBy) {
          dataQuery = `SELECT * FROM "${tableName}" ORDER BY "${validOrderBy}" ${orderDir === 'desc' ? 'DESC' : 'ASC'} LIMIT $1 OFFSET $2`;
        } else {
          dataQuery = `SELECT * FROM "${tableName}" ORDER BY 1 LIMIT $1 OFFSET $2`;
        }
        params.push(pageSize, offset);
      }

      // Execute queries with parameters
      const [countResult, dataRows] = await Promise.all([
        searchParam ? sql(countQuery, [searchParam]) : sql(countQuery),
        sql(dataQuery, params)
      ]);

      const totalRows = parseInt(countResult[0]?.total) || 0;
      const totalPages = Math.ceil(totalRows / pageSize);

      res.json({
        tableName,
        columns: columnNames,
        rows: dataRows as any[],
        totalRows,
        page,
        pageSize,
        totalPages
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Row mutations (insert/update/delete) with SQL injection protection
  app.post("/api/db/row", async (req, res) => {
    try {
      const result = rowMutationSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).message });
      }

      const { db, tableName, operation, data, where } = result.data;
      const dbUrl = getDatabaseUrl(db);

      if (!dbUrl) {
        return res.status(400).json({ 
          error: `${db === "source" ? "DATABASE_URL_OLD" : "DATABASE_URL_NEW"} not configured` 
        });
      }

      // Validate table name (prevents SQL injection)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name' });
      }

      const sql = neon(dbUrl);

      // Get valid column names for the table
      const columnsResult = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
      `;
      const validColumns = new Set(columnsResult.map((c: any) => c.column_name));

      // Helper to validate column names
      const isValidColumn = (col: string) => validColumns.has(col) && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col);

      if (operation === 'insert') {
        if (!data || Object.keys(data).length === 0) {
          return res.status(400).json({ error: 'Data is required for insert operation' });
        }

        // Filter to only valid columns
        const validEntries = Object.entries(data).filter(([key]) => isValidColumn(key));
        if (validEntries.length === 0) {
          return res.status(400).json({ error: 'No valid columns provided' });
        }

        const columns = validEntries.map(([k]) => k);
        const values = validEntries.map(([, v]) => v);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const colNames = columns.map(c => `"${c}"`).join(', ');

        const query = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) RETURNING *`;
        const insertedRow = await sql(query, values);

        res.json({ success: true, row: insertedRow[0] });
      } else if (operation === 'update') {
        if (!data || Object.keys(data).length === 0) {
          return res.status(400).json({ error: 'Data is required for update operation' });
        }
        if (!where || Object.keys(where).length === 0) {
          return res.status(400).json({ error: 'Where clause is required for update operation' });
        }

        // Filter to only valid columns
        const validDataEntries = Object.entries(data).filter(([key]) => isValidColumn(key));
        const validWhereEntries = Object.entries(where).filter(([key]) => isValidColumn(key));
        
        if (validDataEntries.length === 0) {
          return res.status(400).json({ error: 'No valid data columns provided' });
        }
        if (validWhereEntries.length === 0) {
          return res.status(400).json({ error: 'No valid where columns provided' });
        }

        const setClauses: string[] = [];
        const whereClauses: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        for (const [key, value] of validDataEntries) {
          setClauses.push(`"${key}" = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }

        for (const [key, value] of validWhereEntries) {
          if (value === null) {
            whereClauses.push(`"${key}" IS NULL`);
          } else {
            whereClauses.push(`"${key}" = $${paramIndex}`);
            values.push(value);
            paramIndex++;
          }
        }

        const query = `UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')} RETURNING *`;
        const updatedRows = await sql(query, values);

        res.json({ success: true, rowsAffected: updatedRows.length, rows: updatedRows });
      } else if (operation === 'delete') {
        if (!where || Object.keys(where).length === 0) {
          return res.status(400).json({ error: 'Where clause is required for delete operation' });
        }

        // Filter to only valid columns
        const validWhereEntries = Object.entries(where).filter(([key]) => isValidColumn(key));
        if (validWhereEntries.length === 0) {
          return res.status(400).json({ error: 'No valid where columns provided' });
        }

        const whereClauses: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        for (const [key, value] of validWhereEntries) {
          if (value === null) {
            whereClauses.push(`"${key}" IS NULL`);
          } else {
            whereClauses.push(`"${key}" = $${paramIndex}`);
            values.push(value);
            paramIndex++;
          }
        }

        const query = `DELETE FROM "${tableName}" WHERE ${whereClauses.join(' AND ')}`;
        await sql(query, values);

        res.json({ success: true, message: 'Row deleted successfully' });
      } else {
        res.status(400).json({ error: 'Invalid operation' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate and download full database backup
  app.post("/api/db/backup", async (req, res) => {
    try {
      const result = backupRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).message });
      }

      const { db, selectedTables } = result.data;
      const dbUrl = getDatabaseUrl(db);

      if (!dbUrl) {
        return res.status(400).json({ 
          error: `${db === "source" ? "DATABASE_URL_OLD" : "DATABASE_URL_NEW"} not configured` 
        });
      }

      const sql = neon(dbUrl);

      // Get list of tables to backup
      let tables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      let tablesToBackup = tables.map((t: any) => t.table_name)
        .filter((name: string) => !isSystemTable(name));

      // If specific tables provided, use those
      if (selectedTables && selectedTables.length > 0) {
        tablesToBackup = tablesToBackup.filter((name: string) => selectedTables.includes(name));
      }

      let sqlDump = `-- Database Backup (${db === 'source' ? 'Source' : 'Destination'})\n`;
      sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
      sqlDump += "-- Format: SQL\n\n";

      // Dump each table
      for (const tableName of tablesToBackup) {
        try {
          // Get table structure
          const columns = await sql`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${tableName}
            ORDER BY ordinal_position
          `;

          // Build CREATE TABLE
          const columnDefs = columns.map((col: any) => {
            let def = `"${col.column_name}" ${col.data_type}`;
            if (col.character_maximum_length) {
              def += `(${col.character_maximum_length})`;
            }
            if (col.is_nullable === 'NO') {
              def += ' NOT NULL';
            }
            if (col.column_default) {
              def += ` DEFAULT ${col.column_default}`;
            }
            return def;
          }).join(',\n  ');

          sqlDump += `\n-- Table: ${tableName}\n`;
          sqlDump += `DROP TABLE IF EXISTS "${tableName}" CASCADE;\n`;
          sqlDump += `CREATE TABLE "${tableName}" (\n  ${columnDefs}\n);\n`;

          // Get data
          const data = await sql(`SELECT * FROM "${tableName}"`);

          if (data.length > 0) {
            sqlDump += `\n-- Data for ${tableName}\n`;
            for (const row of data) {
              const cols = Object.keys(row);
              const vals = cols.map(c => {
                const val = row[c];
                if (val === null) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                if (val instanceof Date) return `'${val.toISOString()}'`;
                if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                return val;
              });
              sqlDump += `INSERT INTO "${tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});\n`;
            }
          }
        } catch (error: any) {
          sqlDump += `\n-- Error dumping table ${tableName}: ${error.message}\n`;
        }
      }

      const filename = `backup_${db}_${new Date().toISOString().split('T')[0]}.sql`;
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(sqlDump);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Execute raw SQL query (read-only for safety)
  app.post("/api/db/query", async (req, res) => {
    try {
      const { db, query } = req.body;
      const dbSelection = dbSelectionSchema.parse(db || "source");
      const dbUrl = getDatabaseUrl(dbSelection);

      if (!dbUrl) {
        return res.status(400).json({ 
          error: `${dbSelection === "source" ? "DATABASE_URL_OLD" : "DATABASE_URL_NEW"} not configured` 
        });
      }

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query is required' });
      }

      // Basic safety check - only allow SELECT queries
      const trimmedQuery = query.trim().toUpperCase();
      if (!trimmedQuery.startsWith('SELECT')) {
        return res.status(400).json({ 
          error: 'Only SELECT queries are allowed for safety. Use row operations for modifications.' 
        });
      }

      const sql = neon(dbUrl);
      const result = await sql(query);

      res.json({ 
        success: true, 
        rows: result,
        rowCount: result.length
      });
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
