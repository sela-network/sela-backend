import express from 'express';
import { createServer } from 'http';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { SelaWebSocketServer } from './server';
import { ServerOptions } from './types';
import { createAPIRouter } from './api';
import { Database } from './db/database';
import { RewardDistributionService } from './services/reward_distribution_service';
import { BlockchainService } from './services/blockchain_service';
import { ReferralService } from './services/referral_service';
import { ReferralDistributionService } from './services/referral_distribution_service';
import { JobTimeoutMonitor } from './services/job_timeout_monitor';
import { EMBEDDED_SWAGGER_UI, EMBEDDED_SWAGGER_YAML } from './swagger_content';

export class HybridServer extends SelaWebSocketServer {
  private httpServer: any;
  private expressApp: express.Application;
  private rewardDistributionService: RewardDistributionService;
  private blockchainService: BlockchainService;
  private referralService: ReferralService;
  private referralDistributionService: ReferralDistributionService;
  private jobTimeoutMonitor: JobTimeoutMonitor;

  constructor(options: ServerOptions = {}) {
    super(options);
    
    this.expressApp = express();
    
    this.blockchainService = new BlockchainService();
    
    this.referralService = new ReferralService(this.getDatabase(), this.blockchainService);
    console.log('✅ ReferralService initialized with blockchain support');
    
    // Initialize referral distribution service
    this.referralDistributionService = new ReferralDistributionService(
      this.getDatabase(),
      this.referralService
    );
    console.log('✅ ReferralDistributionService initialized');
    
    this.rewardDistributionService = new RewardDistributionService(
      this.getDatabase(),
      this.blockchainService,
      this.getUptimeTracker()
    );
    
    this.jobTimeoutMonitor = new JobTimeoutMonitor(this.getDatabase());
    
    // Setup Express middleware and routes AFTER all services are initialized
    this.setupExpressMiddleware();
  }

