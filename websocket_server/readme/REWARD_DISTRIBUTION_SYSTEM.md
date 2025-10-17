# Reward Distribution System

## Overview

The Reward Distribution System is an automated cron job service that processes user uptime records and distributes Sela Points rewards based on their network performance and connection duration. The system is integrated into the HybridServer and runs as a background service.

## Features

- **Automated Distribution**: Runs on configurable cron schedule (default: every 5 minutes)
- **Performance-Based Rewards**: Tier-based bonus system based on speed and ping
- **Blockchain Integration**: Mints Sela Points directly to user wallets
- **Comprehensive Logging**: File-based logging with rotation and cleanup
- **API Monitoring**: REST endpoints for monitoring and manual triggers
- **Duplicate Prevention**: Tracks processed records to prevent double rewards

## Architecture

### Components

1. **RewardDistributionService**: Main service class handling cron job and distribution logic
2. **UptimeTracker**: Provides configuration and reward calculation parameters
3. **BlockchainService**: Handles Sela Points minting via ICP/ICRC1
4. **Database**: Redis storage for uptime records and transaction tracking
5. **API Routes**: REST endpoints for monitoring and management

### Data Flow

```
1. UptimeTracker → Daily Records (Redis) + Configuration
2. RewardDistributionService → Uses UptimeTracker config
3. Cron Job → Unprocessed Records
4. Reward Calculation → Tier-based bonuses (from UptimeTracker)
5. Blockchain Service → Sela Points minting
6. Database Update → User balances & processed flags
7. Logging → File-based audit trail
```

## Configuration

The reward distribution system now uses the **UptimeTracker's configuration** for all reward-related settings, providing better integration and consistency.

### Environment Variables

```bash
# Enable/disable reward distribution
REWARD_DISTRIBUTION_ENABLED=true

# Cron schedule (default: every 5 minutes)
REWARD_DISTRIBUTION_INTERVAL="*/5 * * * *"

# Logging configuration
REWARD_LOG_DIRECTORY=./logs/rewards
REWARD_MAX_LOG_FILES=30       # Keep last 30 log files
REWARD_MAX_LOG_SIZE_MB=10     # Rotate when file exceeds 10MB
```

### UptimeTracker Configuration

The reward limits and tier settings are now managed by the UptimeTracker:

```typescript
// Reward limits (from UptimeTracker config)
daily_min_reward: 0.5
daily_max_reward: 720
daily_max_reward_with_bonus: 864
weekly_max_reward: 5040
base_reward_rate: 0.5  // Sela points per minute

// Performance tiers (from UptimeTracker config)
performance_tiers: [
  { tier: 1, min_speed: 50, max_ping: 50, bonus_rate: 0.20 },
  { tier: 2, min_speed: 20, max_ping: 100, bonus_rate: 0.10 },
  { tier: 3, min_speed: 5, max_ping: 150, bonus_rate: 0.05 },
  { tier: 4, min_speed: 0, max_ping: 999, bonus_rate: 0.00 }
]
```

### Cron Schedule Examples

```bash
"*/1 * * * *"    # Every minute (testing)
"*/5 * * * *"    # Every 5 minutes (default)
"0 */1 * * *"    # Every hour
"0 0 * * *"      # Daily at midnight
"0 0 * * 0"      # Weekly on Sunday
```

## Reward Calculation

### Base Formula

```
Base Reward = Uptime Minutes × Base Reward Rate (from UptimeTracker config)
Bonus Reward = Base Reward × Tier Bonus Rate (from UptimeTracker config)
Total Reward = Base Reward + Bonus Reward
```

### Performance Tiers

| Tier | Min Speed | Max Ping | Bonus Rate | Description |
|------|-----------|----------|------------|-------------|
| 1    | ≥50 Mbps  | ≤50ms    | 20%        | High Performance |
| 2    | ≥20 Mbps  | ≤100ms   | 10%        | Good Performance |
| 3    | ≥5 Mbps   | ≤150ms   | 5%         | Standard Performance |
| 4    | <5 Mbps   | >150ms   | 0%         | Basic Performance |

### Example Calculations

**User A**: 8 hours (480 minutes), Tier 1
- Base: 480 × 0.5 (base_reward_rate) = 240 Sela Points
- Bonus: 240 × 0.20 (tier 1 bonus_rate) = 48 Sela Points
- Total: 288 Sela Points

**User B**: 4 hours (240 minutes), Tier 2
- Base: 240 × 0.5 (base_reward_rate) = 120 Sela Points
- Bonus: 120 × 0.10 (tier 2 bonus_rate) = 12 Sela Points
- Total: 132 Sela Points

## API Endpoints

### Service Status
```http
GET /api/rewards/status
```

Response:
```json
{
  "success": true,
  "data": {
    "isRunning": true,
    "config": {
      "enabled": true,
      "interval": "*/5 * * * *",
      "minDailyReward": 0.5,
      "maxDailyReward": 720,
      "maxDailyRewardWithBonus": 864,
      "maxWeeklyReward": 5040,
      "baseRewardRate": 0.5,
      "performanceTiers": [
        { "tier": 1, "min_speed": 50, "max_ping": 50, "bonus_rate": 0.20, "description": "Tier 1: High Performance" },
        { "tier": 2, "min_speed": 20, "max_ping": 100, "bonus_rate": 0.10, "description": "Tier 2: Good Performance" },
        { "tier": 3, "min_speed": 5, "max_ping": 150, "bonus_rate": 0.05, "description": "Tier 3: Standard Performance" },
        { "tier": 4, "min_speed": 0, "max_ping": 999, "bonus_rate": 0.00, "description": "Tier 4: Basic Performance" }
      ]
    },
    "currentLogFile": "./logs/rewards/reward-distribution-2024-01-15.log"
  }
}
```

