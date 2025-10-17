export interface ClientStruct {
  user_principal_id: string;
  client_id: string;
  activeJobs: string[];        // ✅ Array of active job IDs
  maxConcurrentJobs: number;   // ✅ Maximum concurrent jobs this client can handle
  downloadSpeed: number;
  ping: number;
  wsConnect: number;
  wsDisconnect: number;
  todaysEarnings: number;
  balance: number;
  referralCode: string;
  totalReferral: number;
  clientStatus: string;
  pingTimestamp: number;
  totalUptime: number;
  dailyUptime: number;
  uptimeReward: number;
  
}

export interface JobStruct {
  jobID: string;
  clientUUID: string;
  storedID: string;
  jobType: string;
  target: string;
  state: string;
  user_principal_id: string;
  assignedAt: number;
  completeAt: number;
  reward: number;
  job_views: number;
  job_downloads: number;
  price?: number; // Price in USDT
  objectsCount?: number; // Number of objects in the scraped data
  fileSizeKB?: number; // File size in kilobytes
  dataAnalysis?: {
    dataCount: number;
    included: string[];
  };
}

export interface AdminStruct {
  user_principal_id: string;
  admin_id: number;
  role: string;
  permissions: string[];
  createdAt: number;
  lastLogin: number;
}

export interface UsageEntry {
  timestamp: number; // Timestamp in milliseconds
}

export interface APIKeyData {
  apiKey: string;
  usageCount: number;
  usageLimit: number;
  usageLog: UsageEntry[];
}

export interface SessionData {
  sessionId: string;
  user_principal_id: string;
  client_id: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  isActive: boolean;
}

export interface UptimeStats {
  totalUptime: number;
  todayUptime: number;
  isCurrentlyOnline: boolean;
  currentSessionDuration: number;
}

// Database error types
export type DatabaseError = 
  | { type: 'NotFound'; message: string }
  | { type: 'AlreadyExists'; message: string }
  | { type: 'UpdateFailed'; message: string }
  | { type: 'InvalidInput'; message: string }
  | { type: 'DatabaseError'; message: string }
  | { type: 'StorageError'; message: string }
  | { type: 'CanisterError'; message: string }
  | { type: 'Unknown'; message: string };

export type EntityResult<T> = 
  | { success: true; data: T }
  | { success: false; error: DatabaseError };

// Job and Client state enums
export enum JobState {
  PENDING = 'pending',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum ClientState {
  WORKING = 'working',
  NOT_WORKING = 'notWorking',
  DISCONNECTED = 'disconnected'
}

export enum ClientStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  SUSPENDED = 'Suspended'
}

// Redis key patterns
export const REDIS_KEYS = {
  CLIENT: 'client:',
  JOB: 'job:',
  ADMIN: 'admin:',
  SESSION: 'session:',
  API_KEY: 'apikey:',
  USAGE: 'usage:',
  STATS: 'stats:',
  FILE: 'file:',
  FILE_INDEX: 'file_index:',
  PURCHASE: 'purchase:',
  INDEX: {
    CLIENTS_BY_STATUS: 'index:clients:status:',
    JOBS_BY_STATE: 'index:jobs:state:',
    JOBS_BY_USER: 'index:jobs:user:',
    SESSIONS_BY_USER: 'index:sessions:user:',
    FILES_BY_USER: 'index:files:user:',
    FILES_BY_JOB: 'index:files:job:',
    PURCHASES_BY_USER: 'index:purchases:user:',
    PURCHASES_BY_JOB: 'index:purchases:job:'
  },
  // Uptime and Reward System Keys
  UPTIME: {
    SESSION: 'uptime:session:',
    ACTIVE: 'uptime:active:',
    DAILY: 'uptime:daily:',
    WEEKLY: 'uptime:weekly:',
    DISTRIBUTION: 'uptime:distribution:',
    TRANSACTION: 'uptime:transaction:'
  },
  UPTIME_INDEX: {
    USER_SESSIONS: 'uptime:index:user:',
    USER_DAILY: 'uptime:index:user:',
    USER_WEEKLY: 'uptime:index:user:',
    USER_TRANSACTIONS: 'uptime:index:user:',
    DATE_USERS: 'uptime:index:date:',
    DATE_SESSIONS: 'uptime:index:date:',
    DATE_TRANSACTIONS: 'uptime:index:date:',
    DATE_DISTRIBUTIONS: 'uptime:index:date:',
    DISTRIBUTION_TRANSACTIONS: 'uptime:index:distribution:',
    PERFORMANCE_TIER: 'uptime:index:performance:tier',
    REWARDS_PENDING: 'uptime:index:rewards:pending:',
    REWARDS_DISTRIBUTED: 'uptime:index:rewards:distributed:',
    REWARDS_FAILED: 'uptime:index:rewards:failed:',
    TRANSACTIONS_PENDING: 'uptime:index:transactions:pending',
    TRANSACTIONS_CONFIRMED: 'uptime:index:transactions:confirmed',
    TRANSACTIONS_FAILED: 'uptime:index:transactions:failed'
  },
  // Referral System Keys
  REFERRAL: {
    RELATIONSHIP: 'referral:relationship:',       // referral:relationship:{user_id}
    CODE_LOOKUP: 'referral:code:',               // referral:code:{code} -> user_id
    REWARD: 'referral:reward:',                  // referral:reward:{reward_id}
    MONTHLY_CAP: 'referral:cap:',                // referral:cap:{user_id}:{YYYY-MM}
  },
  REFERRAL_INDEX: {
    USER_L1_REFERRALS: 'referral:index:user:l1:',     // L1 referrals of a user
    USER_L2_REFERRALS: 'referral:index:user:l2:',     // L2 referrals of a user
    REWARDS_BY_USER: 'referral:index:rewards:user:',  // All rewards earned by a referrer
    REWARDS_BY_REFEREE: 'referral:index:rewards:referee:', // All rewards generated by a referee
    PENDING_24H: 'referral:index:pending24h',         // Users pending 24h verification
    UNCLAIMED_REWARDS: 'referral:index:unclaimed:',   // Unclaimed rewards by user
  }
} as const;

