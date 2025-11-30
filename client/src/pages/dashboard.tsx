import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Database, 
  ArrowRight, 
  Server, 
  Play, 
  CheckCircle2, 
  Loader2, 
  AlertCircle,
  Terminal,
  Table as TableIcon,
  Download,
  Code
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

// Form Schema for DB Connection
const connectionSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.string().min(1, "Port is required"),
  database: z.string().min(1, "Database name is required"),
  user: z.string().min(1, "User is required"),
  password: z.string().min(1, "Password is required"),
});

type ConnectionFormValues = z.infer<typeof connectionSchema>;

// Mock Tables for visualization
const MOCK_TABLES = [
  { name: "users", rows: 15420, size: "45MB" },
  { name: "orders", rows: 32100, size: "120MB" },
  { name: "products", rows: 850, size: "5MB" },
  { name: "transactions", rows: 125000, size: "540MB" },
  { name: "logs", rows: 890000, size: "2.1GB" },
];

export default function DatabaseMigrator() {
  const [step, setStep] = useState<"connect" | "analyze" | "migrating" | "complete">("connect");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const sourceForm = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { host: "localhost", port: "5432", user: "postgres" }
  });

  const destForm = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { host: "production-db.aws.com", port: "5432", user: "admin" }
  });

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleConnect = async () => {
    const sourceValid = await sourceForm.trigger();
    const destValid = await destForm.trigger();

    if (sourceValid && destValid) {
      setStep("analyze");
      addLog("Attempting connection to source database...");
      setTimeout(() => addLog("Source connection established."), 800);
      setTimeout(() => addLog("Attempting connection to destination database..."), 1200);
      setTimeout(() => addLog("Destination connection established."), 1800);
      setTimeout(() => addLog("Analyzing schema..."), 2200);
      setTimeout(() => addLog("Found 5 tables to migrate."), 2800);
    } else {
      toast({
        title: "Invalid Configuration",
        description: "Please check your connection details.",
        variant: "destructive"
      });
    }
  };

  const startMigration = () => {
    setStep("migrating");
    addLog("Starting migration process...");
    
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.random() * 10;
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(interval);
        setStep("complete");
        addLog("Migration completed successfully.");
        toast({
          title: "Migration Complete",
          description: "All tables and data have been replicated.",
        });
      }
      setProgress(currentProgress);
      
      // Random log generation during progress
      if (Math.random() > 0.7) {
        const table = MOCK_TABLES[Math.floor(Math.random() * MOCK_TABLES.length)];
        addLog(`Copying table '${table.name}'... processed ${Math.floor(Math.random() * table.rows)} rows.`);
      }
    }, 800);
  };

  const downloadScript = () => {
    toast({
      title: "Downloading Script",
      description: "Generating migration.py...",
    });
    setTimeout(() => {
      const element = document.createElement("a");
      const file = new Blob(["# Python Migration Script\nimport psycopg2\n# ... logic here"], {type: 'text/plain'});
      element.href = URL.createObjectURL(file);
      element.download = "migration.py";
      document.body.appendChild(element);
      element.click();
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans selection:bg-primary/20">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
              <Database className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">DB Replicator Pro</h1>
              <p className="text-muted-foreground text-sm">Python-based Schema & Data Migration Tool</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">v1.0.4-stable</Badge>
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">System Online</span>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Configuration */}
          <div className="lg:col-span-2 space-y-6">
            <AnimatePresence mode="wait">
              {step === "connect" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Source DB Form */}
                    <Card className="border-primary/20 shadow-lg shadow-primary/5">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Server className="w-4 h-4 text-muted-foreground" />
                          Source Database
                        </CardTitle>
                        <CardDescription>Read-only access required</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label>Host</Label>
                          <Input {...sourceForm.register("host")} className="font-mono text-sm" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Port</Label>
                            <Input {...sourceForm.register("port")} className="font-mono text-sm" />
                          </div>
                          <div className="space-y-2">
                            <Label>Database</Label>
                            <Input {...sourceForm.register("database")} placeholder="my_db" className="font-mono text-sm" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>User</Label>
                            <Input {...sourceForm.register("user")} className="font-mono text-sm" />
                          </div>
                          <div className="space-y-2">
                            <Label>Password</Label>
                            <Input {...sourceForm.register("password")} type="password" placeholder="••••••" className="font-mono text-sm" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Destination DB Form */}
                    <Card className="border-border/50">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Database className="w-4 h-4 text-muted-foreground" />
                          Destination Database
                        </CardTitle>
                        <CardDescription>Write access required</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label>Host</Label>
                          <Input {...destForm.register("host")} className="font-mono text-sm" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Port</Label>
                            <Input {...destForm.register("port")} className="font-mono text-sm" />
                          </div>
                          <div className="space-y-2">
                            <Label>Database</Label>
                            <Input {...destForm.register("database")} placeholder="replica_db" className="font-mono text-sm" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>User</Label>
                            <Input {...destForm.register("user")} className="font-mono text-sm" />
                          </div>
                          <div className="space-y-2">
                            <Label>Password</Label>
                            <Input {...destForm.register("password")} type="password" placeholder="••••••" className="font-mono text-sm" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Button size="lg" className="w-full text-md" onClick={handleConnect}>
                    <Terminal className="w-4 h-4 mr-2" />
                    Test Connections & Analyze Schema
                  </Button>
                </motion.div>
              )}

              {step === "analyze" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  <Card className="border-primary/20">
                    <CardHeader>
                      <CardTitle>Schema Analysis</CardTitle>
                      <CardDescription>Review tables to be replicated</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {MOCK_TABLES.map((table, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-md border border-border/50">
                            <div className="flex items-center gap-3">
                              <TableIcon className="w-4 h-4 text-primary" />
                              <span className="font-mono text-sm">{table.name}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span>{table.rows.toLocaleString()} rows</span>
                              <span className="w-16 text-right">{table.size}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                  
                  <div className="flex gap-4">
                    <Button variant="outline" onClick={() => setStep("connect")}>Back</Button>
                    <Button className="flex-1" onClick={startMigration}>
                      <Play className="w-4 h-4 mr-2" />
                      Start Replication
                    </Button>
                  </div>
                </motion.div>
              )}

              {(step === "migrating" || step === "complete") && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <Card className="border-primary/20">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>Migration Status</CardTitle>
                        {step === "migrating" ? (
                          <Badge variant="secondary" className="animate-pulse text-amber-500">Processing</Badge>
                        ) : (
                          <Badge className="bg-emerald-500 hover:bg-emerald-600">Completed</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Total Progress</span>
                          <span className="font-mono">{Math.round(progress)}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                          <div className="text-2xl font-bold font-mono">{step === "complete" ? "154k" : Math.floor(154000 * (progress/100)).toLocaleString()}</div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Rows Copied</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                          <div className="text-2xl font-bold font-mono">{step === "complete" ? "5" : "2"}</div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Tables Completed</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                          <div className="text-2xl font-bold font-mono">{step === "complete" ? "0" : "0"}</div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Errors</div>
                        </div>
                      </div>

                      {step === "complete" && (
                        <div className="flex gap-3">
                          <Button className="flex-1" variant="outline" onClick={downloadScript}>
                            <Code className="w-4 h-4 mr-2" />
                            Download Python Script
                          </Button>
                          <Button className="flex-1" variant="secondary" onClick={() => setStep("connect")}>
                            Start New Migration
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column: Logs & Info */}
          <div className="space-y-6">
            <Card className="h-[500px] flex flex-col bg-black/40 border-border/50">
              <CardHeader className="py-4 border-b border-border/50">
                <CardTitle className="text-sm font-mono flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  System Logs
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <div className="h-full overflow-y-auto p-4 space-y-2 font-mono text-xs">
                  <div className="text-muted-foreground/50"> Waiting for process start...</div>
                  {logs.map((log, i) => (
                    <div key={i} className="text-emerald-500/80 border-l-2 border-emerald-500/20 pl-2">
                      {log}
                    </div>
                  ))}
                  {step === "migrating" && (
                    <div className="flex items-center gap-2 text-amber-500/80 pl-2 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Processing...
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/10">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-primary">Safe Mode Active</h4>
                  <p className="text-xs text-muted-foreground">
                    Operations are running in simulation mode. No actual data will be modified in the destination database until "Commit" is explicitly called.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
