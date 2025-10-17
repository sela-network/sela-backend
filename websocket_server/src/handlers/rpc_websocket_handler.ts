import { WebSocket } from 'ws';
import * as cbor from 'cbor';
import { DatabaseService } from '../db/service';
import { Database } from '../db/database';
import { FileService } from '../services/file_service';
import { AuthService } from '../services/auth_service';
import { NodeService } from '../services/node_service';
import { UptimeTracker } from '../services/uptime_tracker';
import { 
  ClientSession, 
  ApplicationMessage, 
  SpeedTestReceivedEvent 
} from '../types';
import { EventEmitter } from 'events';
import { RPCErrorType, RPCStatus } from '../config/rpc_config';

export class RpcWebSocketHandler extends EventEmitter {
  private databaseService: DatabaseService;
  private fileService: FileService;
  private authService: AuthService;
  private nodeService: NodeService;
  private uptimeTracker: UptimeTracker;

  constructor(database: Database) {
    super();
    this.databaseService = new DatabaseService(database);
    this.fileService = new FileService(database);
    this.authService = new AuthService(this.databaseService);
    this.nodeService = new NodeService(this.databaseService, this.fileService);
    this.uptimeTracker = new UptimeTracker(database);
  }

  /**
   * Process application message from WebSocket
   */
  async processApplicationMessage(
    clientSession: ClientSession,
    messageData: any
  ): Promise<void> {
    try {
      // Decode the val field to get the actual application message
      let appMessage: any;
      try {
        appMessage = cbor.decode(messageData.val);
      } catch (decodeError) {
        throw new Error("Invalid application message format");
      }

      // Handle nested CBOR tag structure
      if (appMessage.tag === 55799 && appMessage.value) {
        appMessage = appMessage.value;
      }

      const { text, data: msgData, user_principal_id, node_client_id } = appMessage;

      if (!text || !user_principal_id) {
        throw new Error("Missing required fields in application message");
      }

      console.log(`📩 Application message from client ${clientSession.clientId}: ${text}`);

      // Route message based on type
      await this.handleApplicationMessage(clientSession, {
        text,
        data: msgData || '',
        user_principal_id,
        node_client_id: node_client_id || "0"
      });

    } catch (error) {
      console.error("❌ Application message processing failed:", (error as Error).message);
      this.sendError(clientSession.ws, "Application message processing failed: " + (error as Error).message);
    }
  }

  /**
   * Handle different types of application messages
   */
  async handleApplicationMessage(
    clientSession: ClientSession,
    appMessage: ApplicationMessage
  ): Promise<void> {
    const { text, data, user_principal_id, node_client_id } = appMessage;

    try {
      const authResult = await this.authService.requestAuth(user_principal_id);
      if (!authResult) {
        throw new Error(`Authentication failed for user: ${user_principal_id}`);
      }

      let responseMessage = "";

      switch (text) {
        case "PING":
          responseMessage = await this.handlePingMessage(clientSession, user_principal_id);
          break;

        case "TWITTER_POST":
        case "TWITTER_PROFILE":
        case "TWITTER_FOLLOW_LIST":
        case "HTML":
          responseMessage = await this.handleJobMessage(clientSession, text, data);
          break;

        case "TWITTER_SCRAPE_RESULT":
          responseMessage = await this.handleScrapeResultMessage(data, node_client_id);
          break;

        case "SPEED_TEST":
          responseMessage = await this.handleSpeedTestMessage(clientSession, user_principal_id, data);
          break;

        case "CLIENT_STATUS":
          responseMessage = await this.handleClientStatusMessage(user_principal_id, data);
          break;

        case "JOB_REQUEST":
          responseMessage = await this.handleJobRequestMessage(user_principal_id);
          break;

        case "HEARTBEAT":
          responseMessage = await this.handleHeartbeatMessage(user_principal_id);
          break;

        default:
          throw new Error("Unsupported message type: " + text);
      }

      // Send response back to client
      await this.sendApplicationResponse(clientSession, responseMessage);

    } catch (error) {
      console.error("❌ Application message handling failed:", (error as Error).message);
      const errorResponse = JSON.stringify({
        function: "Error",
        message: "Message handling failed: " + (error as Error).message,
        status: "ERROR"
      });
      await this.sendApplicationResponse(clientSession, errorResponse);
    }
  }