// ============================================
// Referral System Types
// ============================================

/**
 * Referral reward types
 */
export enum ReferralRewardType {
  INSTALLATION = 'INSTALLATION',    // 500 points for 24h completion
  UPTIME = 'UPTIME',                // 2% (L1) or 1% (L2) of uptime rewards
  TASK = 'TASK'                     // 5% (L1) or 2% (L2) of task rewards
}

/**
 * Referral tier level
 */
export enum ReferralTier {
  L1 = 1,  // Direct referral
  L2 = 2   // Second-tier referral
}

/**
 * Status of 24-hour installation period
 */
export enum Installation24hStatus {
  PENDING = 'PENDING',           // Not yet reached 24h
  COMPLETED = 'COMPLETED',       // Reached 24h uptime
  FAILED = 'FAILED'              // Disconnected before 24h
}

/**
 * Referral relationship tracking
 * Stores who referred whom and the tier structure
 * Supports N-tier referral chains for future expansion
 */
export interface ReferralRelationship {
  user_principal_id: string;              // The referred user (referee)
  referrer_chain: string[];               // Array of referrers: [L1, L2, L3, ...] ordered by tier
  referral_code_used: string;             // Code used during signup
  signup_timestamp: number;               // When user signed up
  
  // Legacy fields for backward compatibility
  referrer_l1_principal_id?: string;      // Direct referrer (L1) - derived from referrer_chain[0]
  referrer_l2_principal_id?: string;      // L2 referrer - derived from referrer_chain[1]
  
  // 24-hour installation tracking
  first_24h_status: Installation24hStatus;
  first_24h_started_at: number;           // When uptime tracking started
  first_24h_completed_at?: number;        // When 24h was completed
  installation_reward_claimed: boolean;   // Has L1 referrer claimed 500 points
  
  // Metadata
  created_at: number;
  updated_at: number;
}

/**
 * Referral reward record
 * Tracks all rewards distributed through the referral system
 */
export interface ReferralReward {
  reward_id: string;                      // Unique reward ID
  referrer_principal_id: string;          // Who receives the reward
  referee_principal_id: string;           // Who generated the reward
  
  reward_type: ReferralRewardType;        // INSTALLATION | UPTIME | TASK
  tier: ReferralTier;                     // L1 or L2
  
  // Reward calculation
  base_amount: number;                    // Original earned points by referee
  reward_percentage: number;              // Percentage given (2%, 5%, etc.)
  reward_amount: number;                  // Actual reward points distributed
  
  // Distribution info
  timestamp: number;                      // When reward was created
  distribution_date: string;              // YYYY-MM-DD
  distributed_at?: number;                // When actually distributed
  status: 'PENDING' | 'DISTRIBUTED' | 'FAILED' | 'CAPPED';
  
  // Additional context
  job_id?: string;                        // For task-based rewards
  weekly_uptime_minutes?: number;         // For uptime-based rewards
  failure_reason?: string;                // If status is FAILED
  
  // Metadata
  created_at: number;
  updated_at: number;
}

/**
 * Monthly cap tracking for uptime-based referral rewards
 * Prevents excessive rewards from high-performing referees
 */
export interface ReferralMonthlyCap {
  referrer_principal_id: string;          // The referrer
  month: string;                          // YYYY-MM format
  
