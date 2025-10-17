/**
 * RPC Configuration management
 * Equivalent to constants and configuration from the original Motoko canister
 */

export interface RPCConfig {
  websocket: {
    messageTimeout: number; // Equivalent to MSG_TIMEOUT (5 minutes in nanoseconds)
    maxReturnedMessages: number; // Equivalent to MAX_NUMBER_OF_RETURNED_MESSAGES
    labelWebsocket: string; // Equivalent to LABEL_WEBSOCKET
    heartbeatInterval: number; // Client heartbeat interval in milliseconds
    connectionTimeout: number; // Connection timeout in milliseconds
  };
  jobs: {
    defaultReward: number; // Default reward for completed jobs
    maxJobsPerClient: number; // Maximum concurrent jobs per client
    jobTimeout: number; // Job timeout in milliseconds
    retryAttempts: number; // Maximum retry attempts for failed jobs
  };
  auth: {
    tokenExpiry: number; // API token expiry time in milliseconds
    maxFailedAttempts: number; // Maximum failed authentication attempts
    rateLimitWindow: number; // Rate limiting window in milliseconds
    sessionTimeout: number; // WebSocket session timeout
  };
  client: {
    nextClientIdStart: number; // Starting client ID (equivalent to nextClientId = 16)
    nextMessageNonceStart: number; // Starting message nonce (equivalent to nextMessageNonce = 16)
    deadTimeout: number; // Client considered dead after this timeout
    maxReconnectAttempts: number; // Maximum reconnection attempts
  };
  api: {
    defaultUsageLimit: number; // Default API usage limit per client
    apiKeyLength: number; // Length of generated API keys
    referralCodeLength: number; // Length of referral codes
  };
  scraping: {
    supportedJobTypes: string[]; // Supported scraping job types
    maxUrlLength: number; // Maximum URL length for scraping jobs
    defaultJobPriority: number; // Default job priority
  };
}

/**
 * Default RPC configuration
 * Values mirror the original Motoko canister constants where applicable
 */
export const DEFAULT_RPC_CONFIG: RPCConfig = {
  websocket: {
    messageTimeout: 5 * 60 * 1000, // 5 minutes (converted from nanoseconds to milliseconds)
    maxReturnedMessages: 50, // Same as original MAX_NUMBER_OF_RETURNED_MESSAGES
    labelWebsocket: "websocket", // Same as original LABEL_WEBSOCKET
    heartbeatInterval: 30 * 1000, // 30 seconds
    connectionTimeout: 30 * 1000, // 30 seconds
  },
  jobs: {
    defaultReward: 1.0, // Default reward amount
    maxJobsPerClient: 5, // Maximum concurrent jobs per client
    jobTimeout: 10 * 60 * 1000, // 10 minutes
    retryAttempts: 3, // Maximum retry attempts
  },
  auth: {
    tokenExpiry: 24 * 60 * 60 * 1000, // 24 hours
    maxFailedAttempts: 5, // Maximum failed attempts before lockout
    rateLimitWindow: 60 * 1000, // 1 minute rate limiting window
    sessionTimeout: 24 * 60 * 60, // 24 hours in seconds (for Redis TTL)
  },
  client: {
    nextClientIdStart: 16, // Same as original nextClientId = 16
    nextMessageNonceStart: 16, // Same as original nextMessageNonce = 16
    deadTimeout: 60 * 60 * 1000, // 1 hour (equivalent to DEAD_TIMEOUT)
    maxReconnectAttempts: 5,
  },
  api: {
    defaultUsageLimit: 10000, // Default API usage limit
    apiKeyLength: 32, // API key length
    referralCodeLength: 8, // Referral code length
  },
  scraping: {
    supportedJobTypes: [
      "TWITTER_POST",
      "TWITTER_PROFILE", 
      "TWITTER_FOLLOW_LIST",
      "HTML"
    ], 
    maxUrlLength: 2048, // Maximum URL length
    defaultJobPriority: 1,
  }
};

/**
 * RPC Error types equivalent to original canister error handling
 */
export enum RPCErrorType {
  // Authentication errors
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // Job management errors
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  JOB_ALREADY_ASSIGNED = 'JOB_ALREADY_ASSIGNED',
  JOB_CREATION_FAILED = 'JOB_CREATION_FAILED',
  INVALID_JOB_TYPE = 'INVALID_JOB_TYPE',
  NO_DATA_FOUND = 'NO_DATA_FOUND',
  
  // Client errors
  CLIENT_NOT_FOUND = 'CLIENT_NOT_FOUND',
  CLIENT_NOT_AVAILABLE = 'CLIENT_NOT_AVAILABLE',
  CLIENT_DISCONNECTED = 'CLIENT_DISCONNECTED',
  