  /**
   * Handle PING message
   */
  private async handlePingMessage(
    clientSession: ClientSession,
    user_principal_id: string
  ): Promise<string> {
    console.log("Client connect open");
    
    // Update client heartbeat
    await this.databaseService.wsUpdateHeartbeat(user_principal_id);
    
    return JSON.stringify({
      function: "Notification",
      message: "Client connect open",
      user_principal_id: user_principal_id,
      state: "Connected",
      status: "OK"
    });
  }

  /**
   * Handle job-related messages (Twitter scraping, HTML, etc.)
   */
  private async handleJobMessage(
    clientSession: ClientSession,
    messageType: string,
    url: string
  ): Promise<string> {
    console.log("Sending message to client - new job available");
    
    return JSON.stringify({
      function: "TWITTER_SCRAPE",
      type: messageType,
      url: url,
      message: "Sending job to client",
      client_id: clientSession.clientId,
      status: "OK"
    });
  }

  /**
   * Handle scrape result message
   */
  private async handleScrapeResultMessage(
    data: string,
    node_client_id: string
  ): Promise<string> {
    console.log("Client sending message - update job status");
    
    try {
      let jobResultData: any;
      try {
        jobResultData = JSON.parse(data);
      } catch (parseError) {
        jobResultData = { result: data, timestamp: Date.now() };
      }

      const jobId = jobResultData.jobId || data; 
                console.log(`🔄 Updating job completion: jobId: ${jobId}, clientId: ${node_client_id}`);

      if (jobResultData.content || jobResultData.result) {
        const fileContent = jobResultData.content || jobResultData.result;
        const fileResult = await this.fileService.createFileFromJobResult({
          jobId: jobId,
          content: fileContent
        });

        if (fileResult.success) {
          console.log(`Stored scrape result in file: ${fileResult.data.id}`);
        } else {
          console.error(`Failed to store scrape result: ${fileResult.error.message}`);
        }
      }

      const updateResult = await this.databaseService.updateJobCompleted(
        jobId,
        node_client_id
      );

      if (updateResult.success) {
        return JSON.stringify({
          function: "JobComplete",
          message: "Job completed and result stored successfully",
          status: RPCStatus.OK,
          timestamp: Date.now(),
          reward: updateResult.data.reward,
          jobId: jobId
        });
      } else {
        return JSON.stringify({
          function: "Error",
          message: "Error updating job: " + updateResult.error.message,
          status: RPCStatus.ERROR,
          errorType: RPCErrorType.JOB_NOT_FOUND
        });
      }
    } catch (error) {
      console.error(`❌ Error processing scrape result:`, error);
      return JSON.stringify({
        function: "Error",
        message: "Error processing scrape result: " + (error as Error).message,
        status: RPCStatus.ERROR,
        errorType: RPCErrorType.INTERNAL_SERVER_ERROR
      });
    }
  }

