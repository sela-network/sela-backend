# RPC System - API Reference

## Quick Start

### HTTP API Base URL
```
http://localhost:8082/api/rpc
```

### WebSocket URL
```
ws://localhost:8082
```

## HTTP Endpoints

### Authentication
Protected endpoints require API key in header:
```
Authorization: <your-api-key>
```

### Core Endpoints

**Health Check**
```bash
GET /ping
curl http://localhost:8082/api/rpc/ping
```

**Register Client** (Get API Key)
```bash
POST /registerClient
curl -X POST http://localhost:8082/api/rpc/registerClient \
  -H "Content-Type: application/json" \
  -d '{"uuid": "your-uuid"}'
```

**Add Job** 🔐
```bash
POST /addJob
curl -X POST http://localhost:8082/api/rpc/addJob \
  -H "Authorization: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "scrapeType": "HTML"}'
```

**Assign Job** 🔐
```bash
POST /assignJob
curl -X POST http://localhost:8082/api/rpc/assignJob \
  -H "Authorization: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"jobId": "job-id-here"}'
```

**Get Jobs** 🔐
```bash
GET /jobs
curl -H "Authorization: your-api-key" \
  http://localhost:8082/api/rpc/jobs
```

**Get File Content** 🔐
```bash
GET /getFileContent?jobID=<job-id>
curl -H "Authorization: your-api-key" \
  "http://localhost:8082/api/rpc/getFileContent?jobID=job-id-here"
```

## WebSocket Connection

### 1. Connect
```javascript
const ws = new WebSocket('ws://localhost:8082');
```

### 2. Register Client (CBOR encoded)
```javascript
const registrationData = {
  client_canister_id: {
    client_id: 12345,
    canister_id: "your-principal-id"
  },
  sig: signatureBuffer  // Ed25519 signature
};

ws.send(cbor.encode(registrationData));
```

### 3. Send Messages
```javascript
const message = {
  val: cbor.encode({
    text: "PING",
    data: "ping",
    user_principal_id: "your-principal-id",
    node_client_id: 12345
  }),
  sig: signatureBuffer
};

ws.send(cbor.encode(message));
```

### Message Types
- `PING` - Heartbeat
- `TWITTER_POST` - Twitter post scraping
- `TWITTER_PROFILE` - Twitter profile scraping
- `HTML` - HTML scraping
- `TWITTER_SCRAPE_RESULT` - Submit job results
- `JOB_REQUEST` - Request available jobs

## Setup

### Environment (.env)
```env
PORT=8082
REDIS_URL=redis://127.0.0.1:6380
```

### Start Server
```bash
npm install
npm run dev
```

### Test Connection
```bash
# HTTP
curl http://localhost:8082/api/rpc/ping

# WebSocket  
wscat -c ws://localhost:8082
```