  // Uptime reward tracking (only type with monthly cap)
  uptime_rewards_earned: number;          // Total uptime rewards earned this month
  uptime_rewards_cap: number;             // Monthly maximum (configurable)
  cap_reached: boolean;                   // Has cap been reached
  cap_reached_at?: number;                // When cap was reached
  
  // Statistics
  total_l1_uptime_rewards: number;        // From L1 referrals
  total_l2_uptime_rewards: number;        // From L2 referrals
  
  // Metadata
  created_at: number;
  updated_at: number;
}

/**
 * Referral statistics for a user
 */
export interface ReferralStats {
  user_principal_id: string;
  
  // L1 (Direct) referrals
  l1_total_referrals: number;
  l1_active_referrals: number;            // Currently active (online)
  l1_pending_24h: number;                 // Waiting for 24h completion
  
  // L2 (Indirect) referrals
  l2_total_referrals: number;
  l2_active_referrals: number;
  
  // Total earnings from referrals
  total_earned: number;
  installation_earnings: number;
  uptime_earnings: number;
  task_earnings: number;
  
  // Breakdown by tier
  l1_total_earned: number;
  l2_total_earned: number;
  
  // Monthly tracking
  current_month: string;
  current_month_uptime_earned: number;
  current_month_cap_remaining: number;
  
  // New requested fields
  total_referral_rewards: number;         // Total rewards from all referrals
  this_week_referral_rewards: number;     // Rewards earned this week
  qualified_referrals: number;            // Number of referrals who have completed 24h
  pending_referrals: number;              // Number of referrals pending 24h completion
  
  // Metadata
  last_updated: number;
}

/**
 * Distribution cycle for rewards
 */
export enum DistributionCycle {
  IMMEDIATE = 'IMMEDIATE',     // Distribute right away (e.g., installation, task)
  DAILY = 'DAILY',             // Distribute once per day
  WEEKLY = 'WEEKLY',           // Distribute once per week
  MONTHLY = 'MONTHLY',         // Distribute once per month
  MANUAL = 'MANUAL'            // Manual distribution trigger
}

/**
 * Tier-specific reward configuration
 * Allows flexible configuration for any number of tiers
 */
export interface TierRewardConfig {
  tier_level: number;                           // 1, 2, 3, 4, etc.
  reward_percentage: number;                    // Percentage of referee's earnings
  has_monthly_cap: boolean;                     // Whether this tier has monthly cap
  monthly_cap_amount?: number;                  // Cap amount if applicable
  enabled: boolean;                             // Can disable specific tiers
}

/**
 * Reward type configuration
 */
export interface RewardTypeConfig {
  type: ReferralRewardType;                     // INSTALLATION | UPTIME | TASK
  enabled: boolean;                             // Enable/disable this reward type
  distribution_cycle: DistributionCycle;        // When to distribute
  tier_configs: TierRewardConfig[];             // Config for each tier
  
  // Type-specific requirements
  requirements?: {
    min_uptime_hours?: number;                  // For uptime rewards
    min_uptime_hours_weekly?: number;           // For weekly uptime rewards
    required_uptime_hours?: number;             // For installation rewards
  };
}

/**
 * Configuration for referral system
 * Flexible design to support N-tier referral chains and various distribution cycles
 */
export interface ReferralConfig {
  // System settings
  enabled: boolean;                             // Enable/disable referral system
  max_tier_depth: number;                       // Maximum referral chain depth (2, 3, 4, etc.)
  referral_code_length: number;                 // Default: 8
  
  // Installation reward (default: IMMEDIATE distribution)
  installation_reward: RewardTypeConfig;
  
  // Uptime reward (default: WEEKLY distribution)
  uptime_reward: RewardTypeConfig;
  
  // Task reward (default: IMMEDIATE distribution)
  task_reward: RewardTypeConfig;
  
  // Legacy compatibility (deprecated - use reward type configs instead)
  installation_reward_points?: number;
  installation_required_uptime_hours?: number;
  uptime_l1_percentage?: number;
  uptime_l2_percentage?: number;
  uptime_required_weekly_hours?: number;
  uptime_monthly_cap_per_referrer?: number;
  task_l1_percentage?: number;
  task_l2_percentage?: number;
}

// Database configuration
export interface DatabaseConfig {
  redis: {
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };
  timeouts: {
    deadTimeout: number; // in milliseconds
    sessionTimeout: number; // in milliseconds
  };
  limits: {
    usageLimit: number;
    maxJobsPerClient: number;
  };
}


export interface FileMetadata {
  id: string;
  name: string;
  content_type: string;
  size: number;
  created_at: number;
  updated_at: number;
  user_principal_id: string;
  job_id: string;
  file_path: string;
  hash?: string;
  // Dual storage fields
  storage_strategy?: 'local' | 'canister' | 'dual';
  local_file_path?: string;
  canister_file_key?: string;
  sync_status?: 'syncing' | 'synced' | 'sync_failed' | 'sync_failed_permanently';
}

