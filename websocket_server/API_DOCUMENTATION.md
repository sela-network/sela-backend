# Sela Network WebSocket Server - API Documentation

A comprehensive WebSocket and REST API server for the Sela Network, handling real-time communication with client nodes, job assignment, file operations, and node management.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start the server
npm run dev
```

**Base URL**: `http://localhost:8082`
**WebSocket URL**: `ws://localhost:8082`

---

## 📡 WebSocket API

### Connection Flow

1. **Connect to WebSocket**: `ws://localhost:8082`
2. **Register Client**: Send registration message with public key
3. **Open Session**: Send client canister data with signature
4. **Exchange Messages**: Send/receive CBOR-encoded messages

### WebSocket Message Structure

All application messages follow this structure:
```javascript
const message = {
  val: cborEncode({
    client_id: 12345,
    sequence_num: 1,
    timestamp: Date.now() * 1000000, // nanoseconds
    message: cborEncode(applicationMessage)
  }),
  sig: signMessage(val, privateKey)
};
```

### Supported WebSocket Message Types

#### 1. PING - Client Connection
```javascript
const pingMessage = {
  text: "PING",
  data: "ping",
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response:
{
  "function": "Notification",
  "message": "Client connect open",
  "user_principal_id": "user-principal-id",
  "state": "Connected",
  "status": "OK"
}
```

#### 2. HALO - Hello Message
```javascript
const haloMessage = {
  text: "HALO",
  data: "HALO HALO",
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response:
{
  "function": "Notification",
  "message": "HALO received",
  "user_principal_id": "user-principal-id",
  "status": "OK",
  "data": "Sending message to client - HALO HALO"
}
```

#### 3. SPEED_TEST - Internet Speed Test
```javascript
const speedTestMessage = {
  text: "SPEED_TEST",
  data: JSON.stringify({
    downloadSpeed: "100.5",
    uploadSpeed: "50.2",
    ping: 25,
    jitter: "2.1",
    testTime: "2024-01-15T10:30:00Z"
  }),
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response:
{
  "function": "SpeedTestComplete",
  "message": "Speed test data updated",
  "status": "OK"
}
```

#### 4. JOB_REQUEST - Request Job Assignment
```javascript
const jobRequestMessage = {
  text: "JOB_REQUEST",
  data: "",
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response (Job Available):
{
  "function": "JobAssigned",
  "message": "Job assigned successfully",
  "jobData": {
    "user_principal_id": "user-principal-id",
    "client_id": 12345,
    "downloadSpeed": 100.5,
    "target": "https://twitter.com/elonmusk",
    "jobType": "TWITTER_PROFILE"
  },
  "status": "OK",
  "timestamp": 1705320600000
}

// Response (No Jobs):
{
  "function": "NoJobsAvailable",
  "message": "No jobs available at the moment",
  "status": "OK",
  "timestamp": 1705320600000
}
```

#### 5. TWITTER_SCRAPE_RESULT - Submit Job Results
```javascript
const scrapeResultMessage = {
  text: "TWITTER_SCRAPE_RESULT",
  data: JSON.stringify({
    jobId: "job_1705320600000_1234",
    content: {
      profile: {
        username: "elonmusk",
        followers: 150000000,
        tweets: [...]
      }
    },
    timestamp: Date.now()
  }),
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response:
{
  "function": "JobComplete",
  "message": "Job completed and result stored successfully",
  "status": "OK",
  "timestamp": 1705320600000
}
```

#### 6. CLIENT_STATUS - Update Client Status
```javascript
const statusMessage = {
  text: "CLIENT_STATUS",
  data: JSON.stringify({
    isActive: true,
    appVersion: "1.0.0",
    platform: "Windows",
    memoryUsage: 512,
    cpuUsage: 25.5
  }),
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response:
{
  "function": "ClientStatusUpdate",
  "message": "Client status updated successfully",
  "status": "OK"
}
```

#### 7. HEARTBEAT - Keep Connection Alive
```javascript
const heartbeatMessage = {
  text: "HEARTBEAT",
  data: "",
  user_principal_id: "user-principal-id",
  node_client_id: 12345
};

// Response:
{
  "function": "HeartbeatAck",
  "message": "Heartbeat acknowledged",
  "timestamp": 1705320600000,
  "status": "OK"
}
```

---

## 🔗 REST API Endpoints

### Health & Status

#### Health Check
```http
GET /health
```

**Response:**
```json
{
  "success": true,
  "message": "Server is healthy",
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "service": "Sela Network Hybrid Server"
  }
}
```

#### API Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "success": true,
  "message": "Database is healthy",
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## 🎯 RPC API Endpoints (`/api/rpc`)

