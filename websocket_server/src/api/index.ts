import { Router } from 'express';
import { createFileRoutes } from './routes/file_routes';
import { createRpcRoutes } from './routes/rpc_routes';
import { createNodeRoutes } from './routes/node_routes';
import { createRewardRoutes } from './routes/reward_routes';
import { createReferralRouter } from './routes/referral_routes';
import { createReferralDistributionRouter } from './routes/referral_distribution_routes';
import { FileService } from '../services/file_service';
import { NodeService } from '../services/node_service';
import { ReferralService } from '../services/referral_service';
import { NodeWebSocketHandler } from '../handlers/node_websocket_handler';
import { DatabaseService } from '../db/service';
import { Database } from '../db/database';

interface HybridServerLike {
  sendJobToClient(clientId: string, userPrincipalId: string, url: string, scrapeType: string, jobId?: string): Promise<{ success: boolean; message?: string; error?: string }>;
  broadcastToClients(message: any): Promise<number>;
  getNodeHandler(): NodeWebSocketHandler;
  getRewardDistributionService(): any;
  getReferralDistributionService(): any;
  getReferralService(): ReferralService;
  getDatabase(): Database;
}

export function createAPIRouter(database: Database, hybridServer?: HybridServerLike): Router {
  const router = Router();
  
  const fileService = new FileService(database);
  const databaseService = new DatabaseService(database);
  const nodeService = new NodeService(databaseService, fileService);
  
  const referralService = hybridServer?.getReferralService();
  
  const nodeHandler = hybridServer?.getNodeHandler();
  
  router.use('/files', createFileRoutes(fileService));
  router.use('/rpc', createRpcRoutes(database, hybridServer));
  router.use('/node', createNodeRoutes(nodeService, nodeHandler, hybridServer));
  if (referralService) {
    console.log('✅ Mounting /referral routes');
    router.use('/referral', createReferralRouter(database, referralService));
  } else {
    console.log('⚠️  Referral service not available, /referral routes not mounted');
  }
  if (hybridServer) {
    router.use('/rewards', createRewardRoutes(hybridServer));
    router.use('/referral-distribution', createReferralDistributionRouter(database, hybridServer.getReferralDistributionService()));
  }
  
  router.get('/health', async (req, res) => {
    try {
      const isHealthy = await database.healthCheck();
      if (isHealthy) {
        res.json({ 
          success: true, 
          message: 'Database is healthy',
          data: { 
            status: 'healthy', 
            timestamp: new Date().toISOString() 
          } 
        });
      } else {
        res.status(503).json({ 
          success: false, 
          message: 'Service unhealthy',
          data: null
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: 'Health check failed',
        data: null
      });
    }
  });
  
  return router;
}
