import { WebSocket } from 'ws';
import { DatabaseService } from '../db/service';
import { Database } from '../db/database';
import { FileService } from '../services/file_service';
import { AuthService } from '../services/auth_service';
import { NodeService } from '../services/node_service';
import { UptimeTracker } from '../services/uptime_tracker';
import { 
  ClientSession, 
  ApplicationMessage
} from '../types';
import { EventEmitter } from 'events';
import { RPCErrorType, RPCStatus } from '../config/rpc_config';
import { ScrapeLogger } from '../utils/scrape_logger';

export class NodeWebSocketHandler extends EventEmitter {
  private databaseService: DatabaseService;
  private fileService: FileService;
  private authService: AuthService;
  private nodeService: NodeService;
  private uptimeTracker: UptimeTracker;

  constructor(database: Database, nodeService: NodeService) {
    super();
    this.databaseService = new DatabaseService(database);
    this.fileService = new FileService(database);
    this.authService = new AuthService(this.databaseService);
    this.nodeService = nodeService;
    this.uptimeTracker = new UptimeTracker(database);
  }

  /**
   * Process node-specific WebSocket message
   * Called by the main server when it receives a node-related message
   */
  async processWebSocketMessage(
    clientSession: ClientSession,
    messageData: any
  ): Promise<void> {
    try {
      const clientId = clientSession.clientId;
      if (!clientId) {
        throw new Error("Client ID not found in session");
      }

      // Extract message fields directly from JSON messageData
      const { text, data: msgData, user_principal_id, job_id } = messageData;

      if (!text || !user_principal_id) {
        throw new Error("Missing required fields in application message");
      }

      console.log(`📩 Node message from client ${clientId}: ${text}`);

      // Update uptime tracking for all WebSocket messages (heartbeat)
      if (clientSession.userPrincipalId) {
        await this.uptimeTracker.updateClientActivity(clientSession.userPrincipalId);
      }
      
      // Route message based on type
      await this.handleNodeMessage(clientSession, {
        text,
        data: msgData || '',
        user_principal_id,
        node_client_id: clientId,
        job_id: job_id || ''
      });

    } catch (error) {
      console.error("❌ Node WebSocket message processing failed:", (error as Error).message);
      this.sendError(clientSession.ws, "Node message processing failed: " + (error as Error).message);
    }
  }

  /**
   * Handle different types of node-specific WebSocket messages
   */
  private async handleNodeMessage(
    clientSession: ClientSession,
    appMessage: ApplicationMessage
  ): Promise<void> {
    const { text, data, user_principal_id, node_client_id, job_id, post_count, replies_count, scrollPauseTime } = appMessage;

    try {
      // Authenticate user
      const authResult = await this.authService.requestAuth(user_principal_id);
      if (!authResult) {
        throw new Error(`Authentication failed for user: ${user_principal_id}`);
      }

      let responseMessage = "";

      switch (text) {
        case "PING":
          responseMessage = await this.handlePingMessage(node_client_id!, user_principal_id);
          break;

        case "INTERNET_SPEED_TEST":
        case "SPEED_TEST":
          responseMessage = await this.handleSpeedTestMessage(user_principal_id, data);
          break;

        case "HALO":
          responseMessage = await this.handleHaloMessage(user_principal_id);
          break;

        case "TWITTER_POST":
        case "TWITTER_PROFILE":
        case "TWITTER_FOLLOW_LIST":
        case "HTML":
          responseMessage = await this.handleJobMessage(node_client_id!, text, data, job_id, post_count, replies_count, scrollPauseTime);
          break;

        case "TWITTER_SCRAPE_RESULT":
          responseMessage = await this.handleScrapeResultMessage(data, job_id || '', node_client_id!, user_principal_id);
          break;

        case "HEARTBEAT":
          responseMessage = await this.handleHeartbeatMessage(user_principal_id);
          break;

        case "CLIENT_STATUS":
          responseMessage = await this.handleClientStatusMessage(user_principal_id, data);
          break;

        case "JOB_REQUEST":
          responseMessage = await this.handleJobRequestMessage(user_principal_id);
          break;

        default:
          throw new Error("Unsupported node message type: " + text);
      }

      // Send response back to client
      await this.sendWebSocketResponse(clientSession, responseMessage);

    } catch (error) {
      console.error("❌ Node message handling failed:", (error as Error).message);
      const errorResponse = JSON.stringify({
        function: "Error",
        message: "Node message handling failed: " + (error as Error).message,
        status: "ERROR"
      });
      await this.sendWebSocketResponse(clientSession, errorResponse);
    }
  }

