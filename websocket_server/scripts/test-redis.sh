#!/bin/bash

# Final Redis Test Script
# Simple and reliable Redis connection test

set -e

echo "🔐 Testing Redis connection..."

# Test basic connection
echo "📡 Testing basic connection..."
if timeout 10 docker exec sela-redis redis-cli -a sela123 ping | grep -q "PONG"; then
    echo "✅ Basic connection successful!"
else
    echo "❌ Basic connection failed!"
    exit 1
fi

# Test if Redis Commander is accessible
echo "🌐 Testing Redis Commander..."
if curl -s --connect-timeout 5 http://localhost:8081 > /dev/null; then
    echo "✅ Redis Commander is accessible"
else
    echo "❌ Redis Commander is not accessible"
fi

echo ""
echo "🎉 Redis is working successfully!"
echo "📊 Configuration Summary:"
echo "   - Password: sela123"
echo "   - Database: 1 (seladb)"
echo "   - Port: 6379"
echo "   - Web UI: http://localhost:8081"
echo ""
echo "🔧 Manual test commands:"
echo "   docker exec sela-redis redis-cli -a sela123 ping"
echo "   docker exec sela-redis redis-cli -a sela123"
echo ""
echo "📝 Note: Redis is running with password protection"
