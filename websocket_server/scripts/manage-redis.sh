#!/bin/bash

# Simple Redis Management Script for Sela Network

REDIS_CONTAINER="sela-redis"
REDIS_PORT="6380"

case "$1" in
    start)
        echo "🚀 Starting Redis..."
        docker run -d --name $REDIS_CONTAINER -p $REDIS_PORT:6379 \
            -v $(pwd)/data/redis:/data \
            redis:7-alpine redis-server --appendonly yes --dir /data
        echo "✅ Redis started on port $REDIS_PORT"
        ;;
    stop)
        echo "🛑 Stopping Redis..."
        docker stop $REDIS_CONTAINER
        docker rm $REDIS_CONTAINER
        echo "✅ Redis stopped"
        ;;
    restart)
        echo "🔄 Restarting Redis..."
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        if docker ps | grep -q $REDIS_CONTAINER; then
            echo "✅ Redis is running"
            echo "   Container: $REDIS_CONTAINER"
            echo "   Port: $REDIS_PORT"
            echo "   Data: $(pwd)/data/redis"
        else
            echo "❌ Redis is not running"
        fi
        ;;
    test)
        echo "🧪 Testing Redis connection..."
        if docker exec $REDIS_CONTAINER redis-cli ping 2>/dev/null | grep -q PONG; then
            echo "✅ Redis connection successful"
        else
            echo "❌ Redis connection failed"
        fi
        ;;
    logs)
        echo "📋 Redis logs:"
        docker logs $REDIS_CONTAINER
        ;;
    cli)
        echo "🔧 Opening Redis CLI..."
        docker exec -it $REDIS_CONTAINER redis-cli
        ;;
    backup)
        echo "💾 Creating backup..."
        docker exec $REDIS_CONTAINER redis-cli BGSAVE
        echo "✅ Backup initiated"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|test|logs|cli|backup}"
        echo ""
        echo "Commands:"
        echo "  start   - Start Redis container"
        echo "  stop    - Stop and remove Redis container"
        echo "  restart - Restart Redis container"
        echo "  status  - Show Redis status"
        echo "  test    - Test Redis connection"
        echo "  logs    - Show Redis logs"
        echo "  cli     - Open Redis CLI"
        echo "  backup  - Create backup"
        exit 1
        ;;
esac