  /**
   * Handle PING message
   */
  private async handlePingMessage(clientId: string, userPrincipalId: string): Promise<string> {
    console.log("Client connect open (PING)");
    
    // Connect client via NodeService
    const connectResult = await this.nodeService.connectClient(userPrincipalId, clientId);
    if (!connectResult.success) {
      throw new Error("Failed to connect client: " + connectResult.error.message);
    }
    
    return JSON.stringify({
      function: "Notification",
      message: "Client connect open",
      user_principal_id: userPrincipalId,
      state: "Connected",
      status: "OK"
    });
  }

  /**
   * Handle speed test message
   */
  private async handleSpeedTestMessage(userPrincipalId: string, data: any): Promise<string> {
    console.log("Speed test data received:", data);
    
    try {
      // Parse speed test data
      let speed: number | undefined;
      let ping: number | undefined;
      
      if (typeof data === 'string') {
        try {
          const parsedData = JSON.parse(data);
          speed = parsedData.downloadSpeed || parsedData.speed;
          ping = parsedData.ping;
        } catch (parseError) {
          speed = parseFloat(data);
        }
      } else if (typeof data === 'object' && data !== null) {
        speed = data.downloadSpeed || data.speed;
        ping = data.ping;
      } else {
        speed = parseFloat(String(data));
      }
      
      // Update uptime tracking with speed and ping data
      if (speed !== undefined || ping !== undefined) {
        await this.uptimeTracker.updateClientActivity(userPrincipalId, speed, ping);
      }
      
      const speedResult = await this.nodeService.updateClientInternetSpeed(userPrincipalId, JSON.stringify(data));
      if (!speedResult.success) {
        throw new Error("Failed to update speed: " + speedResult.error.message);
      }
      
      return JSON.stringify({
        function: "SpeedTestComplete",
        message: "Speed test data updated",
        status: "OK"
      });
    } catch (error) {
      console.error("❌ Speed test handling failed:", error);
      throw new Error("Failed to process speed test data: " + (error as Error).message);
    }
  }

  /**
   * Handle HALO message
   */
  private async handleHaloMessage(userPrincipalId: string): Promise<string> {
    console.log("Received HALO message");
    
    return JSON.stringify({
      function: "Notification",
      message: "HALO received",
      user_principal_id: userPrincipalId,
      status: "OK",
      data: "Sending message to client - HALO HALO"
    });
  }

  /**
   * Handle job-related messages
   */
  private async handleJobMessage(clientId: string, messageType: string, url: string, jobId?: string, post_count?: number, replies_count?: number, scrollPauseTime?: number): Promise<string> {
    console.log(`📤 Sending job to client ${clientId}: ${messageType} with jobId: ${jobId || 'empty'}, post_count: ${post_count || 0}, replies_count: ${replies_count || 0}, scrollPauseTime: ${scrollPauseTime || 0}`);
    
    return JSON.stringify({
      function: "TWITTER_SCRAPE",
      type: messageType,
      url: url,
      job_id: jobId || '',
      message: "Sending job to client",
      client_id: clientId,
      post_count: post_count || 0,
      replies_count: replies_count || 0,
      scrollPauseTime: scrollPauseTime || 0,
      status: "OK"
    });
  }

