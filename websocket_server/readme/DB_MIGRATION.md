# Database Migration: Motoko to TypeScript/Redis

This document describes the migration of the database system from Motoko canisters to TypeScript with Redis.

## Overview

The original system used Motoko canisters with CanDB for data storage. This has been migrated to a TypeScript-based system using Redis as the primary database.

## Architecture Changes

### Before (Motoko/CanDB)
- **Storage**: CanDB (distributed database on Internet Computer)
- **Language**: Motoko
- **Data Access**: Canister methods
- **Scaling**: Auto-scaling through CanDB

### After (TypeScript/Redis)
- **Storage**: Redis (in-memory data structure store)
- **Language**: TypeScript
- **Data Access**: Redis client operations
- **Scaling**: Redis clustering (if needed)

## Key Components

### 1. Database Types (`src/db/types.ts`)
- Migrated all Motoko types to TypeScript interfaces
- Added Redis-specific types and configurations
- Maintained compatibility with existing data structures

### 2. Database Layer (`src/db/database.ts`)
- Core Redis operations
- CRUD operations for clients, jobs, sessions
- Indexing for efficient queries
- Error handling and result types

### 3. Service Layer (`src/db/service.ts`)
- Business logic migrated from Motoko
- Client authentication and management
- Job assignment and completion
- Session management
- Reward and earnings tracking

## Data Migration

### Client Data
```typescript
// Old (Motoko)
type ClientStruct = {
  user_principal_id : Text;
  client_id : Int;
  jobID : Text;
  // ... other fields
};

// New (TypeScript)
interface ClientStruct {
  user_principal_id: string;
  client_id: number;
  jobID: string;
  // ... other fields
}
```

### Job Data
```typescript
// Old (Motoko)
type JobStruct = {
  jobID : Text;
  clientUUID : Text;
  storedID : Int;
  // ... other fields
};

// New (TypeScript)
interface JobStruct {
  jobID: string;
  clientUUID: string;
  storedID: number;
  // ... other fields
}
```

## Redis Key Structure

### Clients
- Key: `client:{user_principal_id}`
- Index: `index:clients:status:{status}`

### Jobs
- Key: `job:{jobID}`
- Index: `index:jobs:state:{state}`
- Index: `index:jobs:user:{user_principal_id}`

### Sessions
- Key: `session:{sessionId}`
- Index: `index:sessions:user:{user_principal_id}`

### API Keys
- Key: `apikey:{user_principal_id}`

## Environment Configuration

Add these environment variables to your `.env` file:

```env
# Redis Configuration
REDIS_URL=redis://:sela123@127.0.0.1:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=sela123
REDIS_DB=0

# Database Settings
DEAD_TIMEOUT=3600000
SESSION_TIMEOUT=86400
USAGE_LIMIT=10000
MAX_JOBS_PER_CLIENT=10
```

## Usage Examples

### Initialize Database
```typescript
import { Database, DatabaseService } from './db';

const db = new Database(config);
const dbService = new DatabaseService(db);

await db.connect();
```

### Client Operations
```typescript
// Login/Create client
const result = await dbService.login(userPrincipalId);

// Update client
await dbService.updateClient(userPrincipalId, {
  downloadSpeed: 100.5,
  clientStatus: 'Active'
});

// Get client
const client = await dbService.getClient(userPrincipalId);
```

### Job Operations
```typescript
// Create job
const jobId = await dbService.addJobToDB(clientUUID, 'scraping', 'target_url');

// Assign job to client
await dbService.assignJobToClient(jobId, clientId);

// Complete job
await dbService.updateJobCompleted(jobId, clientId);
```


## Migration Notes

- All existing functionality has been preserved
- Error handling has been improved with typed results
- Session management is now handled through Redis
- API key management has been added
- Uptime statistics are calculated in real-time
