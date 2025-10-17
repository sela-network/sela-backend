# Redis Database Setup for Sela Network WebSocket Server

This guide explains how to set up and manage a persistent Redis database for the Sela Network WebSocket server.

## Overview

The WebSocket server uses Redis as its primary database for storing:
- Client information and sessions
- Job assignments and status
- User rewards and earnings
- API keys and usage tracking
- Real-time statistics

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Node.js 16+ and npm/yarn
- Git

### 1. Setup Redis Database

```bash
# Navigate to the websocket_server directory
cd websocket_server

# Run the setup script
./scripts/setup-redis.sh
```

This script will:
- Create necessary directories
- Start Redis with persistence enabled
- Launch Redis Commander (web UI)
- Verify the setup

### 2. Configure Environment

The setup script creates a `.env` file from `env.example`. Review and update the configuration:

```env
# Redis Configuration
REDIS_URL=redis://127.0.0.1:6379
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
# Redis Database Setup with Authentication

This guide explains the Redis setup for the Sela Network WebSocket server with password protection and database selection.

## 🔐 Redis Configuration

### Authentication Details
- **Password**: `sela123`
- **Database**: `1` (mapped to "seladb" in application)
- **Port**: `6379` (standard Redis port)
- **Host**: `localhost`

### Database Naming Convention
Redis uses numeric database indices (0-15). We've configured database `1` to represent "seladb" in your application. This allows you to:
- Use a meaningful name in your code (`seladb`)
- Maintain compatibility with Redis' numeric system
- Easily switch between databases if needed

### Connection String Format
```
redis://:sela123@localhost:6379/1
```

## 🚀 Quick Setup

### 1. Run the Setup Script
```bash
cd websocket_server
./scripts/setup-redis.sh
```

This script will:
- Create necessary directories
- Start Redis with password protection
- Launch Redis Commander (web UI)
- Test the connection

### 2. Test the Connection
```bash
./scripts/test-redis.sh
```

## 🐳 Docker Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f redis
```

### Access Redis CLI
```bash
# Connect with password
docker-compose exec redis redis-cli -a sela123

# Select database 1 (seladb)
SELECT 1

# Test connection
PING
```

## 🌐 Web Interface

Redis Commander is available at: **http://localhost:8081**

- **Host**: `redis`
- **Port**: `6379`
- **Database**: `1` (seladb)
- **Password**: `sela123`

## 📁 Data Persistence

All Redis data is stored in `./data/redis/`:
- **RDB snapshots**: `dump.rdb`
- **AOF logs**: `appendonly.aof`
- **Data survives**: Container restarts, rebuilds, and system restarts

## 🔧 Environment Variables

Update your `.env` file with:
```env
REDIS_URL=redis://:sela123@127.0.0.1:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=sela123
REDIS_DB=0
```

## 🧪 Testing

### Manual Connection Test
```bash
# Test basic connectivity
docker-compose exec redis redis-cli -a sela_db_password ping

# Test database operations
docker-compose exec redis redis-cli -a sela_db_password --eval - <<< "
redis.call('SELECT', 'sela_redis_db')
redis.call('SET', 'test', 'value')
return redis.call('GET', 'test')
"
```

### Application Integration
Your application should connect using:
```typescript
// Example connection
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'sela123',
  db: 1  // Database 1 (mapped to "seladb" in your application)
});
```

## 🚨 Security Notes

- **Password is required** for all Redis operations
- **Database selection** is required for proper data isolation
- **Port 6379** is the standard Redis port
- **Data is persistent** and survives container operations

## 📊 Monitoring

### Health Check
Redis includes built-in health checks:
- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Retries**: 3

### Logs
```bash
# View Redis logs
docker-compose logs -f redis

# View Redis Commander logs
docker-compose logs -f redis-commander
```

## 🔄 Troubleshooting

### Common Issues

1. **Connection Refused**
   - Check if Redis is running: `docker-compose ps`
   - Verify port mapping: `netstat -tlnp | grep 6379`

2. **Authentication Failed**
   - Verify password in `redis.conf`
   - Check environment variables

3. **Database Not Found**
   - Ensure database selection in application code
   - Verify Redis Commander configuration

### Reset Redis
```bash
# Stop services
docker-compose down

# Remove data (WARNING: This will delete all data)
sudo rm -rf data/redis/*

# Restart services
docker-compose up -d
```
 
### 3. Start the WebSocket Server

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev
```

## Redis Configuration

### Persistent Storage

The Redis setup uses **bind mount persistence** to ensure your data is never lost:

- **Local Directory**: Data is stored in `./data/redis/` relative to the websocket_server directory
- **True Persistence**: Data survives container removal, rebuilds, and system restarts
- **Direct Access**: You can directly access and backup the data directory
- **No Data Loss**: Even if you run `docker-compose down -v`, your data remains safe

**Important**: The `data/` directory is excluded from Git via `.gitignore` to prevent committing database files.

### Persistence Settings

The Redis configuration (`redis.conf`) includes:

- **RDB Persistence**: Automatic snapshots every 15 minutes, 5 minutes, and 1 minute
- **AOF Persistence**: Append-only file with fsync every second
- **Memory Management**: 256MB limit with LRU eviction
- **Performance**: Optimized for the application workload

### Key Features

- **Data Durability**: Both RDB and AOF persistence enabled
- **Automatic Recovery**: Data survives container restarts
- **Memory Optimization**: Efficient memory usage with LRU eviction
- **Monitoring**: Built-in health checks and metrics

### Data Backup and Recovery

Since your data is stored in the local `./data/redis/` directory, you can easily:

```bash
# Backup your Redis data
cp -r ./data/redis ./backup/redis-$(date +%Y%m%d)

