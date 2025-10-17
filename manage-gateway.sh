#!/bin/bash

# Start Redis if not already running
if ! pgrep redis-server > /dev/null; then
    echo "Starting Redis server..."
    redis-server --daemonize yes
    sleep 2
else
    echo "Redis server already running"
fi

# Navigate to the gateway directory
cd ic_websocket_gateway || {
    echo "Failed to enter ic_websocket_gateway directory"
    exit 1
}

# Run the Rust WebSocket Gateway with backtrace enabled
echo "🚀 Running WebSocket Gateway..."
RUST_BACKTRACE=1 cargo run