export interface FileUploadRequest {
  name: string;
  content_type: string;
  size: number;
  user_principal_id: string;
  job_id: string;
}

export interface FileChunkRequest {
  file_id: string;
  chunk_index: number;
  chunk_data: Buffer;
  user_principal_id: string;
}

export interface JobCompletionResult {
  message: string;
  reward: number;
}

// Uptime and Reward System Types
export interface UptimeSession {
  session_id: string;
  user_principal_id: string;
  start_time: number;
  last_activity_time: number;
  end_time?: number;
  duration_minutes: number;
  avg_speed: number;
  avg_ping: number;
  speed_samples: Array<{timestamp: number, value: number}>;
  ping_samples: Array<{timestamp: number, value: number}>;
  status: 'ACTIVE' | 'COMPLETED' | 'FORCE_CLOSED';
  close_reason?: string;
}

export interface DailyUptimeRecord {
  date: string; // YYYY-MM-DD format
  user_principal_id: string;
  total_minutes: number;
  processed_minutes: number; // Track how many minutes have been rewarded
  session_count: number;
  avg_speed: number;
  avg_ping: number;
  tier_level: number;
  base_reward: number;
  bonus_reward: number;
  total_reward: number;
  last_updated: number;
  is_processed: boolean;
}

export interface WeeklyUptimeRecord {
  week_start: string; // YYYY-MM-DD format
  user_principal_id: string;
  total_minutes: number;
  days_active: number;
  total_reward: number;
  avg_daily_uptime: number;
  last_updated: number;
}

export interface RewardDistributionStatus {
  distribution_id: string;
  distribution_date: string;
  distribution_type: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  total_users: number;
  total_rewards_distributed: number;
  started_at: number;
  completed_at?: number;
  error_details?: string;
  skip_reason?: string;
  retry_count: number;
  max_retries: number;
}

export interface RewardTransaction {
  transaction_id: string;
  distribution_id: string;
  user_principal_id: string;
  amount: number;
  base_amount: number;
  bonus_amount: number;
  uptime_minutes: number;
  tier_level: number;
  tier_bonus_rate: number;
  date: string;
  timestamp: number;
  blockchain_tx_hash?: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  retry_count: number;
}

export interface PerformanceTier {
  tier: number;
  min_speed: number;
  max_ping: number;
  bonus_rate: number;
  description: string;
}

export interface UptimeConfig {
  heartbeat_interval: number; // milliseconds
  timeout_threshold: number; // milliseconds
  max_missed_heartbeats: number;
  sample_interval: number; // milliseconds - how often to store speed/ping samples
  base_reward_rate: number; // Sela points per minute
  daily_min_reward: number;
  daily_max_reward: number;
  daily_max_reward_with_bonus: number; // Maximum daily reward including tier bonuses
  weekly_max_reward: number;
  performance_tiers: PerformanceTier[];
  reward_distribution_enabled: boolean;
  reward_distribution_interval: string; // Cron expression
  reward_log_directory: string;
  reward_max_log_files: number;
  reward_max_log_size_mb: number;
}

export interface FileListRequest {
  user_principal_id: string;
  job_id?: string;
  start_id?: string;
  limit?: number;
}

export interface FileDownloadRequest {
  file_id: string;
  user_principal_id: string;
}

// Multi-job support interfaces
export interface ClientJobQueue {
  clientId: string;
  pendingJobs: Array<{
    jobId: string;
    userPrincipalId: string;
    url: string;
    scrapeType: string;
    timestamp: number;
    priority?: number;
    post_count: number;
    replies_count: number;
    scrollPauseTime: number;
  }>;
  isProcessing: boolean;
  lastProcessedAt: number;
}

export interface JobWaitingPromise {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
  startTime: number;
  clientId: string;
  userPrincipalId: string;
  jobId: string;
  timeoutMs?: number; // ⚠️ CRITICAL: Store the timeout so orphan cleanup respects it
}

export interface ClientCapacityInfo {
  client_id: string;
  user_principal_id: string;
  activeJobs: number;
  maxConcurrentJobs: number;
  utilizationRate: string;
  downloadSpeed: number;
  clientStatus: string;
  isOnline: boolean;
  lastSeen: number;
}

export interface SystemCapacityStatus {
  totalClients: number;
  activeClients: number;
  totalCapacity: number;
  totalActiveJobs: number;
  averageUtilization: string;
  clients: ClientCapacityInfo[];
}

export interface JobAssignmentResult {
  success: boolean;
  client?: {
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
    currentLoad: number;
    maxCapacity: number;
  };
  error?: {
    type: 'NoCapacity' | 'NoClients' | 'DatabaseError';
    message: string;
  };
}
