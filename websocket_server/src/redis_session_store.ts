import { createClient, RedisClientType } from "redis";
import { SessionData } from "./types";

/**
 * Redis-based session store
 * Provides the same functionality as the Rust version session_store.rs
 */
export class RedisSessionStore {
  private redisUrl: string;
  private client: RedisClientType | null = null;
  private isConnected = false;

  constructor(redisUrl = "redis://127.0.0.1:6380") {
    this.redisUrl = redisUrl;
    console.log(`🗄️ Redis session store initialized: ${redisUrl}`);
  }

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<boolean> {
    try {
      this.client = createClient({
        url: this.redisUrl,
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6380'),
          reconnectStrategy: (retries: number) => {
            // Maximum 30 seconds reconnection attempt
            return Math.min(retries * 50, 30000);
          },
        },
        password: process.env.REDIS_PASSWORD,
        database: parseInt(process.env.REDIS_DB || '0')
      });

      // Register event listeners
      this.client.on("error", (err: Error) => {
        console.error("❌ Redis client error:", err);
        this.isConnected = false;
      });

      this.client.on("connect", () => {
        console.log("🔗 Redis connection started");
      });

      this.client.on("ready", () => {
        console.log("✅ Redis connection ready");
        this.isConnected = true;
      });

      this.client.on("end", () => {
        console.log("📡 Redis connection ended");
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
      throw new Error(
        `Failed to connect to Redis: ${(error as Error).message}`
      );
    }
  }

  /**
   * Save session data
   * Same as Rust version save_session
   */
  async saveSession(
    sessionId: number,
    sessionData: SessionData
  ): Promise<boolean> {
    try {
      if (!this.isConnected || !this.client) {
        await this.connect();
      }

      const serializedData = JSON.stringify({
        client_id: sessionData.client_id,
        canister_id: sessionData.canister_id,
        timestamp: sessionData.timestamp || Math.floor(Date.now() / 1000),
      });

      // Set 24-hour TTL (same as Rust version)
      await this.client!.setEx(
        `session:${sessionId}`,
        86400, // 24 hours
        serializedData
      );

      console.log(
        `💾 Session saved: session_id=${sessionId}, client_id=${sessionData.client_id}`
      );
      return true;
    } catch (error) {
      console.error(`❌ Session save failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Delete session data
   * Same as Rust version remove_session
   */
  async removeSession(sessionId: number): Promise<boolean> {
    try {
      if (!this.isConnected || !this.client) {
        await this.connect();
      }

      const result = await this.client!.del(`session:${sessionId}`);

      if (result > 0) {
        console.log(`🗑️ Session deleted: session_id=${sessionId}`);
      } else {
        console.log(`📭 No session to delete: session_id=${sessionId}`);
      }

      return result > 0;
    } catch (error) {
      console.error(`❌ Session deletion failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.quit();
        console.log("✅ Redis connection closed properly");
      }
    } catch (error) {
      console.error("❌ Error closing Redis connection:", error);
    }
  }

  /**
   * Get the last used session ID
   */
  async getLastSessionId(): Promise<number> {
    try {
      if (!this.isConnected || !this.client) {
        await this.connect();
      }

      const lastSessionId = await this.client!.get('server:last_session_id');
      return lastSessionId ? parseInt(lastSessionId) : 0;
    } catch (error) {
      console.error(`❌ Failed to get last session ID: ${(error as Error).message}`);
      return 0;
    }
  }

  /**
   * Set the last used session ID
   */
  async setLastSessionId(sessionId: number): Promise<void> {
    try {
      if (!this.isConnected || !this.client) {
        await this.connect();
      }

      await this.client!.set('server:last_session_id', sessionId.toString());
      console.log(`📝 Updated last session ID: ${sessionId}`);
    } catch (error) {
      console.error(`❌ Failed to set last session ID: ${(error as Error).message}`);
    }
  }
}