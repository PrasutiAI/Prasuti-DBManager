import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { 
  Database, 
  Table as TableIcon, 
  Download,
  RefreshCw,
  Search,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Columns,
  Key,
  Hash,
  Eye,
  ArrowUpDown,
  Server,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Link,
  Unlink
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TableInfo, TableColumn, TableStructure, TableDataPage, DbSelection } from "@shared/schema";

const connectionSchema = z.object({
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
  message: "Please provide either a connection string or all connection details",
  path: ["connectionString"],
});

type ConnectionFormValues = z.infer<typeof connectionSchema>;

export default function DatabaseManager() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionMode, setConnectionMode] = useState<"env" | "manual">("env");
  const [useConnectionString, setUseConnectionString] = useState(true);
  const [selectedDb, setSelectedDb] = useState<DbSelection>("source");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchQuery, setSearchQuery] = useState("");
  const [orderBy, setOrderBy] = useState<string | undefined>();
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("asc");
  const [isAddRowOpen, setIsAddRowOpen] = useState(false);
  const [isEditRowOpen, setIsEditRowOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingRow, setDeletingRow] = useState<Record<string, any> | null>(null);
  const [activeTab, setActiveTab] = useState<"tables" | "structure" | "data" | "query">("tables");
  const [sqlQuery, setSqlQuery] = useState("SELECT * FROM ");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [backupMode, setBackupMode] = useState<"schema" | "data">("data");
  const [backupTableToUse, setBackupTableToUse] = useState<string | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const connectionForm = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { 
      host: "localhost", 
      port: "5432", 
      user: "postgres",
      database: "",
      password: "",
      connectionString: "" 
    }
  });

  // Fetch config status
  const { data: configData } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      return res.json();
    }
  });

  // Connect using environment variables
  const handleEnvConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await fetch("/api/quick-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      
      setIsConnected(true);
      setConnectionMode("env");
      toast({
        title: "Connected",
        description: "Successfully connected to databases using environment variables"
      });
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsConnecting(false);
    }
  };

  // Connect using manual credentials
  const handleManualConnect = async (values: ConnectionFormValues) => {
    setIsConnecting(true);
    try {
      // Test connection to the provided database
      const connectionPayload = useConnectionString 
        ? { connectionString: values.connectionString }
        : { 
            host: values.host,
            port: values.port,
            database: values.database,
            user: values.user,
            password: values.password
          };

      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: connectionPayload,
          destination: connectionPayload
        })
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Connection failed");
      }
      
      setIsConnected(true);
      setConnectionMode("manual");
      toast({
        title: "Connected",
        description: "Successfully connected to database"
      });
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setSelectedTable(null);
    queryClient.invalidateQueries({ queryKey: ["tables"] });
    toast({
      title: "Disconnected",
      description: "Database connection closed"
    });
  };

  // Fetch tables list
  const { data: tablesData, isLoading: tablesLoading, refetch: refetchTables } = useQuery({
    queryKey: ["tables", selectedDb],
    queryFn: async () => {
      const res = await fetch(`/api/db/tables?db=${selectedDb}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      return res.json();
    },
    enabled: isConnected && connectionMode === "env"
  });

  // Fetch table structure
  const { data: structureData, isLoading: structureLoading } = useQuery({
    queryKey: ["structure", selectedDb, selectedTable],
    queryFn: async () => {
      if (!selectedTable) return null;
      const res = await fetch(`/api/db/structure/${selectedTable}?db=${selectedDb}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      return res.json() as Promise<TableStructure>;
    },
    enabled: !!selectedTable && isConnected
  });

  // Fetch table data
  const { data: tableData, isLoading: dataLoading, refetch: refetchData } = useQuery({
    queryKey: ["tableData", selectedDb, selectedTable, currentPage, pageSize, searchQuery, orderBy, orderDir],
    queryFn: async () => {
      if (!selectedTable) return null;
      const res = await fetch("/api/db/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: selectedDb,
          tableName: selectedTable,
          page: currentPage,
          pageSize,
          search: searchQuery,
          orderBy,
          orderDir
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      return res.json() as Promise<TableDataPage>;
    },
    enabled: !!selectedTable && activeTab === "data" && isConnected
  });

  // Row mutation
  const rowMutation = useMutation({
    mutationFn: async (params: { operation: "insert" | "update" | "delete"; data?: Record<string, any>; where?: Record<string, any> }) => {
      const res = await fetch("/api/db/row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: selectedDb,
          tableName: selectedTable,
          ...params
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Success",
        description: `Row ${variables.operation}ed successfully`
      });
      refetchData();
      refetchTables();
      setIsAddRowOpen(false);
      setIsEditRowOpen(false);
      setDeleteConfirmOpen(false);
      setFormData({});
      setEditingRow(null);
      setDeletingRow(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Execute SQL query
  const executeSqlMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await fetch("/api/db/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: selectedDb,
          query
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setQueryResult(data);
      toast({
        title: "Query executed",
        description: `Returned ${data.rowCount} rows`
      });
    },
    onError: (error: Error) => {
      setQueryResult({ error: error.message });
      toast({
        title: "Query failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Backup download
  const downloadBackup = async (selectedTables?: string[], includeData: boolean = true) => {
    try {
      const res = await fetch("/api/db/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: selectedDb,
          selectedTables,
          includeData
        })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      const blob = await res.blob();
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.download = `backup_${selectedDb}_${new Date().toISOString().split('T')[0]}.sql`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);

      toast({
        title: "Backup downloaded",
        description: "SQL backup file has been downloaded"
      });
    } catch (error: any) {
      toast({
        title: "Backup failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleBackupClick = (tableName?: string) => {
    setBackupTableToUse(tableName || null);
    setIsBackupDialogOpen(true);
  };

  const handleConfirmBackup = () => {
    const includeData = backupMode === "data";
    const tablesToBackup = backupTableToUse ? [backupTableToUse] : undefined;
    downloadBackup(tablesToBackup, includeData);
    setIsBackupDialogOpen(false);
  };

  const handleTableSelect = (tableName: string) => {
    setSelectedTable(tableName);
    setCurrentPage(1);
    setSearchQuery("");
    setOrderBy(undefined);
    setActiveTab("data");
  };

  const handleSort = (column: string) => {
    if (orderBy === column) {
      setOrderDir(orderDir === "asc" ? "desc" : "asc");
    } else {
      setOrderBy(column);
      setOrderDir("asc");
    }
    setCurrentPage(1);
  };

  const handleAddRow = () => {
    if (structureData) {
      const initialData: Record<string, any> = {};
      structureData.columns.forEach(col => {
        initialData[col.name] = col.defaultValue || "";
      });
      setFormData(initialData);
      setIsAddRowOpen(true);
    }
  };

  const handleEditRow = (row: Record<string, any>) => {
    setEditingRow(row);
    setFormData({ ...row });
    setIsEditRowOpen(true);
  };

  const handleDeleteRow = (row: Record<string, any>) => {
    setDeletingRow(row);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (deletingRow) {
      rowMutation.mutate({ operation: "delete", where: deletingRow });
    }
  };

  const submitAddRow = () => {
    const cleanData: Record<string, any> = {};
    Object.entries(formData).forEach(([key, value]) => {
      if (value !== "" && value !== null) {
        cleanData[key] = value;
      }
    });
    rowMutation.mutate({ operation: "insert", data: cleanData });
  };

  const submitEditRow = () => {
    if (editingRow) {
      rowMutation.mutate({ operation: "update", data: formData, where: editingRow });
    }
  };

  const formatCellValue = (value: any): string => {
    if (value === null) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const tables: TableInfo[] = tablesData?.tables || [];

  // Connection Screen
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6 font-sans">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <header className="text-center space-y-2">
            <div className="inline-flex p-4 bg-primary/10 rounded-xl border border-primary/20">
              <Database className="w-12 h-12 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Database Manager</h1>
            <p className="text-muted-foreground">Connect to your PostgreSQL database to view, edit, and backup your data</p>
          </header>

          {/* Connection Options */}
          <div className="space-y-6">
            {/* Environment Variables Option */}
            {(configData?.sourceConfigured || configData?.destinationConfigured) && (
              <Card className="border-2 border-emerald-500/30 bg-emerald-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    Quick Connect
                  </CardTitle>
                  <CardDescription>
                    Use pre-configured database connections from environment variables
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-sm">
                    <Badge variant={configData?.sourceConfigured ? "default" : "secondary"}>
                      Source: {configData?.sourceConfigured ? "Configured" : "Not set"}
                    </Badge>
                    <Badge variant={configData?.destinationConfigured ? "default" : "secondary"}>
                      Destination: {configData?.destinationConfigured ? "Configured" : "Not set"}
                    </Badge>
                  </div>
                  <Button 
                    onClick={handleEnvConnect}
                    disabled={isConnecting || !configData?.sourceConfigured}
                    className="w-full"
                    data-testid="button-quick-connect"
                  >
                    {isConnecting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Link className="w-4 h-4 mr-2" />
                    )}
                    Connect with Environment Variables
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Manual Connection Option */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Server className="w-5 h-5" />
                  Manual Connection
                </CardTitle>
                <CardDescription>
                  Enter your database credentials to connect
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={connectionForm.handleSubmit(handleManualConnect)} className="space-y-4">
                  <Tabs value={useConnectionString ? "string" : "details"} onValueChange={(v) => setUseConnectionString(v === "string")}>
                    <TabsList className="w-full">
                      <TabsTrigger value="string" className="flex-1" data-testid="tab-connection-string">
                        Connection String
                      </TabsTrigger>
                      <TabsTrigger value="details" className="flex-1" data-testid="tab-connection-details">
                        Connection Details
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {useConnectionString ? (
                    <div className="space-y-2">
                      <Label htmlFor="connectionString">Connection String</Label>
                      <Input
                        id="connectionString"
                        placeholder="postgresql://user:password@host:5432/database"
                        {...connectionForm.register("connectionString")}
                        data-testid="input-connection-string"
                      />
                      <p className="text-xs text-muted-foreground">
                        Format: postgresql://user:password@host:port/database
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="host">Host</Label>
                        <Input
                          id="host"
                          placeholder="localhost"
                          {...connectionForm.register("host")}
                          data-testid="input-host"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input
                          id="port"
                          placeholder="5432"
                          {...connectionForm.register("port")}
                          data-testid="input-port"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="database">Database</Label>
                        <Input
                          id="database"
                          placeholder="mydb"
                          {...connectionForm.register("database")}
                          data-testid="input-database"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="user">User</Label>
                        <Input
                          id="user"
                          placeholder="postgres"
                          {...connectionForm.register("user")}
                          data-testid="input-user"
                        />
                      </div>
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          {...connectionForm.register("password")}
                          data-testid="input-password"
                        />
                      </div>
                    </div>
                  )}

                  {connectionForm.formState.errors.connectionString && (
                    <p className="text-sm text-destructive">
                      {connectionForm.formState.errors.connectionString.message}
                    </p>
                  )}

                  <Button 
                    type="submit" 
                    disabled={isConnecting}
                    className="w-full"
                    data-testid="button-connect"
                  >
                    {isConnecting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Link className="w-4 h-4 mr-2" />
                    )}
                    Connect
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Connected - Show Database Manager
  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
              <Database className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Database Manager</h1>
              <p className="text-muted-foreground text-sm">View, edit, and backup your database</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {connectionMode === "env" && (
              <Select value={selectedDb} onValueChange={(v) => { setSelectedDb(v as DbSelection); setSelectedTable(null); }}>
                <SelectTrigger className="w-48" data-testid="select-database">
                  <Server className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="source" data-testid="option-source">
                    Source Database
                  </SelectItem>
                  <SelectItem value="destination" data-testid="option-destination">
                    Destination Database
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button 
              variant="outline" 
              onClick={() => refetchTables()}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button 
              onClick={() => handleBackupClick()}
              data-testid="button-backup"
            >
              <Download className="w-4 h-4 mr-2" />
              Backup All
            </Button>
            <Button 
              variant="destructive"
              onClick={handleDisconnect}
              data-testid="button-disconnect"
            >
              <Unlink className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          </div>
        </header>

        {/* Status */}
        <div className="flex items-center gap-4">
          <Badge variant="default" className="bg-emerald-500" data-testid="status-connected">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Connected
          </Badge>
          {connectionMode === "env" && (
            <>
              <Badge variant={configData?.sourceConfigured ? "default" : "destructive"} data-testid="status-source">
                Source: {configData?.sourceConfigured ? "Active" : "Not configured"}
              </Badge>
              <Badge variant={configData?.destinationConfigured ? "default" : "secondary"} data-testid="status-destination">
                Destination: {configData?.destinationConfigured ? "Active" : "Not configured"}
              </Badge>
            </>
          )}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Tables List */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TableIcon className="w-5 h-5" />
                Tables
              </CardTitle>
              <CardDescription>
                {tables.length} table{tables.length !== 1 ? "s" : ""} found
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[600px]">
                {tablesLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : tables.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No tables found
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {tables.map((table) => (
                      <button
                        key={table.name}
                        onClick={() => handleTableSelect(table.name)}
                        className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
                          selectedTable === table.name ? "bg-primary/10 border-l-2 border-primary" : ""
                        }`}
                        data-testid={`table-item-${table.name}`}
                      >
                        <div className="font-medium text-sm truncate">{table.name}</div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Hash className="w-3 h-3" />
                            {table.rows.toLocaleString()} rows
                          </span>
                          <span>{table.size}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Table Details */}
          <Card className="lg:col-span-3">
            {!selectedTable ? (
              <div className="flex items-center justify-center h-[650px] text-muted-foreground">
                <div className="text-center">
                  <TableIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Select a table to view its data</p>
                </div>
              </div>
            ) : (
              <>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg" data-testid="text-selected-table">{selectedTable}</CardTitle>
                      <CardDescription>
                        {structureData && `${structureData.columns.length} columns`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleBackupClick(selectedTable)}
                        data-testid="button-backup-table"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Backup
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                    <TabsList className="mb-4">
                      <TabsTrigger value="data" data-testid="tab-data">
                        <Eye className="w-4 h-4 mr-2" />
                        Data
                      </TabsTrigger>
                      <TabsTrigger value="structure" data-testid="tab-structure">
                        <Columns className="w-4 h-4 mr-2" />
                        Structure
                      </TabsTrigger>
                      <TabsTrigger value="query" data-testid="tab-query">
                        <Database className="w-4 h-4 mr-2" />
                        Query
                      </TabsTrigger>
                    </TabsList>

                    {/* Data Tab */}
                    <TabsContent value="data" className="mt-0">
                      <div className="space-y-4">
                        {/* Toolbar */}
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 flex-1">
                            <div className="relative flex-1 max-w-sm">
                              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="pl-9"
                                data-testid="input-search"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                              <SelectTrigger className="w-24" data-testid="select-pagesize">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="25">25</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button onClick={handleAddRow} data-testid="button-add-row">
                              <Plus className="w-4 h-4 mr-2" />
                              Add Row
                            </Button>
                          </div>
                        </div>

                        {/* Data Table */}
                        <div className="border rounded-lg overflow-hidden">
                          <ScrollArea className="h-[400px]">
                            {dataLoading ? (
                              <div className="flex items-center justify-center h-full">
                                <Loader2 className="w-6 h-6 animate-spin" />
                              </div>
                            ) : tableData && tableData.rows.length > 0 ? (
                              <Table>
                                <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
                                  <TableRow>
                                    <TableHead className="w-20">Actions</TableHead>
                                    {tableData.columns.map((col) => (
                                      <TableHead 
                                        key={col}
                                        className="cursor-pointer hover:bg-muted"
                                        onClick={() => handleSort(col)}
                                      >
                                        <div className="flex items-center gap-1">
                                          {col}
                                          {orderBy === col && (
                                            <ArrowUpDown className={`w-3 h-3 ${orderDir === 'desc' ? 'rotate-180' : ''}`} />
                                          )}
                                        </div>
                                      </TableHead>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {tableData.rows.map((row, idx) => (
                                    <TableRow key={idx} data-testid={`data-row-${idx}`}>
                                      <TableCell>
                                        <div className="flex items-center gap-1">
                                          <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-7 w-7"
                                            onClick={() => handleEditRow(row)}
                                            data-testid={`button-edit-row-${idx}`}
                                          >
                                            <Pencil className="w-3 h-3" />
                                          </Button>
                                          <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={() => handleDeleteRow(row)}
                                            data-testid={`button-delete-row-${idx}`}
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      </TableCell>
                                      {tableData.columns.map((col) => (
                                        <TableCell key={col} className="font-mono text-xs max-w-[200px] truncate">
                                          {formatCellValue(row[col])}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            ) : (
                              <div className="flex items-center justify-center h-full text-muted-foreground">
                                No data found
                              </div>
                            )}
                          </ScrollArea>
                        </div>

                        {/* Pagination */}
                        {tableData && tableData.totalPages > 1 && (
                          <div className="flex items-center justify-between">
                            <div className="text-sm text-muted-foreground">
                              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, tableData.totalRows)} of {tableData.totalRows.toLocaleString()} rows
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                data-testid="button-prev-page"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </Button>
                              <span className="text-sm">
                                Page {currentPage} of {tableData.totalPages}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.min(tableData.totalPages, p + 1))}
                                disabled={currentPage === tableData.totalPages}
                                data-testid="button-next-page"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* Structure Tab */}
                    <TabsContent value="structure" className="mt-0">
                      {structureLoading ? (
                        <div className="flex items-center justify-center h-[400px]">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      ) : structureData ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-3 gap-4">
                            <Card className="p-4">
                              <div className="text-sm text-muted-foreground">Columns</div>
                              <div className="text-2xl font-bold">{structureData.columns.length}</div>
                            </Card>
                            <Card className="p-4">
                              <div className="text-sm text-muted-foreground">Rows</div>
                              <div className="text-2xl font-bold">{structureData.rowCount.toLocaleString()}</div>
                            </Card>
                            <Card className="p-4">
                              <div className="text-sm text-muted-foreground">Primary Keys</div>
                              <div className="text-2xl font-bold">{structureData.primaryKeys.length}</div>
                            </Card>
                          </div>

                          <div className="border rounded-lg overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Column Name</TableHead>
                                  <TableHead>Data Type</TableHead>
                                  <TableHead>Nullable</TableHead>
                                  <TableHead>Default</TableHead>
                                  <TableHead>Key</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {structureData.columns.map((col) => (
                                  <TableRow key={col.name} data-testid={`structure-col-${col.name}`}>
                                    <TableCell className="font-medium">{col.name}</TableCell>
                                    <TableCell className="font-mono text-sm">
                                      {col.dataType}
                                      {col.maxLength && `(${col.maxLength})`}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant={col.isNullable ? "secondary" : "outline"}>
                                        {col.isNullable ? "Yes" : "No"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                                      {col.defaultValue || "-"}
                                    </TableCell>
                                    <TableCell>
                                      {col.isPrimaryKey && (
                                        <Badge variant="default">
                                          <Key className="w-3 h-3 mr-1" />
                                          PK
                                        </Badge>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      ) : null}
                    </TabsContent>

                    {/* Query Tab */}
                    <TabsContent value="query" className="mt-0">
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="sql-query">SQL Query (SELECT only)</Label>
                          <Textarea
                            id="sql-query"
                            value={sqlQuery}
                            onChange={(e) => setSqlQuery(e.target.value)}
                            placeholder="SELECT * FROM table_name WHERE ..."
                            className="font-mono min-h-[100px]"
                            data-testid="input-sql-query"
                          />
                        </div>
                        <Button 
                          onClick={() => executeSqlMutation.mutate(sqlQuery)}
                          disabled={executeSqlMutation.isPending}
                          data-testid="button-execute-query"
                        >
                          {executeSqlMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Database className="w-4 h-4 mr-2" />
                          )}
                          Execute Query
                        </Button>

                        {queryResult && (
                          <div className="border rounded-lg overflow-hidden">
                            {queryResult.error ? (
                              <div className="p-4 text-destructive bg-destructive/10">
                                <AlertCircle className="w-4 h-4 inline mr-2" />
                                {queryResult.error}
                              </div>
                            ) : (
                              <>
                                <div className="p-2 bg-muted text-sm text-muted-foreground">
                                  {queryResult.rowCount} row{queryResult.rowCount !== 1 ? "s" : ""} returned
                                </div>
                                <ScrollArea className="h-[300px]">
                                  {queryResult.rows.length > 0 && (
                                    <Table>
                                      <TableHeader className="sticky top-0 bg-muted">
                                        <TableRow>
                                          {Object.keys(queryResult.rows[0]).map((col) => (
                                            <TableHead key={col}>{col}</TableHead>
                                          ))}
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {queryResult.rows.map((row: any, idx: number) => (
                                          <TableRow key={idx}>
                                            {Object.values(row).map((val: any, cidx) => (
                                              <TableCell key={cidx} className="font-mono text-xs">
                                                {formatCellValue(val)}
                                              </TableCell>
                                            ))}
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  )}
                                </ScrollArea>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Add Row Dialog */}
      <Dialog open={isAddRowOpen} onOpenChange={setIsAddRowOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Row</DialogTitle>
            <DialogDescription>
              Fill in the values for the new row in {selectedTable}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {structureData?.columns.map((col) => (
              <div key={col.name} className="grid grid-cols-3 gap-4 items-center">
                <Label className="font-medium">
                  {col.name}
                  {!col.isNullable && <span className="text-destructive ml-1">*</span>}
                  <span className="block text-xs text-muted-foreground font-normal mt-1">
                    {col.dataType}
                  </span>
                </Label>
                <div className="col-span-2">
                  <Input
                    value={formData[col.name] || ""}
                    onChange={(e) => setFormData({ ...formData, [col.name]: e.target.value || null })}
                    placeholder={col.defaultValue || `Enter ${col.dataType}`}
                    data-testid={`input-add-${col.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddRowOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={submitAddRow} 
              disabled={rowMutation.isPending}
              data-testid="button-confirm-add"
            >
              {rowMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Row Dialog */}
      <Dialog open={isEditRowOpen} onOpenChange={setIsEditRowOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Row</DialogTitle>
            <DialogDescription>
              Modify the values for this row in {selectedTable}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {structureData?.columns.map((col) => (
              <div key={col.name} className="grid grid-cols-3 gap-4 items-center">
                <Label className="font-medium">
                  {col.name}
                  {col.isPrimaryKey && <Badge variant="outline" className="ml-2 text-xs">PK</Badge>}
                  <span className="block text-xs text-muted-foreground font-normal mt-1">
                    {col.dataType}
                  </span>
                </Label>
                <div className="col-span-2">
                  <Input
                    value={formData[col.name] ?? ""}
                    onChange={(e) => setFormData({ ...formData, [col.name]: e.target.value || null })}
                    disabled={col.isPrimaryKey}
                    data-testid={`input-edit-${col.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditRowOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={submitEditRow} 
              disabled={rowMutation.isPending}
              data-testid="button-confirm-edit"
            >
              {rowMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Row</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this row? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {rowMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Backup Options Dialog */}
      <Dialog open={isBackupDialogOpen} onOpenChange={setIsBackupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backup Options</DialogTitle>
            <DialogDescription>
              Choose whether to backup schema only or schema plus data
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <div 
                className={`p-4 border-2 rounded-lg cursor-pointer transition ${backupMode === 'schema' ? 'border-primary bg-primary/5' : 'border-border'}`}
                onClick={() => setBackupMode('schema')}
                data-testid="option-schema-only"
              >
                <div className="font-semibold">Schema Only</div>
                <div className="text-sm text-muted-foreground">Backup table structure without data</div>
              </div>
              <div 
                className={`p-4 border-2 rounded-lg cursor-pointer transition ${backupMode === 'data' ? 'border-primary bg-primary/5' : 'border-border'}`}
                onClick={() => setBackupMode('data')}
                data-testid="option-data-schema"
              >
                <div className="font-semibold">Data + Schema</div>
                <div className="text-sm text-muted-foreground">Backup complete database with all data</div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBackupDialogOpen(false)} data-testid="button-cancel-backup">
              Cancel
            </Button>
            <Button onClick={handleConfirmBackup} data-testid="button-confirm-backup">
              <Download className="w-4 h-4 mr-2" />
              Download Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
