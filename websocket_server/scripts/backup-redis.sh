#!/bin/bash

# Redis Backup Script for Sela Network
# This script creates backups of Redis data

set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="redis_backup_${TIMESTAMP}"

echo "💾 Creating Redis backup..."

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Create backup using docker-compose
echo "📦 Creating backup archive..."
docker-compose exec -T redis redis-cli BGSAVE

# Wait for save to complete
echo "⏳ Waiting for save to complete..."
sleep 10

# Copy data files
echo "📋 Copying data files..."
docker cp sela-redis:/data "${BACKUP_DIR}/${BACKUP_NAME}"

# Create compressed archive
echo "🗜️ Compressing backup..."
cd "${BACKUP_DIR}"
tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}"
rm -rf "${BACKUP_NAME}"

echo "✅ Backup created: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

# Clean up old backups (keep last 7 days)
echo "🧹 Cleaning up old backups..."
find "${BACKUP_DIR}" -name "redis_backup_*.tar.gz" -mtime +7 -delete

echo "🎉 Backup process completed!"

