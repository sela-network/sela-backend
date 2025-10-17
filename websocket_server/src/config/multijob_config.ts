/**
 * Configuration for multi-job support system
 */

export interface MultiJobConfig {
  // Default client capacity settings
  defaultCapacity: {
    maxConcurrentJobs: number;
    minConcurrentJobs: number;
    maxAllowedCapacity: number;
  };
  
  // Job queue management
  jobQueue: {
    maxQueueSize: number;
    deliveryDelayMs: number;
    processingTimeoutMs: number;
    jobTimeoutMs: number;
    cleanupIntervalMs: number;
    retryAttempts: number;
  };
  
  // Load balancing and optimization
  loadBalancing: {
    highUtilizationThreshold: number;  // % (e.g., 85)
    lowUtilizationThreshold: number;   // % (e.g., 30)
    autoOptimizationEnabled: boolean;
    emergencyRedistributionThreshold: number; // % (e.g., 95)
  };
  
  // Performance monitoring
  monitoring: {
    metricsCollectionEnabled: boolean;
    capacityCheckIntervalMs: number;
    performanceLogLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  
  // Migration settings
  migration: {
    batchSize: number;
    backupEnabled: boolean;
    verificationEnabled: boolean;
  };
}

export const DEFAULT_MULTIJOB_CONFIG: MultiJobConfig = {
  defaultCapacity: {
    maxConcurrentJobs: 3,
    minConcurrentJobs: 1,
    maxAllowedCapacity: 10
  },
  
  jobQueue: {
    maxQueueSize: 50,
    deliveryDelayMs: 100,
    processingTimeoutMs: 30000,
    jobTimeoutMs: 300000, // 5 minutes
    cleanupIntervalMs: 300000, // 5 minutes
    retryAttempts: 3
  },
  
  loadBalancing: {
    highUtilizationThreshold: 85,
    lowUtilizationThreshold: 30,
    autoOptimizationEnabled: false, // Disabled by default for safety
    emergencyRedistributionThreshold: 95
  },
  
  monitoring: {
    metricsCollectionEnabled: true,
    capacityCheckIntervalMs: 60000, // 1 minute
    performanceLogLevel: 'info'
  },
  
  migration: {
    batchSize: 100,
    backupEnabled: true,
    verificationEnabled: true
  }
};

/**
 * Get configuration from environment variables with fallbacks
 */
export function getMultiJobConfig(): MultiJobConfig {
  return {
    defaultCapacity: {
      maxConcurrentJobs: parseInt(process.env.DEFAULT_MAX_CONCURRENT_JOBS || '3'),
      minConcurrentJobs: parseInt(process.env.DEFAULT_MIN_CONCURRENT_JOBS || '1'),
      maxAllowedCapacity: parseInt(process.env.MAX_ALLOWED_CAPACITY || '10')
    },
    
    jobQueue: {
      maxQueueSize: parseInt(process.env.JOB_QUEUE_MAX_SIZE || '50'),
      deliveryDelayMs: parseInt(process.env.JOB_DELIVERY_DELAY_MS || '100'),
      processingTimeoutMs: parseInt(process.env.JOB_PROCESSING_TIMEOUT_MS || '30000'),
      jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '300000'),
      cleanupIntervalMs: parseInt(process.env.JOB_CLEANUP_INTERVAL_MS || '300000'),
      retryAttempts: parseInt(process.env.JOB_RETRY_ATTEMPTS || '3')
    },
    
    loadBalancing: {
      highUtilizationThreshold: parseInt(process.env.HIGH_UTILIZATION_THRESHOLD || '85'),
      lowUtilizationThreshold: parseInt(process.env.LOW_UTILIZATION_THRESHOLD || '30'),
      autoOptimizationEnabled: process.env.AUTO_OPTIMIZATION_ENABLED === 'true',
      emergencyRedistributionThreshold: parseInt(process.env.EMERGENCY_REDISTRIBUTION_THRESHOLD || '95')
    },
    
    monitoring: {
      metricsCollectionEnabled: process.env.METRICS_COLLECTION_ENABLED !== 'false',
      capacityCheckIntervalMs: parseInt(process.env.CAPACITY_CHECK_INTERVAL_MS || '60000'),
      performanceLogLevel: (process.env.PERFORMANCE_LOG_LEVEL as any) || 'info'
    },
    
    migration: {
      batchSize: parseInt(process.env.MIGRATION_BATCH_SIZE || '100'),
      backupEnabled: process.env.MIGRATION_BACKUP_ENABLED !== 'false',
      verificationEnabled: process.env.MIGRATION_VERIFICATION_ENABLED !== 'false'
    }
  };
}

/**
 * Validate configuration values
 */
export function validateMultiJobConfig(config: MultiJobConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate capacity settings
  if (config.defaultCapacity.maxConcurrentJobs < 1) {
    errors.push('maxConcurrentJobs must be at least 1');
  }
  if (config.defaultCapacity.maxConcurrentJobs > config.defaultCapacity.maxAllowedCapacity) {
    errors.push('maxConcurrentJobs cannot exceed maxAllowedCapacity');
  }
  if (config.defaultCapacity.minConcurrentJobs > config.defaultCapacity.maxConcurrentJobs) {
    errors.push('minConcurrentJobs cannot exceed maxConcurrentJobs');
  }

  // Validate queue settings
  if (config.jobQueue.maxQueueSize < 1) {
    errors.push('maxQueueSize must be at least 1');
  }
  if (config.jobQueue.deliveryDelayMs < 0) {
    errors.push('deliveryDelayMs cannot be negative');
  }
  if (config.jobQueue.jobTimeoutMs < 10000) {
    warnings.push('jobTimeoutMs less than 10 seconds may cause premature timeouts');
  }

  // Validate load balancing settings
  if (config.loadBalancing.highUtilizationThreshold <= config.loadBalancing.lowUtilizationThreshold) {
    errors.push('highUtilizationThreshold must be greater than lowUtilizationThreshold');
  }
  if (config.loadBalancing.highUtilizationThreshold > 100 || config.loadBalancing.lowUtilizationThreshold < 0) {
    errors.push('Utilization thresholds must be between 0 and 100');
  }

  // Validate migration settings
  if (config.migration.batchSize < 1) {
    errors.push('migration batchSize must be at least 1');
  }
  if (config.migration.batchSize > 1000) {
    warnings.push('migration batchSize over 1000 may cause memory issues');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}




