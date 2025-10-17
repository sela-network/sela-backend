import { WebSocket } from "ws";
import { Principal } from "@dfinity/principal";
import { Ed25519KeyIdentity } from "@dfinity/identity";

// Server configuration types
export interface ServerOptions {
  port?: number;
  host?: string;
  icUrl?: string;
  fetchRootKey?: boolean;
  identity?: Ed25519KeyIdentity;
}

// Client session types
export interface ClientSession {
  id: number;
  ws: WebSocket;
  isRegistered: boolean;
  clientId: string | null;
  connectedAt: number;
  lastHeartbeat: number;
  messagesSent: number;
  messagesReceived: number;
  userPrincipalId?: string;
  wsSessionId?: string; // WebSocket session ID for database cleanup
  outgoingSequence?: number;
  connectionStatus?: ConnectionStatus;
  lastStatusUpdate?: number;
  lastActivity?: number;
  activityCount?: number;
  errorReports?: ErrorReport[];
}

// Connection status types
export interface ConnectionStatus {
  connectionType: string;
  quality: number;
  latency: number;
  reconnectCount: number;
  timestamp: number;
}

// Error report types
export interface ErrorReport {
  message: string;
  stack?: string;
  level: string;
  timestamp: number;
  userAgent?: string;
}

// Session data types
export interface SessionData {
  client_id: string;
  canister_id: string;
  timestamp: number;
}

 

// Server statistics types
export interface ServerStats {
  totalConnections: number;
  activeConnections: number;
  messagesReceived: number;
  messagesSent: number;
  startTime: number;
}

// Message types
export interface ApplicationMessage {
  text: string;
  data: string;
  user_principal_id: string;
  node_client_id: string;
  job_id?: string;
  post_count?: number;
  replies_count?: number;
  scrollPauseTime?: number;
}

export interface WebSocketMessage {
  client_id: string;
  sequence_num: number;
  timestamp: number;
  message: Buffer;
}

export interface ClientCanisterData {
  client_id: string;
  canister_id: string;
  user_principal_id?: string;
}

export interface RegistrationMessage {
  client_canister_id: Buffer | ClientCanisterData;
  sig: Buffer;
}


export interface CertMessage {
  key: string;
  val: Uint8Array;
  cert: Uint8Array;
  tree: Uint8Array;
}

// IC Canister method types
export interface ICCanisterOptions {
  url?: string;
  fetchRootKey?: boolean;
  identity?: Ed25519KeyIdentity;
}

export interface EncodedMessage {
  client_id: string;
  key: string;
  val: Uint8Array;
}

export interface CertMessages {
  messages: EncodedMessage[];
  cert: Uint8Array;
  tree: Uint8Array;
}

// Reward history types
export interface RewardHistoryItem {
  completeAt: bigint;
  reward: number;
  assignedAt: bigint;
  jobType: string;
  jobID: string;
  user_principal_id: string;
  state: string;
  target: string;
}

export interface RewardHistoryResponse {
  ok?: RewardHistoryItem[];
  err?: string;
}

// Simplified reward type for generic reward history
export interface SimplifiedReward {
  type: 'job' | 'uptime';
  amount: number;
  timestamp: number;
  date: string;
  state: string;
  completeAt: number;
  job_id: string | null; // null for uptime rewards, job ID for job rewards
}

// Notification types
export interface NotificationMessage {
  function: string;
  type?: string;
  message?: string;
  timestamp: number;
  balance?: string;
  todaysEarning?: string;
  earning?: string;
  level?: string;
  [key: string]: any;
}

// Speed test data types
export interface SpeedTestData {
  downloadSpeed: string;
  uploadSpeed: string;
  ping: number;
  jitter: string;
  testTime: string;
}

// User activity types
export interface UserActivity {
  type: string;
  timestamp: number;
  metadata?: {
    duration?: number;
    page?: string;
    [key: string]: any;
  };
}

// Client status types
export interface ClientStatus {
  appVersion: string;
  platform: string;
  isActive: boolean;
  memoryUsage: number;
  cpuUsage: number;
  timestamp: number;
}

// Redis session store types
export interface RedisSessionStoreOptions {
  url?: string;
  socket?: {
    reconnectStrategy?: (retries: number) => number;
  };
}

// Monitor types
export interface MonitorStats {
  totalMessages: number;
  connectionAttempts: number;
  errors: number;
  startTime: number;
}

export interface ServerHealth {
  status: number | string;
  message: string;
}

// Test client types
export interface TestClientOptions {
  userPrincipalId?: string;
  canisterId?: string;
}

// Event types
export interface ClientRegisteredEvent {
  sessionId: number;
  clientId: string;
  canisterId: string;
}

export interface ClientDisconnectedEvent {
  sessionId: number;
  clientSession: ClientSession;
  code: number;
  reason: string;
}

export interface MessageReceivedEvent {
  clientId: string;
  messageType: string;
  data: any;
}

export interface SpeedTestReceivedEvent {
  clientId: string;
  speedData: SpeedTestData;
}

export interface TwitterScrapeResultEvent {
  clientId: string;
  fileId: string;
}

export interface ClientStatusEvent {
  clientId: string;
  status: ClientStatus;
}

export interface ConnectionStatusEvent {
  clientId: string;
  status: ConnectionStatus;
}

export interface UserActivityEvent {
  clientId: string;
  activity: UserActivity;
}

export interface ErrorReportEvent {
  clientId: string;
  error: ErrorReport;
}

export interface FileUploadWebSocketMessage {
  type: 'file_upload';
  name: string;
  content_type: string;
  job_id: string;
  content: string;
}

export interface FileUploadResponse {
  success: boolean;
  file_id?: string;
  message: string;
  error?: string;
}