  // Message errors
  INVALID_MESSAGE_FORMAT = 'INVALID_MESSAGE_FORMAT',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  CBOR_DECODE_ERROR = 'CBOR_DECODE_ERROR',
  SIGNATURE_VERIFICATION_FAILED = 'SIGNATURE_VERIFICATION_FAILED',
  
  // File errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  REDIS_CONNECTION_ERROR = 'REDIS_CONNECTION_ERROR',
  
  // Network errors
  WEBSOCKET_ERROR = 'WEBSOCKET_ERROR',
  CANISTER_COMMUNICATION_ERROR = 'CANISTER_COMMUNICATION_ERROR',
  
  // General errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * RPC Response status codes
 */
export enum RPCStatus {
  OK = 'OK',
  ERROR = 'ERROR',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

/**
 * Job types supported by the RPC system
 */
export enum JobType {
  TWITTER_POST = 'TWITTER_POST',
  TWITTER_PROFILE = 'TWITTER_PROFILE',
  TWITTER_FOLLOW_LIST = 'TWITTER_FOLLOW_LIST',
  HTML = 'HTML'
}

/**
 * Message types for WebSocket communication
 */
export enum MessageType {
  PING = 'PING',
  HEARTBEAT = 'HEARTBEAT',
  TWITTER_POST = 'TWITTER_POST',
  TWITTER_PROFILE = 'TWITTER_PROFILE',
  TWITTER_FOLLOW_LIST = 'TWITTER_FOLLOW_LIST',
  HTML = 'HTML',
  TWITTER_SCRAPE_RESULT = 'TWITTER_SCRAPE_RESULT',
  SPEED_TEST = 'SPEED_TEST',
  CLIENT_STATUS = 'CLIENT_STATUS',
  JOB_REQUEST = 'JOB_REQUEST'
}

/**
 * Configuration loader with environment variable overrides
 */
export class RPCConfigManager {
  private config: RPCConfig;

  constructor(baseConfig: RPCConfig = DEFAULT_RPC_CONFIG) {
    this.config = this.loadConfigWithEnvironmentOverrides(baseConfig);
  }

  private loadConfigWithEnvironmentOverrides(baseConfig: RPCConfig): RPCConfig {
    return {
      ...baseConfig,
      websocket: {
        ...baseConfig.websocket,
        messageTimeout: parseInt(process.env.WS_MESSAGE_TIMEOUT || baseConfig.websocket.messageTimeout.toString()),
        maxReturnedMessages: parseInt(process.env.WS_MAX_RETURNED_MESSAGES || baseConfig.websocket.maxReturnedMessages.toString()),
        heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || baseConfig.websocket.heartbeatInterval.toString()),
        connectionTimeout: parseInt(process.env.WS_CONNECTION_TIMEOUT || baseConfig.websocket.connectionTimeout.toString()),
      },
      jobs: {
        ...baseConfig.jobs,
        defaultReward: parseFloat(process.env.JOB_DEFAULT_REWARD || baseConfig.jobs.defaultReward.toString()),
        maxJobsPerClient: parseInt(process.env.JOB_MAX_PER_CLIENT || baseConfig.jobs.maxJobsPerClient.toString()),
        jobTimeout: parseInt(process.env.JOB_TIMEOUT || baseConfig.jobs.jobTimeout.toString()),
        retryAttempts: parseInt(process.env.JOB_RETRY_ATTEMPTS || baseConfig.jobs.retryAttempts.toString()),
      },
      auth: {
        ...baseConfig.auth,
        tokenExpiry: parseInt(process.env.AUTH_TOKEN_EXPIRY || baseConfig.auth.tokenExpiry.toString()),
        maxFailedAttempts: parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS || baseConfig.auth.maxFailedAttempts.toString()),
        rateLimitWindow: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || baseConfig.auth.rateLimitWindow.toString()),
        sessionTimeout: parseInt(process.env.AUTH_SESSION_TIMEOUT || baseConfig.auth.sessionTimeout.toString()),
      },
      api: {
        ...baseConfig.api,
        defaultUsageLimit: parseInt(process.env.API_DEFAULT_USAGE_LIMIT || baseConfig.api.defaultUsageLimit.toString()),
        apiKeyLength: parseInt(process.env.API_KEY_LENGTH || baseConfig.api.apiKeyLength.toString()),
      }
    };
  }

  getConfig(): RPCConfig {
    return this.config;
  }

  updateConfig(updates: Partial<RPCConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