### Authentication

#### Get Client Status
```http
GET /api/rpc/getClientStatus?uuid=user-principal-id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "clientAPI-Key": "abcd1234efgh5678ijkl9012mnop3456",
    "totalUsage": 150,
    "usageLimit": 10000
  },
  "message": "Client status retrieved successfully"
}
```

#### Register Client
```http
POST /api/rpc/registerClient
Content-Type: application/json

{
  "uuid": "user-principal-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "function": "Register",
    "message": "API key generated",
    "apiKey": "abcd1234efgh5678ijkl9012mnop3456",
    "status": "OK"
  },
  "message": "Client registered successfully"
}
```

### Job Management

#### Add New Job
```http
POST /api/rpc/addJob
Authorization: your-api-key
Content-Type: application/json

{
  "url": "https://twitter.com/elonmusk",
  "scrapeType": "TWITTER_PROFILE"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1705320600000_1234",
    "message": "Job successfully added"
  },
  "message": "Job added successfully"
}
```

#### Get All Jobs
```http
GET /api/rpc/jobs
Authorization: your-api-key
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "jobID": "job_1705320600000_1234",
      "clientUUID": "user-principal-id",
      "storedID": 1,
      "jobType": "TWITTER_PROFILE",
      "target": "https://twitter.com/elonmusk",
      "state": "completed",
      "user_principal_id": "assigned-user-id",
      "reward": 1.0,
      "assignedAt": 1705320600000,
      "completeAt": 1705320660000
    }
  ],
  "message": "Jobs retrieved successfully"
}
```

#### Get Pending Jobs
```http
GET /api/rpc/pendingJobs
Authorization: your-api-key
```

#### Assign Job to Optimal Node
```http
POST /api/rpc/assignJob
Authorization: your-api-key
Content-Type: application/json

{
  "jobId": "job_1705320600000_1234"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "function": "Notification",
    "message": "Client found, sending job details",
    "jobId": "job_1705320600000_1234",
    "user_principal_id": "assigned-user-id",
    "client_id": "12345",
    "downloadSpeed": "100.5",
    "state": "assigned",
    "status": "OK",
    "jobAssigned": true
  },
  "message": "Job assigned successfully"
}
```

#### Get File Content by Job ID
```http
GET /api/rpc/getFileContent?jobID=job_1705320600000_1234
Authorization: your-api-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "ok": "{\"profile\":{\"username\":\"elonmusk\",\"followers\":150000000}}"
  },
  "message": "File content retrieved successfully"
}
```

#### Download Job Content
```http
GET /api/rpc/job/job_1705320600000_1234/download
Authorization: your-api-key
```

**Response:** Raw file content (JSON or text)

### Usage Statistics

#### Get Total Usage
```http
GET /api/rpc/getTotalUsage
Authorization: your-api-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "clientUUID": "user-principal-id",
    "totalUsage": 150,
    "usageLimit": 10000
  },
  "message": "Total usage retrieved successfully"
}
```

#### Get Usage in Date Range
```http
GET /api/rpc/getUsageInDateRange?fromDate=1705190400000&toDate=1705276800000
Authorization: your-api-key
```

---

## 🔧 Node Management API (`/api/node`)

### Node Information

#### Node Health Check
```http
GET /api/node/health
```

#### Get All Nodes
```http
GET /api/node/nodes
Authorization: Bearer your-jwt-token
```

#### Get Running Nodes Only
```http
GET /api/node/nodes/running
Authorization: Bearer your-jwt-token
```

### User Operations

#### Get User Data
```http
GET /api/node/user/data
Authorization: Bearer your-jwt-token
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user_principal_id": "user-principal-id",
    "balance": 150.75,
    "todaysEarnings": 12.5,
    "totalAccumulativePoints": 150.75,
    "totalEarnFromLastJob": 1.0,
    "referralCode": "ABCD1234",
    "totalReferral": 5,
    "state": "waiting",
    "jobAssigned": false
  },
  "message": "User data retrieved successfully"
}
```

#### Get User Uptime Statistics
```http
GET /api/node/user/uptime
Authorization: Bearer your-jwt-token
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalUptime": "125:45:30",
    "todayUptime": "08:30:15",
    "isCurrentlyOnline": true,
    "currentSessionDuration": "02:15:45"
  },
  "message": "Uptime statistics retrieved successfully"
}
```

#### Add Rewards to User
```http
POST /api/node/user/rewards
Authorization: Bearer admin-jwt-token
Content-Type: application/json

{
  "principalId": "user-principal-id",
  "rewards": 5.0
}
```