  /**
   * Handle scrape result message
   */
  private async handleScrapeResultMessage(data: string, job_Id: string, clientId: string, user_principal_id?: string): Promise<string> {
    const messageReceivedAt = Date.now();
    ScrapeLogger.logMessageReceived(job_Id, clientId);
    console.log("Client sending message - update job status");
    
    try {
      let jobResultData: any;
      try {
        jobResultData = JSON.parse(data);
      } catch (parseError) {
        jobResultData = { result: data, timestamp: Date.now() };
      }

      const jobId = job_Id || `job_${Date.now()}`;
      ScrapeLogger.logMessageParsed(jobId);
      
      let storedFileId = null;
      
      // ✅ Validate scrape results - check for empty results
      let fileContent = null;
      let hasEmptyResults = false;
      
      if (Array.isArray(jobResultData)) {
        if (jobResultData.length === 0) {
          hasEmptyResults = true;
          console.log(`⚠️ Scraping returned empty array for job ${jobId}`);
        } else {
          fileContent = jobResultData;
          console.log(`💾 Found array data with ${jobResultData.length} items for job ${jobId}`);
        }
      } else if (jobResultData.content || jobResultData.result) {
        const content = jobResultData.content || jobResultData.result;
        
        // Check if content is an empty array
        if (Array.isArray(content) && content.length === 0) {
          hasEmptyResults = true;
          console.log(`⚠️ Scraping returned empty array in content for job ${jobId}`);
        } else {
          fileContent = content;
          console.log(`💾 Found object data with content for job ${jobId}`);
        }
      } else {
        hasEmptyResults = true;
        console.log(`⚠️ No valid content found in jobResultData for job ${jobId}`);
      }

      // ✅ Handle empty results as error
      if (hasEmptyResults) {
        console.error(`❌ Job ${jobId} failed: Scraping returned empty results`);
        
        // Mark job as failed and remove from client
        const failureResult = await this.nodeService.markJobAsFailed(jobId, clientId.toString(), "Scraping returned empty results - no data found");
        
        // Emit job completion error event
        this.emit('jobCompleted', {
          jobId: jobId,
          result: null,
          error: new Error("Scraping returned empty results - no data found")
        });
        
        return JSON.stringify({
          function: "JobFailed",
          message: "Scraping returned empty results - no data found",
          status: RPCStatus.ERROR,
          errorType: RPCErrorType.NO_DATA_FOUND,
          timestamp: Date.now(),
          jobId: jobId
        });
      }
      
      if (fileContent) {

        try {
          const fileStorageStartTime = Date.now();
          ScrapeLogger.logFileStorageStart(jobId);
          
          const fileResult = await this.fileService.createFileFromJobResult({
            jobId: jobId,
            content: fileContent,
            userPrincipalId: user_principal_id // Pass the worker's principal ID
          });

          const fileStorageEndTime = Date.now();
          const fileStorageDuration = fileStorageEndTime - fileStorageStartTime;
          ScrapeLogger.logFileStorageDuration(jobId, fileStorageDuration);

          if (fileResult.success) {
            storedFileId = fileResult.data.id;
            console.log(`✅ Successfully stored scrape result in file: ${fileResult.data.id} at path: ${fileResult.data.file_path}, storedId: ${storedFileId}`);
          } else {
            console.error(`❌ Failed to store scrape result: ${fileResult.error.message}`);
            console.error(`❌ File storage error details:`, fileResult.error);
          }
        } catch (fileError) {
          console.error(`❌ Exception during file storage:`, fileError);
          console.error(`❌ File error stack:`, (fileError as Error).stack);
        }
      } else {
        console.log(`⚠️ No content found in jobResultData for job ${jobId}`);
        console.log(`⚠️ jobResultData type: ${Array.isArray(jobResultData) ? 'array' : 'object'}`);
        if (Array.isArray(jobResultData)) {
          console.log(`⚠️ Array length: ${jobResultData.length}`);
        } else {
          console.log(`⚠️ jobResultData keys:`, Object.keys(jobResultData));
        }
        console.log(`⚠️ jobResultData:`, jobResultData);
      }

      // Update job completion via NodeService
      const updateStartTime = Date.now();
      ScrapeLogger.logJobUpdateStart(jobId, clientId, storedFileId);
      const updateResult = await this.nodeService.updateJobCompleted(jobId, clientId.toString(), storedFileId);
      const updateEndTime = Date.now();
      const updateDuration = updateEndTime - updateStartTime;
      ScrapeLogger.logJobUpdateDuration(jobId, updateDuration);
      
      if (!updateResult.success) {
        console.error(`❌ Job update failed: jobId=${jobId}, clientId=${clientId}, error=${updateResult.error.message}`);
        
        // Emit job completion error event
        this.emit('jobCompleted', {
          jobId: jobId,
          result: null,
          error: new Error("Failed to update job: " + updateResult.error.message)
        });
        
        throw new Error("Failed to update job: " + updateResult.error.message);
      }

        ScrapeLogger.logEventEmission(jobId);
        this.emit('jobCompleted', {
          jobId: jobId,
          result: {
            jobId: jobId,
            clientId: clientId,
            content: fileContent || jobResultData,
            storedFileId: storedFileId,
            timestamp: Date.now()
          },
          error: null
        });

      ScrapeLogger.logEventEmitted(jobId);

      const totalProcessingTime = Date.now() - messageReceivedAt;
      ScrapeLogger.logTotalProcessingTime(jobId, totalProcessingTime);

      return JSON.stringify({
        function: "JobComplete",
        message: "Job completed and result stored successfully",
        status: RPCStatus.OK,
        timestamp: Date.now(),
        reward: updateResult.data.reward,
        jobId: jobId
      });
    } catch (error) {
      console.error(`❌ Error processing scrape result:`, error);
      
      // Emit job completion error event
      this.emit('jobCompleted', {
        jobId: job_Id,
        result: null,
        error: error
      });
      
      return JSON.stringify({
        function: "Error",
        message: "Error processing scrape result: " + (error as Error).message,
        status: RPCStatus.ERROR,
        errorType: RPCErrorType.INTERNAL_SERVER_ERROR
      });
    }
  }