  /**
   * Handle speed test message
   */
  private async handleSpeedTestMessage(
    clientSession: ClientSession,
    user_principal_id: string,
    data: any
  ): Promise<string> {
    console.log("Speed test data received:", data);
    
    try {
      // Parse speed test data for uptime tracking
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
        await this.uptimeTracker.updateClientActivity(user_principal_id, speed, ping);
      }
      
      // Ensure data is in the right format for the service
      let speedDataString: string;
      let speedData: any;
      
      if (typeof data === 'string') {
        // If data is already a string, use it directly
        speedDataString = data;
        try {
          speedData = JSON.parse(data);
        } catch (parseError) {
          speedData = { downloadSpeed: data };
        }
      } else if (typeof data === 'object' && data !== null) {
        // If data is an object, stringify it
        speedDataString = JSON.stringify(data);
        speedData = data;
      } else {
        // Fallback: convert to string
        speedDataString = String(data);
        speedData = { downloadSpeed: data };
      }
      
      console.log("Sending speed data to service:", speedDataString);
      
      const speedResult = await this.databaseService.updateClientInternetSpeed(
        user_principal_id,
        speedDataString
      );

      if (speedResult.success) {
        // Emit speed test event
        this.emit("speedTestReceived", {
          clientId: clientSession.clientId,
          speedData: speedData
        } as SpeedTestReceivedEvent);

        return JSON.stringify({
          function: "SpeedTestComplete",
          message: "Speed test data updated",
          status: "OK"
        });
      } else {
        return JSON.stringify({
          function: "Error",
          message: "Error: " + speedResult.error.message,
          status: "ERROR"
        });
      }
    } catch (error) {
      console.error("❌ Speed test handling failed:", error);
      return JSON.stringify({
        function: "Error",
        message: "Failed to process speed test data: " + (error as Error).message,
        status: "ERROR"
      });
    }
  }

  /**
   * Handle client status update message
   */
  private async handleClientStatusMessage(
    user_principal_id: string,
    data: string
  ): Promise<string> {
    console.log("Client status update received");
    
    try {
      const statusData = JSON.parse(data);
      
      // Update client status in database
      const updateResult = await this.databaseService.updateClient(user_principal_id, {
        clientStatus: statusData.isActive ? 'Active' : 'Inactive',
        pingTimestamp: Date.now()
      });

      if (updateResult.success) {
        return JSON.stringify({
          function: "ClientStatusUpdate",
          message: "Client status updated successfully",
          status: "OK"
        });
      } else {
        return JSON.stringify({
          function: "Error",
          message: "Error: " + updateResult.error.message,
          status: "ERROR"
        });
      }
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
  private async handleJobRequestMessage(user_principal_id: string): Promise<string> {
    console.log("Job request received from client");
    
    try {
      console.log(`🔄 Finding and assigning job for user: ${user_principal_id}`);
      
      const jobResult = await this.nodeService.findAndAssignJob(user_principal_id);
      
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
   * Handle heartbeat message
   */
  private async handleHeartbeatMessage(user_principal_id: string): Promise<string> {
    console.log("Heartbeat received from client");
    
    const heartbeatResult = await this.databaseService.wsUpdateHeartbeat(user_principal_id);
    
    if (heartbeatResult.success) {
      return JSON.stringify({
        function: "HeartbeatAck",
        message: "Heartbeat acknowledged",
        timestamp: Date.now(),
        status: "OK"
      });
    } else {
      return JSON.stringify({
        function: "Error",
        message: "Failed to update heartbeat",
        status: "ERROR"
      });
    }
  }

  /**
   * Send application response back to client
   */
  private async sendApplicationResponse(
    clientSession: ClientSession,
    responseMessage: string
  ): Promise<void> {
    try {
      const responseData = {
        data: responseMessage
      };

      const encodedResponse = cbor.encode(responseData);
      
      if (clientSession.ws.readyState === WebSocket.OPEN) {
        clientSession.ws.send(encodedResponse);
        clientSession.messagesSent++;
        
        console.log(`✅ Response sent to client ${clientSession.clientId}`);
      }
    } catch (error) {
      console.error("❌ Failed to send application response:", (error as Error).message);
    }
  }

  /**
   * Send error message to client
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const errorResponse = cbor.encode({
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
   * Send job to client via WebSocket
   */
  public async sendJobToClient(
    clientSession: ClientSession,
    user_principal_id: string,
    url: string,
    scrapeType: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const jobMessage = {
        text: scrapeType,
        data: url,
        user_principal_id: user_principal_id,
        node_client_id: clientSession.clientId || "0"
      };

      // Send job message to client
      await this.handleApplicationMessage(clientSession, jobMessage);

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
   * Broadcast message to all connected clients
   */
  public async broadcastToClients(
    clientSessions: Map<number, ClientSession>,
    message: ApplicationMessage
  ): Promise<number> {
    let successCount = 0;
    
    for (const [sessionId, clientSession] of clientSessions) {
      if (clientSession.ws.readyState === WebSocket.OPEN && clientSession.isRegistered) {
        try {
          await this.handleApplicationMessage(clientSession, message);
          successCount++;
        } catch (error) {
          console.error(`❌ Failed to send message to client ${sessionId}:`, error);
        }
      }
    }
    
    console.log(`📡 Broadcasted message to ${successCount} clients`);
    return successCount;
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
      name: "RPC WebSocket Handler",
      supportedMessageTypes: [
        "PING",
        "TWITTER_POST",
        "TWITTER_PROFILE", 
        "TWITTER_FOLLOW_LIST",
        "HTML",
        "TWITTER_SCRAPE_RESULT",
        "SPEED_TEST",
        "CLIENT_STATUS",
        "JOB_REQUEST",
        "HEARTBEAT"
      ],
      features: [
        "Job assignment and management",
        "Speed test data collection",
        "Client status tracking",
        "Heartbeat monitoring",
        "Message broadcasting"
      ]
    };
  }
}
