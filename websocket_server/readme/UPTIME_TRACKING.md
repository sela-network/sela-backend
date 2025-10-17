# Uptime Tracking System

## Overview
The Sela Network WebSocket server tracks client uptime for reward distribution based on connection duration and network performance.

## How It Works

### 1. Session Initialization
- Client connects via WebSocket → Uptime session starts
- Daily record initialized (0 minutes if first session of day)
- Session stored in Redis with unique session ID

### 2. Activity Tracking
- **Any message** from client acts as heartbeat
- **INTERNET_SPEED_TEST** messages update speed/ping data
- Session duration calculated in real-time
- Last activity timestamp updated on every message

### 3. Session Monitoring
- **Server Health Check**: Every 30 seconds, disconnects clients inactive > 2 minutes
- **UptimeTracker**: 90-second timeout threshold for session finalization
- **WebSocket Disconnect**: Immediately finalizes session and calculates total uptime

### 4. Session Finalization
- Session duration added to daily total
- Performance averages calculated (speed/ping)
- Tier level determined based on performance
- Daily record updated in Redis

## Data Storage

### Redis Keys
```
uptime:active:{user_id}           # Active session data
uptime:session:{user_id}:{id}     # Completed session records
uptime:daily:{date}:{user_id}     # Daily aggregated data
uptime:index:user:{user_id}:*     # User session indexes
```

### Performance Tiers
- **Tier 1**: ≥50 Mbps, ≤50ms ping (+20% bonus)
- **Tier 2**: ≥20 Mbps, ≤100ms ping (+10% bonus)
- **Tier 3**: ≥5 Mbps, ≤150ms ping (+5% bonus)
- **Tier 4**: <5 Mbps, >150ms ping (base rate only)

## Reward Calculation
```
Base Reward = Uptime minutes × 0.5 Sela
Bonus Reward = Base Reward × Tier Bonus Rate
Total Reward = Base Reward + Bonus Reward
```

## Configuration
- **Heartbeat Interval**: 30 seconds
- **Timeout Threshold**: 90 seconds
- **Base Reward Rate**: 0.5 Sela per minute
- **Daily Max**: 720 Sela (1440 minutes)
- **Weekly Max**: 5040 Sela

## API Endpoints
- `GET /api/node/uptime/{user_id}` - Get user's uptime stats
- `GET /api/node/uptime/today/{user_id}` - Get today's uptime
- `GET /api/node/uptime/total/{user_id}` - Get total lifetime uptime
