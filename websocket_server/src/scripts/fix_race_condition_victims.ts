/**
 * Script to identify and compensate users affected by the race condition bug
 * 
 * This script:
 * 1. Identifies users with balance discrepancies (reward history vs stored balance)
 * 2. Calculates missing points for each affected user
 * 3. Compensates users with missing points
 * 4. Generates a detailed report
 * 
 * Usage:
 * - Dry run (no changes): npx ts-node src/scripts/fix_race_condition_victims.ts
 * - Apply compensation: npx ts-node src/scripts/fix_race_condition_victims.ts --apply
 */

import { config } from 'dotenv';
import { Database } from '../db/database';
import { DatabaseService } from '../db/service';
import { BlockchainService } from '../services/blockchain_service';
import { REDIS_KEYS, JobState } from '../db/types';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config();

interface UserDiscrepancy {
  user_principal_id: string;
  stored_balance: number;
  stored_todaysEarnings: number;
  blockchain_balance: number;
  calculated_balance: number;
  calculated_todaysEarnings: number;
  missing_balance: number;
  missing_todaysEarnings: number;
  job_rewards: number;
  uptime_rewards: number;
  referral_rewards: number;
  source_of_truth: 'blockchain' | 'calculated' | 'unknown';
}

class RaceConditionFixScript {
  private db: Database;
  private dbService: DatabaseService;
  private blockchainService: BlockchainService;
  private dryRun: boolean;
  private reportPath: string;
  private useBlockchain: boolean;
  private tokenDecimals: number = 8; // Default, will be queried

  constructor(db: Database, dbService: DatabaseService, blockchainService: BlockchainService, dryRun: boolean = true) {
    this.db = db;
    this.dbService = dbService;
    this.blockchainService = blockchainService;
    this.dryRun = dryRun;
    
    // Check if blockchain is enabled
    const networkInfo = blockchainService.getNetworkInfo();
    this.useBlockchain = networkInfo.enabled && networkInfo.controllerPrincipal !== undefined;
    
    // Create report directory if it doesn't exist
    const reportDir = path.join(process.cwd(), 'reports', 'race-condition-fix');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.reportPath = path.join(reportDir, `race-condition-fix-${timestamp}.json`);
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    console.log('🔍 Starting race condition victim identification...');
    console.log(`Mode: ${this.dryRun ? 'DRY RUN (no changes will be made)' : 'APPLY COMPENSATION'}`);
    
    if (this.useBlockchain) {
      const networkInfo = this.blockchainService.getNetworkInfo();
      console.log(`🔗 Blockchain verification: ENABLED (${networkInfo.network.toUpperCase()})`);
      console.log(`   Controller: ${networkInfo.controllerPrincipal}`);
      
      // Query token decimals
      try {
        this.tokenDecimals = await this.blockchainService.getSelaPointsDecimals();
        console.log(`   Token decimals: ${this.tokenDecimals}`);
      } catch (error) {
        console.warn(`   ⚠️ Could not query token decimals, using default: ${this.tokenDecimals}`);
      }
      
      console.log(`   Using blockchain balance as source of truth`);
    } else {
      console.log(`⚠️ Blockchain verification: DISABLED`);
      console.log(`   Using calculated balance from reward history`);
    }
    console.log('');

    const startTime = Date.now();

    try {
      // Get all clients
      const clientsResult = await this.db.getAllClients();
      if (!clientsResult.success) {
        throw new Error(`Failed to get clients: ${clientsResult.error.message}`);
      }

      console.log(`📊 Found ${clientsResult.data.length} clients to check`);
      console.log('');

      const discrepancies: UserDiscrepancy[] = [];
      let checkedCount = 0;
      let affectedCount = 0;

      // Check each client for discrepancies
      for (const client of clientsResult.data) {
        checkedCount++;
        
        if (checkedCount % 10 === 0) {
          console.log(`Progress: ${checkedCount}/${clientsResult.data.length} clients checked...`);
        }

        const discrepancy = await this.checkUserDiscrepancy(client.user_principal_id);
        
        if (discrepancy && discrepancy.missing_balance > 0.01) {
          discrepancies.push(discrepancy);
          affectedCount++;
          
          console.log(`\n⚠️ DISCREPANCY FOUND: ${client.user_principal_id}`);
          console.log(`   Stored balance: ${discrepancy.stored_balance}`);
          
          if (discrepancy.source_of_truth === 'blockchain') {
            console.log(`   🔗 Blockchain balance: ${discrepancy.blockchain_balance.toFixed(4)} (SOURCE OF TRUTH)`);
            console.log(`   📊 Calculated balance: ${discrepancy.calculated_balance.toFixed(4)} (from rewards)`);
            console.log(`   Missing: ${discrepancy.missing_balance.toFixed(4)} points`);
          } else {
            console.log(`   📊 Expected balance: ${discrepancy.calculated_balance.toFixed(4)} (calculated)`);
            console.log(`   Missing: ${discrepancy.missing_balance.toFixed(4)} points`);
          }
          
          if (!this.dryRun) {
            await this.compensateUser(discrepancy);
          }
        }
      }

      // Generate report
      const report = {
        execution_time: new Date().toISOString(),
        mode: this.dryRun ? 'DRY_RUN' : 'APPLIED',
        summary: {
          total_clients_checked: checkedCount,
          affected_users: affectedCount,
          total_missing_points: discrepancies.reduce((sum, d) => sum + d.missing_balance, 0),
          total_compensated: this.dryRun ? 0 : discrepancies.reduce((sum, d) => sum + d.missing_balance, 0)
        },
        discrepancies: discrepancies.sort((a, b) => b.missing_balance - a.missing_balance),
        duration_ms: Date.now() - startTime
      };

      // Save report to file
      fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2));

