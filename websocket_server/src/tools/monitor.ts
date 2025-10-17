import WebSocket from "ws";
import * as http from "http";
import * as cbor from "cbor";
import { MonitorStats, ServerHealth } from "../types";

/**
 * WebSocket Server Monitoring Tool
 * Real-time monitoring of server status and statistics output
 */
export class WebSocketMonitor {
  private serverUrl: string;
  private isMonitoring = false;
  private ws: WebSocket | null = null;
  private stats: MonitorStats;
  private statsInterval?: NodeJS.Timeout;
  private connectionCheckInterval?: NodeJS.Timeout;

  constructor(serverUrl = "ws://localhost:8082") {
    this.serverUrl = serverUrl;
    this.stats = {
      totalMessages: 0,
      connectionAttempts: 0,
      errors: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Start monitoring
   */
  start(): void {
    console.log("📊 Starting WebSocket server monitoring...");
    console.log(`🔗 Target server: ${this.serverUrl}`);
    console.log("=".repeat(60));

    this.isMonitoring = true;
    this.connectAndMonitor();

    // Periodic statistics output (every 10 seconds)
    this.statsInterval = setInterval(() => {
      this.printStats();
    }, 10000);

    // Connection status check (every 5 seconds)
    this.connectionCheckInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log("🔄 Retrying connection...");
        this.connectAndMonitor();
      }
    }, 5000);
  }

  /**
   * Connect to server and start monitoring
   */
  private connectAndMonitor(): void {
    if (!this.isMonitoring) return;

    this.stats.connectionAttempts++;

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on("open", () => {
        console.log("✅ Server connection successful");
        this.onConnected();
      });

      this.ws.on("message", (data: Buffer) => {
        this.onMessage(data);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        console.log(
          `❌ Connection closed: code=${code}, reason=${reason.toString()}`
        );
      });

      this.ws.on("error", (error: Error) => {
        this.stats.errors++;
        console.error("❌ Connection error:", error.message);
      });
    } catch (error) {
      this.stats.errors++;
      console.error("❌ Connection failed:", (error as Error).message);
    }
  }

  /**
   * Handle successful connection
   */
  private onConnected(): void {
    // Send simple ping message (connection test)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        // Test connection with empty message
        this.ws.ping();
      } catch (error) {
        console.error("❌ Ping send failed:", (error as Error).message);
      }
    }
  }

  /**
   * Handle message reception
   */
  private onMessage(data: Buffer): void {
    this.stats.totalMessages++;

    try {
      // Analyze data size and type
      const size = data.length;
      const type = Buffer.isBuffer(data) ? "Binary" : "Text";

      console.log(`📨 Message received: ${type}, ${size} bytes`);

      // Try CBOR decoding (optional)
      if (Buffer.isBuffer(data)) {
        try {
          const decoded = cbor.decode(data);
          console.log("📋 CBOR content:", this.summarizeObject(decoded));
        } catch (error) {
          console.log("⚠️ CBOR decoding failed (normal situation)");
        }
      }
    } catch (error) {
      console.error("❌ Message processing error:", (error as Error).message);
    }
  }

  /**
   * Object summary (simple representation of deep objects)
   */
  private summarizeObject(obj: any, maxDepth = 2, currentDepth = 0): any {
    if (currentDepth >= maxDepth) return "[...]";

    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return `Array(${obj.length})`;
    }

    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";

    const summary: any = {};
    keys.slice(0, 3).forEach((key) => {
      summary[key] = this.summarizeObject(obj[key], maxDepth, currentDepth + 1);
    });

    if (keys.length > 3) {
      summary["..."] = `${keys.length - 3} more`;
    }

    return summary;
  }

  /**
   * Print statistics
   */
  private printStats(): void {
    const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
    const connectionStatus =
      this.ws && this.ws.readyState === WebSocket.OPEN
        ? "🟢 Connected"
        : "🔴 Disconnected";

    console.log("\n📊 Monitoring Statistics:");
    console.log(`   Status: ${connectionStatus}`);
    console.log(`   Uptime: ${uptime}s`);
    console.log(
      `   Connection attempts: ${this.stats.connectionAttempts} times`
    );
    console.log(`   Messages received: ${this.stats.totalMessages} messages`);
    console.log(`   Errors occurred: ${this.stats.errors} times`);
    console.log("=".repeat(40));
  }

  /**
   * Check server health (HTTP request)
   */
  async checkServerHealth(): Promise<ServerHealth> {
    try {
      const url = this.serverUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://");

      return new Promise((resolve) => {
        const req = http.get(url, (res) => {
          resolve({
            status: res.statusCode || 0,
            message: "HTTP response received",
          });
        });

        req.on("error", (error: Error) => {
          resolve({
            status: "error",
            message: error.message,
          });
        });

        req.setTimeout(5000, () => {
          req.destroy();
          resolve({
            status: "timeout",
            message: "Response timeout",
          });
        });
      });
    } catch (error) {
      return {
        status: "error",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    console.log("\n🛑 Stopping monitoring...");

    this.isMonitoring = false;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }

    if (this.ws) {
      this.ws.close();
    }

    this.printFinalStats();
    console.log("✅ Monitoring complete");
  }

  /**
   * Print final statistics
   */
  private printFinalStats(): void {
    const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);

    console.log("\n📋 Final Statistics:");
    console.log(`   Total uptime: ${uptime}s`);
    console.log(
      `   Total connection attempts: ${this.stats.connectionAttempts} times`
    );
    console.log(
      `   Total messages received: ${this.stats.totalMessages} messages`
    );
    console.log(`   Total errors occurred: ${this.stats.errors} times`);

    if (this.stats.totalMessages > 0) {
      const messagesPerSecond = (this.stats.totalMessages / uptime).toFixed(2);
      console.log(`   Messages per second: ${messagesPerSecond} messages/s`);
    }
  }
}

/**
 * CLI execution
 */
if (require.main === module) {
  const serverUrl = process.argv[2] || "ws://localhost:8082";
  const monitor = new WebSocketMonitor(serverUrl);

  // Start monitoring
  monitor.start();

  // Server health check (once at startup)
  monitor.checkServerHealth().then((health: ServerHealth) => {
    console.log(`🏥 Server status: ${health.status} - ${health.message}`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n📊 Received monitoring termination signal...");
    monitor.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  process.on("SIGTERM", () => {
    monitor.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  // Help output
  console.log("\n💡 Usage:");
  console.log("   Ctrl+C: Stop monitoring");
  console.log("   Statistics are automatically output every 10 seconds");
  console.log("\n🔍 Starting monitoring...");
}