### Admin Operations

#### Send Message to Specific Client
```http
POST /api/node/client/12345/message
Content-Type: application/json

{
  "userPrincipalId": "user-principal-id"
}
```

#### Broadcast Message to All Clients
```http
POST /api/node/broadcast
Content-Type: application/json

{
  "text": "SYSTEM_NOTIFICATION",
  "data": "Server maintenance in 30 minutes",
  "user_principal_id": "system"
}
```

---

## 📁 File API (`/api/files`)

#### Upload File
```http
POST /api/files/upload
Content-Type: multipart/form-data

{
  "file": [binary data],
  "userPrincipalId": "user-principal-id",
  "jobId": "job_1705320600000_1234"
}
```

#### Download File
```http
GET /api/files/download/file-id-123
```

#### List User Files
```http
GET /api/files/list?userPrincipalId=user-principal-id&limit=10&offset=0
```

---

## 🔐 Authentication

### WebSocket Authentication
WebSocket connections use Ed25519 signature verification:
1. Client generates Ed25519 key pair
2. Client registers public key with server
3. All subsequent messages must be signed with private key

### REST API Authentication
REST API uses API keys:
1. Register client to get API key: `POST /api/rpc/registerClient`
2. Include API key in Authorization header: `Authorization: your-api-key`

### Admin Operations
Admin operations require JWT tokens:
```http
Authorization: Bearer your-jwt-token
```

---

## 🔧 Environment Variables

```bash
# Server Configuration
PORT=8082
HOST=localhost

# Redis Configuration
REDIS_URL=redis://:sela123@127.0.0.1:6380
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=sela123
REDIS_DB=0

# Security
CANISTER_CONTROLLER_PEM=your-private-key-pem

# Timeouts and Limits
DEAD_TIMEOUT=3600000
SESSION_TIMEOUT=86400
USAGE_LIMIT=10000
MAX_JOBS_PER_CLIENT=10
```

---

## 📊 Error Handling

### HTTP Status Codes
- `200`: Success
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication failed)
- `403`: Forbidden (access denied)
- `404`: Not Found
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

### Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "data": null
}
```

---

## 🚀 Usage Examples

### cURL Examples

```bash
# Register new client
curl -X POST http://localhost:8082/api/rpc/registerClient \
  -H "Content-Type: application/json" \
  -d '{"uuid":"user-123"}'

# Add new job
curl -X POST http://localhost:8082/api/rpc/addJob \
  -H "Authorization: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://twitter.com/elonmusk","scrapeType":"TWITTER_PROFILE"}'

# Get user data
curl -X GET http://localhost:8082/api/node/user/data \
  -H "Authorization: Bearer your-jwt-token"

# Health check
curl -X GET http://localhost:8082/health

# Get all running nodes
curl -X GET http://localhost:8082/api/node/nodes/running \
  -H "Authorization: Bearer your-jwt-token"
```

### JavaScript WebSocket Client Example

```javascript
const WebSocket = require('ws');
const cbor = require('cbor');

class SelaNetworkClient {
  constructor(serverUrl) {
    this.ws = new WebSocket(serverUrl);
    this.clientId = null;
    this.sequenceNum = 0;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => {
        console.log('Connected to Sela Network');
        resolve();
      });

      this.ws.on('message', (data) => {
        const message = cbor.decode(data);
        console.log('Received:', message);
      });
    });
  }

  async sendPing() {
    const message = {
      text: "PING",
      data: "ping",
      user_principal_id: "your-user-id",
      node_client_id: this.clientId
    };
    
    await this.sendMessage(message);
  }

  async requestJob() {
    const message = {
      text: "JOB_REQUEST",
      data: "",
      user_principal_id: "your-user-id",
      node_client_id: this.clientId
    };
    
    await this.sendMessage(message);
  }

  async sendMessage(appMessage) {
    const messageData = {
      val: cbor.encode({
        client_id: this.clientId,
        sequence_num: this.sequenceNum++,
        timestamp: Date.now() * 1000000,
        message: cbor.encode(appMessage)
      })
      // Note: In production, add signature verification
    };
    
    this.ws.send(cbor.encode(messageData));
  }
}

// Usage
const client = new SelaNetworkClient('ws://localhost:8082');
await client.connect();
await client.sendPing();
await client.requestJob();
```

---

## 📝 Notes

- All timestamps are in milliseconds since Unix epoch
- WebSocket messages use CBOR encoding
- REST API uses JSON format
- WebSocket connections require Ed25519 signature verification
- All API responses follow consistent JSON structure
- Rate limiting applies to API key usage

---

*Last updated: January 2024*