      // Print summary
      console.log('\n' + '='.repeat(80));
      console.log('📊 SUMMARY');
      console.log('='.repeat(80));
      console.log(`Total clients checked: ${report.summary.total_clients_checked}`);
      console.log(`Affected users: ${report.summary.affected_users}`);
      console.log(`Total missing points: ${report.summary.total_missing_points.toFixed(4)}`);
      
      if (this.dryRun) {
        console.log(`\n⚠️ DRY RUN - No changes were made`);
        console.log(`Run with --apply flag to compensate affected users`);
      } else {
        console.log(`\n✅ Compensation applied: ${report.summary.total_compensated.toFixed(4)} points`);
      }
      
      console.log(`\nDetailed report saved to: ${this.reportPath}`);
      console.log(`Duration: ${(report.duration_ms / 1000).toFixed(2)}s`);
      console.log('='.repeat(80) + '\n');

    } catch (error) {
      console.error('❌ Error during execution:', error);
      throw error;
    }
  }

  /**
   * Check if a user has balance discrepancies
   */
  private async checkUserDiscrepancy(userPrincipalId: string): Promise<UserDiscrepancy | null> {
    try {
      // Get stored client data
      const clientResult = await this.db.getClient(userPrincipalId);
      if (!clientResult.success) {
        return null;
      }

      const client = clientResult.data;

      // Calculate expected balance from reward history
      const rewardCalculation = await this.calculateExpectedBalance(userPrincipalId);

      let blockchainBalance = 0;
      let expectedBalance = rewardCalculation.total_balance;
      let sourceOfTruth: 'blockchain' | 'calculated' | 'unknown' = 'calculated';

      // Check blockchain balance if enabled
      if (this.useBlockchain) {
        try {
          const balanceBigInt = await this.blockchainService.getSelaPointsBalance(userPrincipalId);
          // Convert from smallest unit to Sela Points using actual token decimals
          const divisor = Math.pow(10, this.tokenDecimals);
          blockchainBalance = Number(balanceBigInt) / divisor;
          
          // Use blockchain as source of truth
          expectedBalance = blockchainBalance;
          sourceOfTruth = 'blockchain';
          
        } catch (error) {
          console.warn(`⚠️ Could not fetch blockchain balance for ${userPrincipalId}:`, error);
          // Fall back to calculated balance
          sourceOfTruth = 'calculated';
        }
      }

      // Calculate discrepancies
      const missingBalance = expectedBalance - client.balance;
      const missingTodaysEarnings = 0; // todaysEarnings is not cumulative, skip this check

      // Only return if there's a significant discrepancy (> 0.01 points)
      if (Math.abs(missingBalance) < 0.01) {
        return null;
      }

      return {
        user_principal_id: userPrincipalId,
        stored_balance: client.balance,
        stored_todaysEarnings: client.todaysEarnings,
        blockchain_balance: blockchainBalance,
        calculated_balance: rewardCalculation.total_balance,
        calculated_todaysEarnings: 0, // Not calculated
        missing_balance: missingBalance,
        missing_todaysEarnings: 0,
        job_rewards: rewardCalculation.job_rewards,
        uptime_rewards: rewardCalculation.uptime_rewards,
        referral_rewards: rewardCalculation.referral_rewards,
        source_of_truth: sourceOfTruth
      };

    } catch (error) {
      console.error(`Error checking user ${userPrincipalId}:`, error);
      return null;
    }
  }

  /**
   * Calculate expected balance from all reward sources
   */
  private async calculateExpectedBalance(userPrincipalId: string): Promise<{
    total_balance: number;
    job_rewards: number;
    uptime_rewards: number;
    referral_rewards: number;
  }> {
    let jobRewards = 0;
    let uptimeRewards = 0;
    let referralRewards = 0;

    // 1. Calculate job rewards
    const jobsResult = await this.db.getJobsByUser(userPrincipalId);
    if (jobsResult.success) {
      const completedJobs = jobsResult.data.filter(job => job.state === JobState.COMPLETED);
      jobRewards = completedJobs.reduce((sum, job) => sum + job.reward, 0);
    }

    // 2. Calculate uptime rewards from confirmed transactions
    const transactionPattern = `${REDIS_KEYS.UPTIME.TRANSACTION}*`;
    const transactionKeys = await this.db.getRedisClient().keys(transactionPattern);
    
    for (const txKey of transactionKeys) {
      const txData = await this.db.getFileMetadata(txKey);
      if (txData) {
        const transaction = JSON.parse(txData);
        
        if (transaction.user_principal_id === userPrincipalId && transaction.status === 'CONFIRMED') {
          uptimeRewards += transaction.amount;
        }
      }
    }

    // 3. Calculate referral rewards
    const referralRewardKeys = await this.db.getRedisClient().sMembers(
      `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_USER}${userPrincipalId}`
    );

    for (const rewardId of referralRewardKeys) {
      const rewardKey = `${REDIS_KEYS.REFERRAL.REWARD}${rewardId}`;
      const rewardData = await this.db.getFileMetadata(rewardKey);
      if (rewardData) {
        const reward = JSON.parse(rewardData);
        if (reward.status === 'DISTRIBUTED') {
          referralRewards += reward.reward_amount;
        }
      }
    }

    return {
      total_balance: jobRewards + uptimeRewards + referralRewards,
      job_rewards: jobRewards,
      uptime_rewards: uptimeRewards,
      referral_rewards: referralRewards
    };
  }

  /**
   * Compensate a user with missing points
   */
  private async compensateUser(discrepancy: UserDiscrepancy): Promise<void> {
    try {
      console.log(`💰 Compensating user ${discrepancy.user_principal_id} with ${discrepancy.missing_balance.toFixed(4)} points...`);

      const clientResult = await this.db.getClient(discrepancy.user_principal_id);
      if (!clientResult.success) {
        console.error(`❌ Failed to get client for compensation: ${clientResult.error.message}`);
        return;
      }

      const updateResult = await this.db.updateClient(discrepancy.user_principal_id, {
        balance: clientResult.data.balance + discrepancy.missing_balance
      });

      if (updateResult.success) {
        console.log(`✅ Compensation applied successfully`);
      } else {
        console.error(`❌ Failed to apply compensation: ${updateResult.error.message}`);
      }

    } catch (error) {
      console.error(`❌ Error compensating user ${discrepancy.user_principal_id}:`, error);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const applyCompensation = args.includes('--apply');

  // Check for required environment variables
  if (!process.env.REDIS_PASSWORD) {
    console.error('❌ Error: REDIS_PASSWORD environment variable is not set');
    console.error('');
    console.error('Please make sure:');
    console.error('1. You have a .env file in the project root');
    console.error('2. The .env file contains: REDIS_PASSWORD=your_password');
    console.error('');
    console.error('Example .env file:');
    console.error('  REDIS_HOST=localhost');
    console.error('  REDIS_PORT=6380');
    console.error('  REDIS_PASSWORD=your_redis_password');
    console.error('');
    process.exit(1);
  }

  // Initialize database
  const config = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380'),
      password: process.env.REDIS_PASSWORD
    },
    timeouts: {
      deadTimeout: 60000,
      sessionTimeout: 3600
    },
    limits: {
      usageLimit: 1000,
      maxJobsPerClient: 10
    }
  };

  console.log(`📡 Connecting to Redis at ${config.redis.host}:${config.redis.port}...`);
  
  const db = new Database(config);
  
  try {
    await db.connect();
    console.log('✅ Redis connection established\n');
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    console.error('');
    console.error('Please check:');
    console.error('1. Redis is running');
    console.error('2. REDIS_HOST and REDIS_PORT are correct');
    console.error('3. REDIS_PASSWORD is correct');
    console.error('');
    process.exit(1);
  }

  const dbService = new DatabaseService(db);
  
  // Initialize blockchain service
  const blockchainService = new BlockchainService();
  const networkInfo = blockchainService.getNetworkInfo();
  console.log(`\n🔗 Blockchain Service Status:`);
  console.log(`   Network: ${networkInfo.network.toUpperCase()}`);
  console.log(`   Status: ${networkInfo.status}`);
  if (networkInfo.controllerPrincipal) {
    console.log(`   Controller: ${networkInfo.controllerPrincipal}`);
  }
  console.log('');

  // Run the script
  const script = new RaceConditionFixScript(db, dbService, blockchainService, !applyCompensation);
  
  try {
    await script.run();
    process.exit(0);
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { RaceConditionFixScript, UserDiscrepancy };

