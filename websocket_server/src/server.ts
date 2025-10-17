import "dotenv/config";
import WebSocket from "ws";
import { EventEmitter } from "events";
import { RedisSessionStore } from "./redis_session_store";
import { Database } from "./db/database";
import { DatabaseService } from "./db/service";
import { DatabaseConfig } from "./db/types";
import { WebSocketFileHandler } from "./handlers/websocket_file_handler";
import { RpcWebSocketHandler } from "./handlers/rpc_websocket_handler";
import { NodeWebSocketHandler } from "./handlers/node_websocket_handler";
import { NodeService } from "./services/node_service";
import { FileService } from "./services/file_service";
import { UptimeTracker } from "./services/uptime_tracker";
import { ScrapeLogger } from "./utils/scrape_logger";
import {
  ServerOptions,
  ClientSession,
  ServerStats,
  ApplicationMessage,
  SessionData,
  SpeedTestData,
  ClientRegisteredEvent,
  ClientDisconnectedEvent,
  SpeedTestReceivedEvent,
  FileUploadWebSocketMessage,
} from "./types";

/**
 * Sela Network WebSocket Server
 * WebSocket server for real-time communication with Flutter apps
 */
export class SelaWebSocketServer extends EventEmitter {
  private port: number;
  private host: string;
  private wss: WebSocket.Server | null = null;
  private sessionStore: RedisSessionStore;
  private database: Database;
  private databaseService: DatabaseService;
  private clients: Map<number, ClientSession> = new Map();
  private nextSessionId = 1;
  private stats: ServerStats;
  private fileHandler: WebSocketFileHandler;
  private rpcHandler: RpcWebSocketHandler;
  private nodeHandler: NodeWebSocketHandler;
  private nodeService: NodeService;
  private uptimeTracker: UptimeTracker;

