import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import DatabaseMigrator from "@/pages/dashboard";
import DatabaseManager from "@/pages/database-manager";
import { Database, ArrowRightLeft } from "lucide-react";

function Navigation() {
  const [location] = useLocation();
  
  return (
    <nav className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex h-14 items-center gap-6">
          <Link 
            href="/" 
            className={`flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${
              location === "/" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="nav-migrator"
          >
            <ArrowRightLeft className="w-4 h-4" />
            Migrator
          </Link>
          <Link 
            href="/manager" 
            className={`flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${
              location === "/manager" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="nav-manager"
          >
            <Database className="w-4 h-4" />
            Database Manager
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={DatabaseMigrator} />
      <Route path="/manager" component={DatabaseManager} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Navigation />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