  /**
   * Handle heartbeat message
   */
  private async handleHeartbeatMessage(userPrincipalId: string): Promise<string> {
    console.log("Heartbeat received from client");
    
    const heartbeatResult = await this.nodeService.updateHeartbeat(userPrincipalId);
    if (!heartbeatResult.success) {
      throw new Error("Failed to update heartbeat: " + heartbeatResult.error.message);
    }
    
    return JSON.stringify({
      function: "HeartbeatAck",
      message: "Heartbeat acknowledged",
      timestamp: Date.now(),
      status: "OK"
    });
  }

  /**
   * Handle client status message
   */
  private async handleClientStatusMessage(userPrincipalId: string, data: string): Promise<string> {
    console.log("Client status update received");
    
    try {
      const statusData = JSON.parse(data);
      
      const updateResult = await this.nodeService.updateClientStatus(userPrincipalId, {
        isActive: statusData.isActive,
        timestamp: Date.now()
      });

      if (!updateResult.success) {
        throw new Error("Failed to update status: " + updateResult.error.message);
      }

      return JSON.stringify({
        function: "ClientStatusUpdate",
        message: "Client status updated successfully",
        status: "OK"
      });
    } catch (error) {
      return JSON.stringify({
        function: "Error",
        message: "Invalid status data format",
        status: "ERROR"
      });
    }
  }