  constructor(options: ServerOptions = {}) {
    super();

    this.port = options.port || 8082;
    this.host = options.host || "localhost";

    const dbConfig: DatabaseConfig = {
      redis: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6380'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0')
      },
      timeouts: {
        deadTimeout: parseInt(process.env.DEAD_TIMEOUT || '3600000'), // 1 hour in milliseconds
        sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '86400') // 24 hours in seconds
      },
      limits: {
        usageLimit: parseInt(process.env.USAGE_LIMIT || '10000'),
        maxJobsPerClient: parseInt(process.env.MAX_JOBS_PER_CLIENT || '10')
      }
    };

    this.database = new Database(dbConfig);
    this.databaseService = new DatabaseService(this.database);

    // Use the same Redis configuration as the database
    const redisUrl = dbConfig.redis.url || `redis://${dbConfig.redis.host}:${dbConfig.redis.port}`;
    this.sessionStore = new RedisSessionStore(redisUrl);

    const fileService = new FileService(this.database);
    this.fileHandler = new WebSocketFileHandler(fileService);
    this.rpcHandler = new RpcWebSocketHandler(this.database);
    this.nodeService = new NodeService(this.databaseService, fileService);
    this.nodeHandler = new NodeWebSocketHandler(this.database, this.nodeService);
    this.uptimeTracker = new UptimeTracker(this.database);

    // Set up RPC handler event listeners
    this.rpcHandler.on("speedTestReceived", (event) => {
      this.emit("speedTestReceived", event);
    });

    // Server statistics
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      startTime: Date.now(),
    };

    console.log(
      `🚀 Sela WebSocket Server initialized - ${this.host}:${this.port}`
    );
    console.log(`🗄️ Database: Redis`);
    console.log(`⏱️ Uptime tracking: Enabled`);
  }

  /**
   * Initialize session ID from Redis persistence
   */
  private async initializeSessionId(): Promise<void> {
    try {
      const lastSessionId = await this.sessionStore.getLastSessionId();
      this.nextSessionId = lastSessionId + 1;
      console.log(`📊 Restored session ID counter from Redis: ${lastSessionId} -> ${this.nextSessionId}`);
    } catch (error) {
      console.warn("⚠️ Failed to load session ID from Redis, starting from 1:", (error as Error).message);
      this.nextSessionId = 1;
    }
  }

  /**
   * Get next session ID and persist it
   */
  private async getNextSessionId(): Promise<number> {
    const sessionId = this.nextSessionId++;
    try {
      await this.sessionStore.setLastSessionId(sessionId);
    } catch (error) {
      console.warn("⚠️ Failed to persist session ID:", (error as Error).message);
    }
    return sessionId;
  }

  /**
   * Start server
   */
  async start(): Promise<SelaWebSocketServer> {
    try {
          // Initialize Database
    console.log("🔗 Initializing Database...");
    await this.database.connect();
    console.log("✅ Database initialization complete");

      // Connect Redis session store
      console.log("🗄️ Connecting Redis session store...");
      await this.sessionStore.connect();
      console.log("✅ Redis session store connection complete");

      // Initialize session ID from Redis
      await this.initializeSessionId();
      console.log(`🔢 Session ID initialized: starting from ${this.nextSessionId}`);

      // Start WebSocket server
      this.wss = new WebSocket.Server({
        port: this.port,
        host: this.host,
        perMessageDeflate: false,
        maxPayload: 1024 * 1024, // 1MB
      });

      console.log(
        `🌐 WebSocket server started: ws://${this.host}:${this.port}`
      );

      this.wss.on("connection", async (ws: WebSocket, req) => {
        await this.handleNewConnection(ws, req);
      });

      this.wss.on("error", (error: Error) => {
        console.error("❌ Server error:", error);
        this.emit("error", error);
      });

      // Start periodic health check
      this.startHealthCheck();

      return this;
    } catch (error) {
      console.error("❌ Server start failed:", error);
      throw error;
    }
  }

  /**
   * Handle new client connection (similar to Rust GatewayServer::accept)
   */
  protected async handleNewConnection(ws: WebSocket, req: any): Promise<void> {
    const clientIp = req.socket.remoteAddress;
    const sessionId = await this.getNextSessionId();

    // Extract authorization header or query parameter for principal ID
    const authHeader = req.headers.authorization;
    const url = new URL(req.url, `http://${req.headers.host}`);
    let principalId = null;
    
    if (authHeader) {
      // Extract principal ID from Authorization header (format: "Bearer principal-id")
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        principalId = parts[1];
      } else {
        // If the entire header is the principal ID (no "Bearer" prefix)
        principalId = authHeader;
      }
    } else if (url.searchParams.get('authorization')) {
      // Extract from query parameter: ?authorization=Bearer%20principal-id
      const authParam = decodeURIComponent(url.searchParams.get('authorization') || '');
      const parts = authParam.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        principalId = parts[1];
      } else {
        principalId = authParam;
      }
    } else if (url.searchParams.get('principal_id')) {
      // Direct principal ID in query: ?principal_id=your-principal-id
      principalId = url.searchParams.get('principal_id');
    }

    console.log(
      `🔗 New client connection: ${clientIp}, Session ID: ${sessionId}, Principal: ${principalId || 'none'}`
    );

    // Clean up principal ID - remove "Bearer " prefix if present
    if (principalId && principalId.startsWith('Bearer ')) {
      principalId = principalId.substring(7); // Remove "Bearer " (7 characters)
      console.log(`🧹 Cleaned principal ID: ${principalId}`);
    }

    this.stats.totalConnections++;
    this.stats.activeConnections++;

    // Create client session information
    const clientSession: ClientSession = {
      id: sessionId,
      ws: ws,
      isRegistered: false,
      clientId: null,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      messagesSent: 0,
      messagesReceived: 0,
      userPrincipalId: principalId, // Store principal ID from auth header
    };

    this.clients.set(sessionId, clientSession);
    (ws as any).sessionId = sessionId;

    // Set connection timeout (300 seconds)
    const connectionTimeout = setTimeout(() => {
      if (!clientSession.isRegistered) {
        console.log(`⏰ Client registration timeout: ${clientIp}`);
        ws.close(1008, "Registration timeout");
      }
    }, 300000);

    ws.on("message", async (data: Buffer) => {
      clearTimeout(connectionTimeout);
      await this.handleMessage(ws, data);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.handleClientDisconnect(ws, code, reason.toString());
    });

    ws.on("error", (error: Error) => {
      console.error(`❌ Client error [Session ${sessionId}]:`, error);
      this.handleClientDisconnect(ws, 1006, "Error occurred");
    });

    ws.on("ping", () => {
      ws.pong();
    });
  }

  /**
   * Handle message processing (similar to Rust GatewaySession::binary)
   */
  private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
    const messageArrivedAt = Date.now();
    const messageArrivedISO = new Date(messageArrivedAt).toISOString();
    
    try {
      this.stats.messagesReceived++;
      const sessionId = (ws as any).sessionId;
      const clientSession = this.clients.get(sessionId);

      if (!clientSession) {
        console.error("❌ Session not found:", sessionId);
        ws.close(1008, "Session not found");
        return;
      }

      // Update heartbeat on ANY message received
      clientSession.lastHeartbeat = Date.now();
      
      // Log message arrival (parse to check if it's a result message)
      try {
        const textData = data.toString("utf8");
        const messageData = JSON.parse(textData);
        const messageType = messageData.text || messageData.type;
        if (messageType === 'TWITTER_SCRAPE_RESULT') {
          const jobId = messageData.job_id || 'unknown';
          ScrapeLogger.logMessageArrival(jobId, messageType);
        }
      } catch (preParseError) {
        // Ignore parsing errors at this stage
      }

      // If not registered - first message (registration)
      if (!clientSession.isRegistered) {
        console.log("📝 Client not registered, processing registration message");
        await this.handleRegistrationMessage(clientSession, data);
      } else {
        console.log("📝 Client registered, processing message");
        
        // Update uptime tracking for any message (acts as heartbeat)
        if (clientSession.userPrincipalId) {
          try {
            await this.uptimeTracker.updateClientActivity(clientSession.userPrincipalId);
          } catch (error) {
            console.log(`⚠️ Failed to update uptime activity: ${error}`);
          }
        }
        
        await this.handleClientMessage(clientSession, data);
      }

      clientSession.messagesReceived++;
    } catch (error) {
      console.error("❌ Message processing failed:", (error as Error).message);
      this.sendError(
        ws,
        "Message processing failed: " + (error as Error).message
      );
    }
  }



  /**
   * Handle registration message (simplified JSON-based)
   */
  private async handleRegistrationMessage(
    clientSession: ClientSession,
    data: Buffer
  ): Promise<void> {
    try {
      console.log("📩 Processing registration message");

      // Use principal ID from connection (query param or auth header)
      let userPrincipalId = clientSession.userPrincipalId;
      
      if (!userPrincipalId) {
        // Fallback: try to extract from message data
        try {
          const textData = data.toString("utf8");
          const messageData = JSON.parse(textData);
          
          if (messageData.principal_id) {
            userPrincipalId = messageData.principal_id;
          } else {
            throw new Error("Principal ID required either in connection or message");
          }
        } catch (parseError) {
          throw new Error("Invalid JSON message format");
        }
      }

      // Validate that we have a principal ID
      if (!userPrincipalId) {
        throw new Error("Principal ID is required for registration");
      }

      console.log(`📩 Registering client with principal ID: ${userPrincipalId}`);

      // Generate a simple client ID
      const clientId = Date.now().toString(); //  timestamp-based client ID
      
      // Login or create client
      const loginResult = await this.databaseService.login(userPrincipalId);
      if (!loginResult.success) {
        console.log("❌ Client login failed");
        this.sendError(clientSession.ws, "Login failed: " + loginResult.error.message);
        return;
      }

      // Connect client
      const connectResult = await this.databaseService.clientConnect(userPrincipalId, clientId);
      if (!connectResult.success) {
        console.log("❌ Client connection failed");
        this.sendError(clientSession.ws, "Connection failed: " + connectResult.error.message);
        return;
      }

      // Update client session information 
      clientSession.isRegistered = true;
      clientSession.clientId = clientId;
      clientSession.userPrincipalId = userPrincipalId;

      // Initialize node-specific session via NodeWebSocketHandler
      const nodeInitResult = await this.nodeHandler.initializeNodeSession(
        clientSession,
        userPrincipalId
      );

      if (!nodeInitResult.success) {
        this.sendError(clientSession.ws, nodeInitResult.error || "Node session initialization failed");
        return;
      }

      // Initialize uptime tracking for the client
      const uptimeInitResult = await this.uptimeTracker.initializeUptimeTracking(userPrincipalId, clientId);
      if (!uptimeInitResult.success) {
        console.log("⚠️ Uptime tracking initialization failed, but continuing with registration");
      } else {
        console.log(`✅ Uptime tracking initialized for user: ${userPrincipalId}`);
      }

      // Save session data
      const sessionData: SessionData = {
        client_id: clientId,
        canister_id: userPrincipalId,
        timestamp: Math.floor(Date.now() / 1000),
      };

      await this.sessionStore.saveSession(clientSession.id, sessionData);

      // Create WebSocket session
      const wsSessionId = await this.databaseService.wsCreateSession(userPrincipalId, clientId);
      clientSession.wsSessionId = wsSessionId; // Store for cleanup

      console.log(
        `✅ Client registration complete: Session ${clientSession.id}, Client ${clientId}, Principal ${userPrincipalId}, WS Session ${wsSessionId}`
      );

      // Send success response to client
      this.sendJsonResponse(clientSession.ws, {
        success: true,
        message: "Registration successful",
        clientId: clientId,
        sessionId: clientSession.id
      });

      this.emit("clientRegistered", {
        sessionId: clientSession.id,
        clientId: clientId,
        canisterId: userPrincipalId,
      } as ClientRegisteredEvent);
    } catch (error) {
      console.error(
        "❌ Registration failed:",
        (error as Error).message
      );
      this.sendJsonResponse(clientSession.ws, {
        success: false,
        error: "Registration failed: " + (error as Error).message
      });
    }
  }

  /**
   * Handle client messages after registration (simplified JSON-based)
   */
  private async handleClientMessage(
    clientSession: ClientSession,
    data: Buffer
  ): Promise<void> {
    try {
      console.log(`📩 Processing message from client ${clientSession.clientId}`);

      // Parse JSON message
      const textData = data.toString("utf8");
      const messageData = JSON.parse(textData);

      // Handle file upload message
      if (messageData.type === 'file_upload') {
        await this.fileHandler.handleFileUpload(clientSession, messageData as FileUploadWebSocketMessage);
        return;
      }

      // Check for message type to route to appropriate handler
      const messageType = messageData.text || messageData.type;
      
      // Define node-specific message types
      const nodeMessageTypes = [
        "PING", "INTERNET_SPEED_TEST", "SPEED_TEST", "HALO",
        "TWITTER_POST", "TWITTER_PROFILE", "TWITTER_FOLLOW_LIST", "HTML",
        "TWITTER_SCRAPE_RESULT", "HEARTBEAT", "CLIENT_STATUS", "JOB_REQUEST"
      ];
      
      // Route message to appropriate handler based on message type
      if (messageType && nodeMessageTypes.includes(messageType)) {
        // Handle node-specific messages
        await this.nodeHandler.processWebSocketMessage(clientSession, messageData);
      } else {
        // Handle RPC messages (Other application messages)
        await this.rpcHandler.processApplicationMessage(clientSession, messageData);
      }
      
    } catch (error) {
      console.error(
        "❌ Client message processing failed:",
        (error as Error).message
      );
      this.sendJsonResponse(clientSession.ws, {
        success: false,
        error: "Message processing failed: " + (error as Error).message
      });
    }
  }

  /**
   * Send JSON response to client
   */
  private sendJsonResponse(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        console.error("❌ JSON response send failed:", error);
      }
    }
  }







  /**
   * Find client session by client ID
   */
  private findClientSessionByClientId(clientId: string): ClientSession | undefined {
    for (const [sessionId, clientSession] of this.clients) {
      if (clientSession.clientId === clientId) {
        return clientSession;
      }
    }
    return undefined;
  }

  /**
   * Find client session by user principal ID
   */
  private findClientSessionByPrincipalId(userPrincipalId: string): ClientSession | undefined {
    for (const [sessionId, clientSession] of this.clients) {
      if (clientSession.userPrincipalId === userPrincipalId && clientSession.isRegistered) {
        return clientSession;
      }
    }
    return undefined;
  }

  /**
   * Send job to client via WebSocket
   */
  public async sendJobToClient(
    clientId: string,
    user_principal_id: string,
    url: string,
    scrapeType: string,
    jobId?: string,
    post_count: number = 0,
    replies_count: number = 0,
    scrollPauseTime: number = 0
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`🔍 Looking for client: clientId=${clientId}, principalId=${user_principal_id}`);
      console.log(`📊 Active sessions: ${this.clients.size}`);
      
      for (const [sessionId, session] of this.clients) {
        console.log(`  Session ${sessionId}: clientId=${session.clientId}, principalId=${session.userPrincipalId}, registered=${session.isRegistered}`);
      }
      
      let clientSession = this.findClientSessionByClientId(clientId);
      
      if (!clientSession) {
        console.log(`⚠️ Client not found by clientId ${clientId}, trying principalId ${user_principal_id}`);
        clientSession = this.findClientSessionByPrincipalId(user_principal_id);
      }
      
      if (!clientSession) {
        console.log(`❌ No client session found for clientId=${clientId} or principalId=${user_principal_id}`);
        
        const anyRegisteredClient = Array.from(this.clients.values()).find(session => 
          session.isRegistered && session.clientId !== null
        );
        
        if (anyRegisteredClient) {
          console.log(`🔄 Using fallback registered client: ${anyRegisteredClient.clientId}`);
          clientSession = anyRegisteredClient;
        } else {
          console.log(`❌ No registered clients available`);
          return { success: false, error: "No registered clients available for job assignment" };
        }
      }
      
      console.log(`✅ Found client session: ${clientSession.id} for clientId=${clientSession.clientId}`);
      
      if (!clientSession.isRegistered || !clientSession.clientId) {
        console.log(`❌ Client session ${clientSession.id} is not fully registered (registered=${clientSession.isRegistered}, clientId=${clientSession.clientId})`);
        return { success: false, error: "Client is not fully registered" };
      }
      
      return await this.nodeHandler.sendJobToClient(
        clientSession,
        user_principal_id,
        url,
        scrapeType,
        jobId,
        post_count,
        replies_count,
        scrollPauseTime
      );
    } catch (error) {
      console.error("❌ Failed to send job to client:", (error as Error).message);
      return { 
        success: false, 
        error: "Failed to send job to client: " + (error as Error).message 
      };
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    this.sendJsonResponse(ws, {
      success: false,
      error: errorMessage,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle client disconnect (similar to Rust GatewayServer::disconnected)
   */
  private async handleClientDisconnect(
    ws: WebSocket,
    code: number,
    reason: string
  ): Promise<void> {
    const sessionId = (ws as any).sessionId;

    if (sessionId && this.clients.has(sessionId)) {
      const clientSession = this.clients.get(sessionId)!;
      const sessionDuration = Date.now() - clientSession.connectedAt;

      console.log(
        `👋 Client disconnect: Session ${sessionId}, Client ${
          clientSession.clientId || "unregistered"
        }, session=${Math.round(sessionDuration / 1000)}s`
      );

      // Clean up session data
      if (clientSession.clientId) {
        try {
          // Remove session from Redis (using sessionId, not clientId)
          await this.sessionStore.removeSession(sessionId);

          // End WebSocket session using the stored session ID
          if (clientSession.wsSessionId) {
            await this.databaseService.wsEndSession(clientSession.wsSessionId);
          }

          console.log(
            `✅ Session cleanup complete: client ${clientSession.clientId}`
          );
        } catch (error) {
          console.error(
            "❌ Error during disconnect:",
            (error as Error).message
          );
        }
      }

      if (clientSession.clientId && clientSession.userPrincipalId) {
        await this.nodeHandler.cleanupNodeSession(clientSession, clientSession.userPrincipalId);
      }

      // Clean up uptime tracking session
      if (clientSession.userPrincipalId) {
        try {
          await this.uptimeTracker.finalizeUptimeSession(clientSession.userPrincipalId, 'CLIENT_DISCONNECT');
          console.log(`✅ Uptime session cleaned up for user: ${clientSession.userPrincipalId}`);
        } catch (error) {
          console.error(`❌ Failed to cleanup uptime session for user ${clientSession.userPrincipalId}:`, error);
        }
      }
      
      this.clients.delete(sessionId);



      this.emit("clientDisconnected", {
        sessionId,
        clientSession,
        code,
        reason,
      } as ClientDisconnectedEvent);
    }

    this.stats.activeConnections--;
  }

  /**
   * Start health check
   */
  private startHealthCheck(): void {
    setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds

    // Print statistics (every 60 seconds)
    setInterval(() => {
      this.printStats();
    }, 60000);
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const timeoutThreshold = 120000; // 2 minutes

    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeat > timeoutThreshold) {
        console.log(`💔 Client ${clientId} heartbeat timeout - disconnecting`);
        client.ws.close(1001, "Heartbeat timeout");
      }
    }
  }

  /**
   * Print server statistics
   */
  private printStats(): void {
    const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
    const connectedClients = Array.from(this.clients.values()).filter(
      (client) => client.ws.readyState === WebSocket.OPEN
    );

    console.log(`📊 Server statistics:`, {
      uptime: `${uptime}s`,
      totalConnections: this.stats.totalConnections,
      activeConnections: connectedClients.length,
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      rpcHandler: this.rpcHandler.getStats(),
      clients: connectedClients.map((client) => ({
        id: client.id,
        principal: client.userPrincipalId,
        connected: Math.round((Date.now() - client.connectedAt) / 1000) + "s",
      })),
    });
  }

  /**
   * Get server statistics
   */
  getServerStats(): any {
    const connectedClients = Array.from(this.clients.values()).filter(
      (client) => client.ws.readyState === WebSocket.OPEN
    );

    return {
      uptime: Date.now() - this.stats.startTime,
      totalConnections: this.stats.totalConnections,
      activeConnections: connectedClients.length,
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      clients: connectedClients.map((client) => ({
        id: client.id,
        userPrincipalId: client.userPrincipalId,
        connectedAt: new Date(client.connectedAt).toISOString(),
        lastHeartbeat: new Date(client.lastHeartbeat).toISOString(),
        messagesSent: client.messagesSent,
        messagesReceived: client.messagesReceived,
      })),
    };
  }

  /**
   * Stop server
   */
  async stop(): Promise<void> {
    if (this.wss) {
      console.log("🛑 Stopping server...");

      try {
        // Clean up connections
        for (const [sessionId, clientSession] of this.clients) {
          clientSession.ws.close(1001, "Server shutdown");
        }

        // Close Redis connection
        if (this.sessionStore) {
          await this.sessionStore.disconnect();
        }

        this.wss.close(() => {
          console.log("✅ WebSocket server stopped");
        });
      } catch (error) {
        console.error("❌ Error during server stop:", error);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.database.healthCheck();
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }

  getDatabase(): Database {
    return this.database;
  }

  getWebSocketServer(): WebSocket.Server | null {
    return this.wss;
  }

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }

  getSessionStore(): RedisSessionStore {
    return this.sessionStore;
  }

  getUptimeTracker(): UptimeTracker {
    return this.uptimeTracker;
  }

  getDatabaseService(): DatabaseService {
    return this.databaseService;
  }

  getRpcHandler(): RpcWebSocketHandler {
    return this.rpcHandler;
  }

  getNodeService(): NodeService {
    return this.nodeService;
  }

  getNodeHandler(): NodeWebSocketHandler {
    return this.nodeHandler;
  }

  /**
   * Broadcast message to all connected clients
   */
  public async broadcastToClients(message: ApplicationMessage): Promise<number> {
    return await this.nodeHandler.broadcastToClients(this.clients, message);
  }
}

// Create and start server instance
if (require.main === module) {
  const server = new SelaWebSocketServer({
    port: parseInt(process.env.PORT || "8082"),
    host: process.env.HOST || "localhost",
  });

  // Start server asynchronously
  (async () => {
    try {
      await server.start();
    } catch (error) {
      console.error("❌ Server start failed:", error);
      process.exit(1);
    }
  })();

  // Register event listeners
  server.on("clientRegistered", (client: ClientRegisteredEvent) => {
    console.log(`🎉 New client registered: ${client.clientId}`);
  });

  server.on(
    "speedTestReceived",
    ({ clientId, speedData }: SpeedTestReceivedEvent) => {
      console.log(
        `📈 Speed test: client ${clientId} - ${speedData.downloadSpeed}Mbps`
      );
    }
  );

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Received server shutdown signal...");
    await server.stop();
    setTimeout(() => process.exit(0), 2000);
  });

  process.on("SIGTERM", async () => {
    console.log("\n🛑 Received server shutdown signal...");
    await server.stop();
    setTimeout(() => process.exit(0), 2000);
  });
}
