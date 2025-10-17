#!/bin/bash

# Sela Network Redis Setup Script
# This script sets up a persistent Redis database for the WebSocket server

set -e

echo "🚀 Setting up Redis for Sela Network WebSocket Server..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "✅ .env file created. Please review and update the configuration."
fi

# Create data directory
echo "📁 Creating data directories..."
mkdir -p data/redis

# Set proper permissions
echo "🔐 Setting proper permissions..."
chmod 755 data/redis

# Start Redis services
echo "🐳 Starting Redis services with Docker Compose..."
docker-compose up -d

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
sleep 5

# Test Redis connection with password
echo "🔐 Testing Redis connection with password..."
if docker-compose exec -T redis redis-cli -a sela_db_password ping | grep -q "PONG"; then
    echo "✅ Redis connection test successful!"
else
    echo "❌ Redis connection test failed. Check the configuration."
    exit 1
fi

# Check if Redis is running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Redis is running successfully!"
    echo ""
    echo "📊 Redis Information:"
    echo "   - Host: localhost"
    echo "   - Port: 6379"
    echo "   - Password: sela123"
    echo "   - Database: 1"
    echo "   - Web UI: http://localhost:8081"
    echo ""
    echo "🔧 Useful commands:"
    echo "   - View logs: docker-compose logs -f redis"
    echo "   - Stop services: docker-compose down"
    echo "   - Restart services: docker-compose restart"
    echo "   - Access Redis CLI: docker-compose exec redis redis-cli -a sela123"
    echo "   - Test connection: docker-compose exec redis redis-cli -a sela123 ping"
    echo ""
    echo "💾 Data persistence:"
    echo "   - RDB snapshots: data/redis/dump.rdb"
    echo "   - AOF logs: data/redis/appendonly.aof"
    echo ""
    echo "🎉 Setup complete! You can now start your WebSocket server."
else
    echo "❌ Failed to start Redis. Check the logs with: docker-compose logs"
    exit 1
fi
