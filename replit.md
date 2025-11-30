# DB Replicator Pro

## Overview

DB Replicator Pro is a professional database migration, backup, and management tool designed for PostgreSQL databases. The application provides two main features:

1. **Database Migrator**: Migrate data between PostgreSQL databases with connection testing, table filtering, and progress tracking
2. **Database Manager**: View, edit, search, and manage database tables with full CRUD operations, pagination, and export capabilities

The application is built as a full-stack TypeScript application with a React frontend and Express backend, designed to run on Replit's infrastructure.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- **React**: UI framework with functional components and hooks
- **Vite**: Build tool and development server
- **TanStack Query**: Server state management and data fetching
- **Wouter**: Lightweight client-side routing
- **shadcn/ui**: Component library built on Radix UI primitives
- **Tailwind CSS**: Utility-first styling with custom theme configuration

**Design Patterns:**
- Component-based architecture with separation of concerns
- Custom hooks for reusable logic (`use-toast`, `use-mobile`)
- Form validation using `react-hook-form` with Zod schemas
- Toast notifications for user feedback
- Responsive design with mobile-first approach

**Key Features:**
- Two-page navigation (Migrator and Database Manager)
- Real-time connection testing before migrations
- Table data visualization with pagination and search
- Row-level CRUD operations with inline editing
- Progress tracking for long-running operations

### Backend Architecture

**Technology Stack:**
- **Express**: Web server framework
- **Neon Serverless**: PostgreSQL client for serverless environments
- **Drizzle ORM**: Type-safe database toolkit (configured but schema not in use)
- **Zod**: Runtime schema validation
- **TypeScript**: Type safety throughout

**Design Patterns:**
- RESTful API design with `/api` prefix
- Request/response logging middleware
- Schema validation on all API endpoints using Zod
- Helper functions for connection string building and table filtering
- Separation of routing logic and static file serving

**API Endpoints:**
The backend provides several database operation endpoints:

*Migration Routes:*
- `POST /api/connect` - Test source/destination database connections
- `POST /api/analyze` - Analyze source database tables
- `POST /api/dry-run` - Generate execution plan for migration
- `POST /api/quick-migrate` - Execute migration using environment variables
- `POST /api/generate-script` - Generate Python migration script

*Database Manager Routes:*
- `GET /api/db/tables?db=source|destination` - List all tables with row counts and sizes
- `GET /api/db/structure/:tableName?db=source|destination` - Get table structure (columns, types, constraints)
- `POST /api/db/data` - Fetch paginated table data with search and sorting
- `POST /api/db/row` - CRUD operations (insert, update, delete rows)
- `POST /api/db/backup` - Generate and download SQL backup
- `POST /api/db/query` - Execute read-only SQL queries (SELECT only)

**Connection Management:**
- Supports both connection string and individual parameters (host, port, database, user, password)
- Environment variables for configured databases (`DATABASE_URL_OLD`, `DATABASE_URL_NEW`)
- Dynamic connection creation for user-provided databases

### Data Storage

**Database:**
- PostgreSQL as the primary database system
- Drizzle ORM configured with PostgreSQL dialect
- Schema defined in `shared/schema.ts`
- Migrations stored in `./migrations` directory

**Key Design Decisions:**
- No persistent storage for application data - the tool operates on external databases
- Connection credentials are passed per-request, not stored
- Uses Neon Serverless for compatibility with serverless/edge environments

### Build and Deployment

**Development:**
- Concurrent client (Vite) and server (tsx) processes
- Hot module replacement for rapid iteration
- TypeScript checking without emit

**Production:**
- Client built with Vite to `dist/public`
- Server bundled with esbuild to `dist/index.cjs`
- Dependency bundling optimization for reduced cold start times
- Static file serving from compiled client assets

**Build Optimizations:**
- Allowlist-based bundling of critical dependencies
- Tree-shaking for minimal bundle size
- Environment-aware plugin loading (Replit-specific plugins only in development)

## External Dependencies

### Database Services
- **Neon Database**: Serverless PostgreSQL provider (via `@neondatabase/serverless`)
- **PostgreSQL**: Target database system for all operations

### UI Component Libraries
- **Radix UI**: Headless component primitives for accessibility
- **Lucide React**: Icon library
- **shadcn/ui**: Pre-built component patterns

### Development Tools
- **Replit Plugins**: Development experience enhancements
  - `@replit/vite-plugin-runtime-error-modal`: Runtime error overlay
  - `@replit/vite-plugin-cartographer`: Code navigation
  - `@replit/vite-plugin-dev-banner`: Development indicator
- **Custom Vite Plugin**: Meta image URL updater for OpenGraph tags

### Form Handling
- **react-hook-form**: Form state management
- **@hookform/resolvers**: Zod schema integration
- **Zod**: Schema validation and type inference
- **drizzle-zod**: Drizzle ORM to Zod schema conversion

### Utilities
- **date-fns**: Date manipulation and formatting
- **clsx**: Conditional className composition
- **class-variance-authority**: Component variant patterns
- **nanoid**: Unique ID generation
- **framer-motion**: Animation library for UI transitions