  /**
   * Handle job request message
   */
  private async handleJobRequestMessage(userPrincipalId: string): Promise<string> {
    console.log("Job request received from client");
    
    try {
      const jobResult = await this.nodeService.findAndAssignJob(userPrincipalId);
      
      if (jobResult.success && jobResult.data) {
        return JSON.stringify({
          function: "JobAssigned",
          message: "Job assigned successfully",
          jobData: jobResult.data,
          status: RPCStatus.OK,
          timestamp: Date.now()
        });
      } else {
        return JSON.stringify({
          function: "NoJobsAvailable",
          message: "No jobs available at the moment",
          status: RPCStatus.OK,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(`Error handling job request:`, error);
      return JSON.stringify({
        function: "Error",
        message: "Error processing job request: " + (error as Error).message,
        status: RPCStatus.ERROR,
        errorType: RPCErrorType.INTERNAL_SERVER_ERROR
      });
    }
  }

  /**
   * Send WebSocket response back to client
   */
  private async sendWebSocketResponse(
    clientSession: ClientSession,
    responseMessage: string
  ): Promise<void> {
    try {
      if (clientSession.ws.readyState === WebSocket.OPEN) {
        clientSession.ws.send(responseMessage);
        clientSession.messagesSent++;
        
        console.log(`✅ Response sent to client ${clientSession.clientId}`);
      }
    } catch (error) {
      console.error("❌ Failed to send WebSocket response:", (error as Error).message);
    }
  }

  /**
   * Send error message to client
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const errorResponse = JSON.stringify({
          success: false,
          error: errorMessage,
          timestamp: Date.now(),
        });
        ws.send(errorResponse);
      } catch (error) {
        console.error("❌ Error message send failed:", error);
      }
    }
  }

  /**
   * Send job to client via WebSocket (called from main server)
   */
  public async sendJobToClient(
    clientSession: ClientSession,
    userPrincipalId: string,
    url: string,
    scrapeType: string,
    jobId?: string,
    post_count: number = 0,
    replies_count: number = 0,
    scrollPauseTime: number = 0
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      if (!clientSession.clientId) {
        return { success: false, error: "Client session has no client ID" };
      }

      console.log(`🔄 NodeHandler.sendJobToClient called with jobId: ${jobId || 'undefined'}`);

      const jobMessage = {
        text: scrapeType,
        data: url,
        user_principal_id: userPrincipalId,
        node_client_id: clientSession.clientId,
        job_id: jobId || '',
        post_count,
        replies_count,
        scrollPauseTime
      };

      console.log(`📋 Job message created:`, jobMessage);
      await this.handleNodeMessage(clientSession, jobMessage);

      return { 
        success: true, 
        message: JSON.stringify({
          function: "JobSent",
          message: "Job sent to client successfully",
          status: "OK"
        })
      };
    } catch (error) {
      console.error("❌ Failed to send job to client:", (error as Error).message);
      return { 
        success: false, 
        error: "Failed to send job to client: " + (error as Error).message 
      };
    }
  }

  /**
   * Broadcast message to all connected clients (called from main server)
   */
  public async broadcastToClients(
    clientSessions: Map<number, ClientSession>,
    message: ApplicationMessage
  ): Promise<number> {
    let successCount = 0;
    
    for (const [sessionId, clientSession] of clientSessions) {
      if (clientSession.ws.readyState === WebSocket.OPEN && 
          clientSession.isRegistered && 
          clientSession.clientId !== null) {
        try {
          await this.handleNodeMessage(clientSession, message);
          successCount++;
        } catch (error) {
          console.error(`❌ Failed to send message to client ${clientSession.clientId}:`, error);
        }
      }
    }
    
    console.log(`📡 Broadcasted message to ${successCount} clients`);
    return successCount;
  }

  /**
   * Check if a message is node-specific
   */
  public static isNodeMessage(messageType: string): boolean {
    const nodeMessageTypes = [
      "PING",
      "INTERNET_SPEED_TEST", 
      "SPEED_TEST",
      "HALO",
      "TWITTER_POST",
      "TWITTER_PROFILE", 
      "TWITTER_FOLLOW_LIST",
      "HTML",
      "TWITTER_SCRAPE_RESULT",
      "HEARTBEAT",
      "CLIENT_STATUS",
      "JOB_REQUEST"
    ];
    
    return nodeMessageTypes.includes(messageType);
  }

  /**
   * Handle node-specific session initialization
   * Called when a client connects and identifies as a node client
   */
  public async initializeNodeSession(
    clientSession: ClientSession,
    userPrincipalId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!clientSession.clientId) {
        return { success: false, error: "Client session has no client ID" };
      }

      // Create WebSocket session for uptime tracking
      const sessionResult = await this.nodeService.createWebSocketSession(userPrincipalId, clientSession.clientId);
      if (sessionResult.success) {
        console.log(`Created WebSocket session: ${sessionResult.data} for client: ${clientSession.clientId}`);
      }

      // Mark session as node-specific
      (clientSession as any).isNodeClient = true;
      
      console.log(`✅ Node session initialized for client: ${clientSession.clientId}, user: ${userPrincipalId}`);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Node session initialization failed:', error);
      return { success: false, error: `Node session initialization failed: ${error}` };
    }
  }

  /**
   * Handle node-specific session cleanup
   * Called when a node client disconnects
   */
  public async cleanupNodeSession(
    clientSession: ClientSession,
    userPrincipalId: string
  ): Promise<void> {
    try {
      // End WebSocket session for uptime tracking
      await this.nodeService.endWebSocketSession(userPrincipalId);
      console.log(`Ended WebSocket session for user: ${userPrincipalId}`);
      
      console.log(`🚪 Node session cleaned up for client: ${clientSession.clientId}`);
    } catch (error) {
      console.error('❌ Node session cleanup failed:', error);
    }
  }

  /**
   * Get handler statistics
   */
  public getStats(): {
    name: string;
    supportedMessageTypes: string[];
    features: string[];
  } {
    return {
      name: "Node WebSocket Handler (Refactored)",
      supportedMessageTypes: [
        "PING",
        "INTERNET_SPEED_TEST",
        "SPEED_TEST", 
        "HALO",
        "TWITTER_POST",
        "TWITTER_PROFILE",
        "TWITTER_FOLLOW_LIST",
        "HTML",
        "TWITTER_SCRAPE_RESULT",
        "HEARTBEAT",
        "CLIENT_STATUS",
        "JOB_REQUEST"
      ],
      features: [
        "Node-specific message processing",
        "Job assignment and result handling", 
        "Real-time communication",
        "Session initialization and cleanup",
        "Unified connection management integration"
      ]
    };
  }
}