  private setupExpressMiddleware(): void {
    this.expressApp.use(express.json({ limit: '100mb' }));
    this.expressApp.use(express.urlencoded({ extended: true, limit: '100mb' }));

    // Add JSON parsing error handler middleware
    this.expressApp.use((error: any, req: any, res: any, next: any) => {
      if (error instanceof SyntaxError && (error as any).status === 400 && 'body' in error) {
        console.error('JSON parsing error:', error.message);
        console.error('Request body:', error.body);
        
        // Check for common JSON syntax errors
        let errorMessage = 'Invalid JSON format';
        if (error.message.includes('Unexpected token }')) {
          errorMessage = 'JSON syntax error: Check for trailing commas or missing quotes';
        } else if (error.message.includes('Unexpected end of JSON input')) {
          errorMessage = 'JSON syntax error: Incomplete JSON data';
        } else if (error.message.includes('Unexpected token')) {
          errorMessage = 'JSON syntax error: Invalid character or structure';
        }
        
        return res.status(400).json({
          success: false,
          error: 'JSON_PARSE_ERROR',
          message: errorMessage,
          details: error.message,
          position: error.message.match(/position (\d+)/)?.[1] || 'unknown'
        });
      }
      return next(error);
    });

    this.expressApp.use((req, res, next) => {
      res.setTimeout(3600000); // 1 hour - allows long-running scrape jobs
      next();
    });

    this.expressApp.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-principal-id');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    this.expressApp.use((req, res, next) => {
      console.log(`🌐 ${req.method} ${req.path} - ${new Date().toISOString()}`);
      next();
    });

    this.expressApp.get('/health', (req, res) => {
      const healthData = { 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'Sela Network Hybrid Server'
      };
      res.json({ 
        success: true,
        message: 'Server is healthy',
        data: healthData
      });
    });

    // Debug endpoint to list files in the container
    this.expressApp.get('/debug/files', (req, res) => {
      try {
        const cwd = process.cwd();
        const dirname = __dirname;
        const files = fs.readdirSync(cwd);
        const swaggerFiles = files.filter(f => f.includes('swagger'));
        
        res.json({
          success: true,
          data: {
            cwd,
            dirname,
            allFiles: files,
            swaggerFiles,
            swaggerUiExists: fs.existsSync(path.join(cwd, 'swagger-ui.html')),
            swaggerYamlExists: fs.existsSync(path.join(cwd, 'swagger.yaml'))
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Error listing files',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Serve Swagger UI
    this.expressApp.get('/api/docs', (req, res) => {
      // Debug: Log current working directory and __dirname
      console.log(`🔍 Debug - process.cwd(): ${process.cwd()}`);
      console.log(`🔍 Debug - __dirname: ${__dirname}`);
      
      // Try multiple possible paths for the Swagger UI file
      const possiblePaths = [
        path.join(process.cwd(), 'swagger-ui.html'),
        path.join(__dirname, '../../swagger-ui.html'),
        path.join(__dirname, '../swagger-ui.html'),
        path.join(__dirname, 'swagger-ui.html'),
        '/app/swagger-ui.html'  // Docker container path
      ];
      
      // Debug: Check each path
      console.log(`🔍 Debug - Checking paths:`);
      possiblePaths.forEach((p, i) => {
        const exists = fs.existsSync(p);
        console.log(`  ${i + 1}. ${p} - ${exists ? 'EXISTS' : 'NOT FOUND'}`);
      });
      
      let swaggerUiPath = null;
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          swaggerUiPath = possiblePath;
          break;
        }
      }
      
      if (swaggerUiPath) {
        console.log(`📄 Serving Swagger UI from: ${swaggerUiPath}`);
        res.sendFile(swaggerUiPath);
      } else {
        console.error(`❌ Swagger UI not found. Tried paths:`, possiblePaths);
        
        // Fallback: Serve embedded Swagger UI
        console.log(`📄 Serving embedded Swagger UI as fallback`);
        res.setHeader('Content-Type', 'text/html');
        res.send(EMBEDDED_SWAGGER_UI);
      }
    });

    // Serve Swagger YAML
    this.expressApp.get('/swagger.yaml', (req, res) => {
      // Try multiple possible paths for the Swagger YAML file
      const possiblePaths = [
        path.join(process.cwd(), 'swagger.yaml'),
        path.join(__dirname, '../../swagger.yaml'),
        path.join(__dirname, '../swagger.yaml'),
        path.join(__dirname, 'swagger.yaml'),
        '/app/swagger.yaml'  // Docker container path
      ];
      
      let swaggerYamlPath = null;
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          swaggerYamlPath = possiblePath;
          break;
        }
      }
      
      if (swaggerYamlPath) {
        console.log(`📄 Serving Swagger YAML from: ${swaggerYamlPath}`);
        res.setHeader('Content-Type', 'application/x-yaml');
        res.sendFile(swaggerYamlPath);
      } else {
        console.error(`❌ Swagger YAML not found. Tried paths:`, possiblePaths);
        
        // Fallback: Serve embedded Swagger YAML
        console.log(`📄 Serving embedded Swagger YAML as fallback`);
        res.setHeader('Content-Type', 'application/x-yaml');
        res.send(EMBEDDED_SWAGGER_YAML);
      }
    });

    // Pass referralService to API router
    const apiRouter = createAPIRouter(this.getDatabase(), this);
    // Add referralService to the router context
    (apiRouter as any).referralService = this.referralService;
    this.expressApp.use('/api', apiRouter);

    this.expressApp.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        data: { path: req.originalUrl }
      });
    });

    this.expressApp.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Express error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        data: null
      });
    });
  }


  async start(): Promise<HybridServer> {
    try {
      this.httpServer = createServer(this.expressApp);

      // ⚠️ CRITICAL: Set very long timeouts to support long-running scrape jobs (up to 1 hour)
      // These timeouts must be longer than the longest possible scrape timeout
      this.httpServer.timeout = 3600000; // 1 hour (3,600,000ms) - maximum scrape job timeout
      this.httpServer.keepAliveTimeout = 3700000; // 61.67 minutes - must be > timeout
      this.httpServer.headersTimeout = 3800000; // 63.33 minutes - must be > keepAliveTimeout
      
      console.log(`⚙️  HTTP Server Timeout Configuration:`);
      console.log(`   Server timeout:      ${this.httpServer.timeout}ms (${Math.round(this.httpServer.timeout / 60000)} minutes)`);
      console.log(`   KeepAlive timeout:   ${this.httpServer.keepAliveTimeout}ms (${Math.round(this.httpServer.keepAliveTimeout / 60000)} minutes)`);
      console.log(`   Headers timeout:     ${this.httpServer.headersTimeout}ms (${Math.round(this.httpServer.headersTimeout / 60000)} minutes)`);

      this.httpServer.listen(this.getPort(), this.getHost(), () => {
        console.log(`🚀 Hybrid server started:`);
        console.log(`   WebSocket: ws://${this.getHost()}:${this.getPort()}`);
        console.log(`   REST API:  http://${this.getHost()}:${this.getPort()}/api`);
        console.log(`   Health:    http://${this.getHost()}:${this.getPort()}/health`);
        console.log(`   API Docs:  http://${this.getHost()}:${this.getPort()}/api/docs`);
      });

      this.httpServer.on('upgrade', (request: any, socket: any, head: any) => {
        const wss = new WebSocket.Server({ noServer: true });
        
        wss.on('connection', async (ws: WebSocket, req: any) => {
          console.log(`🔗 WebSocket connection established via HTTP upgrade`);
          console.log(`🔐 Auth header: ${req.headers.authorization ? 'present' : 'missing'}`);
          await this.handleNewConnection(ws, req);
        });

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      });

      await this.getDatabase().connect();
      await this.getSessionStore().connect();

      // Integrate referral service with other services
      this.getDatabaseService().setReferralService(this.referralService);
      this.getUptimeTracker().setReferralService(this.referralService);
      console.log('✅ ReferralService integrated with DatabaseService and UptimeTracker');

      // Integrate referral distribution service with reward distribution service
      this.rewardDistributionService.setReferralService(this.referralService);
      this.rewardDistributionService.setReferralDistributionService(this.referralDistributionService);
      console.log('✅ ReferralDistributionService integrated with RewardDistributionService');

      await this.rewardDistributionService.start();
      console.log('✅ Reward distribution service started');

      // Start job timeout monitor
      this.jobTimeoutMonitor.start();
      console.log('✅ Job timeout monitor started');

      return this;
    } catch (error) {
      console.error('❌ Hybrid server start failed:', error);
      throw error;
    }
  }


  async stop(): Promise<void> {
    try {
      // Stop job timeout monitor
      this.jobTimeoutMonitor.stop();
      console.log('✅ Job timeout monitor stopped');

      await this.rewardDistributionService.stop();
      console.log('✅ Reward distribution service stopped');
      
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.log('✅ HTTP server stopped');
        });
      }

      await super.stop();
    } catch (error) {
      console.error('❌ Error during hybrid server stop:', error);
    }
  }

  getRewardDistributionService(): RewardDistributionService {
    return this.rewardDistributionService;
  }

  getBlockchainService(): BlockchainService {
    return this.blockchainService;
  }

  getJobTimeoutMonitor(): JobTimeoutMonitor {
    return this.jobTimeoutMonitor;
  }

  getStats() {
    return {
      serverType: 'Hybrid (WebSocket + REST API)',
      endpoints: {
        websocket: `ws://${this.getHost()}:${this.getPort()}`,
        rest_api: `http://${this.getHost()}:${this.getPort()}/api`,
        rpc_api: `http://${this.getHost()}:${this.getPort()}/api/rpc`,
        health: `http://${this.getHost()}:${this.getPort()}/health`,
        api_docs: `http://${this.getHost()}:${this.getPort()}/api/docs`,
        swagger_yaml: `http://${this.getHost()}:${this.getPort()}/swagger.yaml`,
        reward_distribution: `http://${this.getHost()}:${this.getPort()}/rewards`
      },
      services: {
        jobTimeoutMonitor: this.jobTimeoutMonitor.getStatus(),
        rewardDistribution: this.rewardDistributionService.getStatus ? this.rewardDistributionService.getStatus() : 'running'
      }
    };
  }

  /**
   * Send job to client via WebSocket (expose from parent class)
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
    return await super.sendJobToClient(clientId, user_principal_id, url, scrapeType, jobId, post_count, replies_count, scrollPauseTime);
  }

  /**
   * Broadcast message to all connected clients
   */
  public async broadcastToClients(message: any): Promise<number> {
    return await super.broadcastToClients(message);
  }

  /**
   * Get RPC handler for advanced operations
   */
  public getRpcHandler() {
    return super.getRpcHandler();
  }

  /**
   * Get Node Service for node management operations
   */
  public getNodeService() {
    return super.getNodeService();
  }

  /**
   * Get Node WebSocket Handler for WebSocket operations
   */
  public getNodeHandler() {
    return super.getNodeHandler();
  }

  /**
   * Get ReferralService instance
   */
  getReferralService(): ReferralService {
    return this.referralService;
  }

  /**
   * Get ReferralDistributionService instance
   */
  getReferralDistributionService(): ReferralDistributionService {
    return this.referralDistributionService;
  }
}


if (require.main === module) {
  const server = new HybridServer({
    port: parseInt(process.env.PORT || "8082"),
    host: process.env.HOST || "localhost",
    icUrl: process.env.IC_URL || "https://ic0.app",
    fetchRootKey: process.env.FETCH_ROOT_KEY === "true",
  });


  (async () => {
    try {
      await server.start();
    } catch (error) {
      console.error("❌ Hybrid server start failed:", error);
      process.exit(1);
    }
  })();


  server.on("clientRegistered", (client: any) => {
    console.log(`🎉 New client registered: ${client.clientId}`);
  });

  server.on("speedTestReceived", ({ clientId, speedData }: any) => {
    console.log(
      `📈 Speed test: client ${clientId} - ${speedData.downloadSpeed}Mbps`
    );
  });


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