### Manual Trigger
```http
POST /api/rewards/trigger
```

Response:
```json
{
  "success": true,
  "data": {
    "distributionId": "dist_1705123456789_1234",
    "status": "COMPLETED",
    "totalUsers": 15,
    "totalRewardsDistributed": 1250.5,
    "startedAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:30:15.000Z"
  }
}
```

### Distribution History
```http
GET /api/rewards/history?limit=10&offset=0
```

### User Reward History
```http
GET /api/rewards/user/{userPrincipalId}/history?limit=20&offset=0
```

### Unprocessed Records Count
```http
GET /api/rewards/unprocessed-count
```

### Log Files
```http
GET /api/rewards/logs?lines=100
```

## Data Structures

### Daily Uptime Record
```typescript
interface DailyUptimeRecord {
  date: string;                    // YYYY-MM-DD format
  user_principal_id: string;
  total_minutes: number;
  session_count: number;
  avg_speed: number;
  avg_ping: number;
  tier_level: number;
  base_reward: number;
  bonus_reward: number;
  total_reward: number;
  last_updated: number;
  is_processed: boolean;           // Key field for preventing duplicates
}
```

### Reward Transaction
```typescript
interface RewardTransaction {
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
```

### Distribution Status
```typescript
interface RewardDistributionStatus {
  distribution_id: string;
  distribution_date: string;
  distribution_type: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  total_users: number;
  total_rewards_distributed: number;
  started_at: number;
  completed_at?: number;
  error_details?: string;
  retry_count: number;
  max_retries: number;
}
```

## Redis Keys

### Uptime Records
```
uptime:daily:{date}:{user_id}     # Daily uptime records
uptime:active:{user_id}           # Active sessions
uptime:session:{user_id}:{id}     # Completed sessions
```

### Reward System
```
uptime:distribution:{id}          # Distribution status
uptime:transaction:{id}           # Reward transactions
```

### Indexes
```
uptime:index:user:{user_id}:*     # User session indexes
uptime:index:date:{date}:*        # Date-based indexes
```

## Logging

### Log Format
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "component": "RewardDistribution",
  "message": "Distribution completed successfully",
  "data": {
    "distributionId": "dist_1705123456789_1234",
    "totalUsers": 15,
    "successCount": 14,
    "failureCount": 1,
    "totalRewardsDistributed": 1250.5
  }
}
```

### Log Levels
- **INFO**: Normal operations, distribution status
- **WARN**: Non-critical issues, retries
- **ERROR**: Failed transactions, system errors

### Log Rotation
- **Size-based**: Rotate when file exceeds configured size
- **Time-based**: Daily log files with date stamps
- **Cleanup**: Automatic removal of old log files

## Error Handling

### Retry Logic
- Failed blockchain transactions are retried up to 3 times
- Exponential backoff between retries
- Failed transactions are logged with error details

### Partial Failures
- System continues processing other users if some fail
- Distribution status reflects partial success
- Individual transaction statuses are tracked

### Monitoring
- Real-time status via API endpoints
- Comprehensive logging for debugging
- Failed transaction alerts in logs

## Testing

### Test Script
```bash
# Run the test script
npm run test:rewards
# or
node src/test/reward_distribution_test.ts
```

### Test Features
- Creates mock users with different uptime and tiers
- Tests manual distribution trigger
- Verifies reward calculations
- Checks blockchain integration (dummy mode)
- Validates database updates

## Deployment

### Production Setup
1. Set environment variables in `.env`
2. Ensure Redis is running and accessible
3. Configure blockchain controller identity
4. Start the HybridServer
5. Monitor via API endpoints

### Monitoring
- Check service status: `GET /api/rewards/status`
- View recent distributions: `GET /api/rewards/history`
- Monitor logs: `GET /api/rewards/logs`
- Check unprocessed records: `GET /api/rewards/unprocessed-count`

## Troubleshooting

### Common Issues

1. **Service Not Starting**
   - Check `REWARD_DISTRIBUTION_ENABLED=true`
   - Verify Redis connection
   - Check log files for errors

2. **No Rewards Distributed**
   - Check for unprocessed daily records
   - Verify blockchain service configuration
   - Check controller identity setup

3. **Failed Transactions**
   - Review blockchain service logs
   - Check controller identity validity
   - Verify canister configuration

4. **Log File Issues**
   - Check log directory permissions
   - Verify disk space availability
   - Review log rotation settings

### Debug Commands
```bash
# Check service status
curl http://localhost:8082/api/rewards/status

# Trigger manual distribution
curl -X POST http://localhost:8082/api/rewards/trigger

# Check unprocessed records
curl http://localhost:8082/api/rewards/unprocessed-count

# View recent logs
curl http://localhost:8082/api/rewards/logs?lines=50
```

## Security Considerations

- **Controller Identity**: Keep PEM key secure and rotate regularly
- **API Access**: Consider authentication for monitoring endpoints
- **Log Security**: Ensure log files don't contain sensitive data
- **Rate Limiting**: Monitor for unusual distribution patterns

## Performance

- **Batch Processing**: Processes all unprocessed records in single run
- **Redis Optimization**: Uses efficient key patterns and indexes
- **Log Rotation**: Prevents disk space issues
- **Memory Management**: Cleans up old log streams

## Future Enhancements

- **Weekly/Monthly Distributions**: Support for different distribution frequencies
- **Advanced Analytics**: Detailed reporting and analytics
- **Notification System**: Alerts for failed distributions
- **Web Dashboard**: Real-time monitoring interface
- **A/B Testing**: Support for different reward configurations