# Restore from backup
cp -r ./backup/redis-20241201 ./data/redis

# Check data directory size
du -sh ./data/redis

# List all data files
ls -la ./data/redis/
```

## Management Commands

### Start/Stop Services

```bash
# Start Redis services
docker-compose up -d

# Stop Redis services
docker-compose down

# Restart Redis services
docker-compose restart

# View service status
docker-compose ps
```

### View Logs

```bash
# View Redis logs
docker-compose logs -f redis

# View Redis Commander logs
docker-compose logs -f redis-commander
```

### Access Redis CLI

```bash
# Connect to Redis CLI
docker-compose exec redis redis-cli

# Test connection
docker-compose exec redis redis-cli ping
```

### Backup and Restore

```bash
# Create backup
./scripts/backup-redis.sh

# Manual backup
docker-compose exec redis redis-cli BGSAVE

# Restore from backup (manual process)
# 1. Stop Redis: docker-compose down
# 2. Replace data files in data/redis/
# 3. Start Redis: docker-compose up -d
```

## Web Interface

Redis Commander provides a web interface for database management:

- **URL**: http://localhost:8081
- **Features**: Browse keys, view data, execute commands
- **Security**: No authentication by default (for development)


## Monitoring and Maintenance

### Health Checks

The Redis container includes health checks:

```bash
# Check health status
docker-compose ps

# View health check logs
docker-compose exec redis redis-cli info server
```

### Performance Monitoring

```bash
# View Redis info
docker-compose exec redis redis-cli info

# Monitor memory usage
docker-compose exec redis redis-cli info memory

# View slow queries
docker-compose exec redis redis-cli slowlog get 10
```

### Data Cleanup

```bash
# Clear all data (development only)
docker-compose exec redis redis-cli FLUSHALL

# Clear specific database
docker-compose exec redis redis-cli -n 0 FLUSHDB
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check what's using port 6379
   sudo lsof -i :6379
   
   # Stop conflicting service
   sudo systemctl stop redis-server
   ```

2. **Permission Denied**
   ```bash
   # Fix data directory permissions
   sudo chown -R $USER:$USER data/redis
   chmod 755 data/redis
   ```

3. **Memory Issues**
   ```bash
   # Check memory usage
   docker-compose exec redis redis-cli info memory
   
   # Adjust memory limit in redis.conf
   # maxmemory 512mb
   ```

4. **Connection Refused**
   ```bash
   # Check if Redis is running
   docker-compose ps
   
   # Check logs
   docker-compose logs redis
   ```

### Log Analysis

```bash
# View recent logs
docker-compose logs --tail=100 redis

# Search for errors
docker-compose logs redis | grep -i error

# Monitor real-time logs
docker-compose logs -f redis
```

## Security Considerations

### Production Setup

For production environments:

1. **Enable Authentication**
   ```bash
   # Uncomment in redis.conf
   requirepass your_strong_password_here
   ```

2. **Network Security**
   ```bash
   # Bind to localhost only
   bind 127.0.0.1
   ```

3. **SSL/TLS**
   ```bash
   # Enable SSL in redis.conf
   tls-port 6380
   tls-cert-file /path/to/cert.pem
   tls-key-file /path/to/key.pem
   ```

4. **Firewall Rules**
   ```bash
   # Allow only specific IPs
   ufw allow from 192.168.1.0/24 to any port 6379
   ```

## Backup Strategy

### Automated Backups

Set up a cron job for automated backups:

```bash
# Add to crontab
0 2 * * * /path/to/websocket_server/scripts/backup-redis.sh
```

### Backup Verification

```bash
# Verify backup integrity
tar -tzf backups/redis_backup_20231201_020000.tar.gz

# Test restore in isolated environment
docker run --rm -v /path/to/backup:/backup redis:7-alpine sh -c "cd /backup && tar -xzf *.tar.gz"
```

## Performance Tuning

### Memory Optimization

```bash
# Monitor memory usage
docker-compose exec redis redis-cli info memory

# Adjust memory policy
# maxmemory-policy allkeys-lru
```

### Connection Pooling

The application uses connection pooling for optimal performance:

```typescript
// Connection configuration
const client = createClient({
  url: config.redis.url,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 500)
  }
});
```


## Migration from Development to Production

1. **Update Configuration**
   - Set strong passwords
   - Configure SSL/TLS
   - Adjust memory limits
   - Set up monitoring

2. **Deploy with Orchestration**
   - Use Docker Swarm or Kubernetes
   - Set up load balancing
   - Configure auto-scaling

3. **Monitoring and Alerting**
   - Set up Redis monitoring
   - Configure alerts for memory usage
   - Monitor connection counts

4. **Backup and Recovery**
   - Set up automated backups
   - Test recovery procedures
   - Document disaster recovery plan

