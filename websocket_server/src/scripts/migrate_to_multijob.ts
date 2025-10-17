import { Database } from '../db/database';
import { ClientStruct, ClientStatus, ClientState, DatabaseConfig } from '../db/types';

/**
 * Migration script to finalize multi-job support by removing backward compatibility fields
 * This script removes deprecated jobID, jobStatus, jobStartTime, and jobEndTime fields
 * FINAL MIGRATION - RUN AFTER CONFIRMING SYSTEM STABILITY
 */

export class MultiJobMigration {
  private db: Database;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config);
  }

  async connect(): Promise<void> {
    await this.db.connect();
  }

  async disconnect(): Promise<void> {
    await this.db.disconnect();
  }

  /**
   * Add multi-job support while keeping backward compatibility
   */
  async addMultiJobSupport(): Promise<{
    migrated: number;
    skipped: number;
    errors: string[];
  }> {
    console.log('🚀 Adding multi-job support to clients...');
    
    const results = {
      migrated: 0,
      skipped: 0,
      errors: [] as string[]
    };

    try {
      // Get all existing clients
      const allClientsResult = await this.db.getAllClients();
      if (!allClientsResult.success) {
        throw new Error(`Failed to get clients: ${allClientsResult.error.message}`);
      }

      const clients = allClientsResult.data;
      console.log(`📊 Found ${clients.length} clients to add multi-job support`);

      for (const client of clients) {
        try {
          const migrationResult = await this.addMultiJobToClient(client);
          if (migrationResult.migrated) {
            results.migrated++;
            console.log(`✅ Added multi-job support to client: ${client.user_principal_id}`);
          } else {
            results.skipped++;
            console.log(`⏭️ Skipped client: ${client.user_principal_id} (${migrationResult.reason})`);
          }
        } catch (error) {
          const errorMsg = `Failed to add multi-job support to client ${client.user_principal_id}: ${error}`;
          results.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

      console.log('🎉 Multi-job support addition completed!');
      console.log(`📊 Results: ${results.migrated} migrated, ${results.skipped} skipped, ${results.errors.length} errors`);

      return results;
    } catch (error) {
      console.error('❌ Multi-job support addition failed:', error);
      throw error;
    }
  }

  /**
   * Add multi-job support to a single client
   */
  private async addMultiJobToClient(client: ClientStruct): Promise<{
    migrated: boolean;
    reason?: string;
  }> {
    // Check if client already has multi-job fields
    if (client.activeJobs !== undefined && Array.isArray(client.activeJobs)) {
      return {
        migrated: false,
        reason: 'Already has multi-job support (has activeJobs array)'
      };
    }

    // Create updated client structure with multi-job support
    const updatedClient: any = {
      ...client,
      // ✅ Add new multi-job fields
      activeJobs: this.getLegacyActiveJobs(client),
      maxConcurrentJobs: this.getDefaultMaxConcurrentJobs(client),
    };

    // Update the client in database
    const updateResult = await this.db.updateClient(client.user_principal_id, updatedClient);
    if (!updateResult.success) {
      throw new Error(`Database update failed: ${updateResult.error.message}`);
    }

    return { migrated: true };
  }

  /**
   * Convert legacy jobID to activeJobs array (for initial migration)
   */
  private getLegacyActiveJobs(client: any): string[] {
    const legacyJobID = client.jobID;
    const legacyJobStatus = client.jobStatus;
    
    // If client has an active job, add it to the array
    if (legacyJobID && 
        legacyJobID.trim() !== '' && 
        legacyJobStatus === 'WORKING') {
      return [legacyJobID];
    }
    
    return [];
  }

  /**
   * Determine default max concurrent jobs based on client performance
   */
  private getDefaultMaxConcurrentJobs(client: ClientStruct): number {
    const downloadSpeed = client.downloadSpeed || 0;
    
    return 5
  }

  /**
   * Verify initial migration was successful
   */
  async verifyInitialMigration(): Promise<{
    totalClients: number;
    migratedClients: number;
    unmigrated: string[];
    issues: string[];
  }> {
    console.log('🔍 Verifying initial migration...');
    
    const results = {
      totalClients: 0,
      migratedClients: 0,
      unmigrated: [] as string[],
      issues: [] as string[]
    };

    try {
      const allClientsResult = await this.db.getAllClients();
      if (!allClientsResult.success) {
        throw new Error(`Failed to get clients: ${allClientsResult.error.message}`);
      }

      const clients = allClientsResult.data;
      results.totalClients = clients.length;

      for (const client of clients) {
        // Check if client has been migrated to multi-job
        if (client.activeJobs !== undefined && Array.isArray(client.activeJobs)) {
          results.migratedClients++;
          
          // Verify data consistency
          const issues = this.validateInitialMigration(client);
          if (issues.length > 0) {
            results.issues.push(`Client ${client.user_principal_id}: ${issues.join(', ')}`);
          }
        } else {
          results.unmigrated.push(client.user_principal_id);
        }
      }

      console.log(`📊 Verification: ${results.migratedClients}/${results.totalClients} have multi-job support`);
      if (results.unmigrated.length > 0) {
        console.log(`⚠️ Clients without multi-job support: ${results.unmigrated.join(', ')}`);
      }
      if (results.issues.length > 0) {
        console.log(`⚠️ Issues found: ${results.issues.length}`);
        results.issues.forEach(issue => console.log(`   - ${issue}`));
      }

      return results;
    } catch (error) {
      console.error('❌ Initial migration verification failed:', error);
      throw error;
    }
  }

  /**
   * Validate a client after initial migration
   */
  private validateInitialMigration(client: ClientStruct): string[] {
    const issues: string[] = [];

    // Check required multi-job fields
    if (!Array.isArray(client.activeJobs)) {
      issues.push('activeJobs is not an array');
    }

    if (typeof client.maxConcurrentJobs !== 'number' || client.maxConcurrentJobs < 1) {
      issues.push('invalid maxConcurrentJobs');
    }

    // Check capacity consistency
    if (client.activeJobs && client.activeJobs.length > client.maxConcurrentJobs) {
      issues.push(`activeJobs (${client.activeJobs.length}) exceeds maxConcurrentJobs (${client.maxConcurrentJobs})`);
    }

    return issues;
  }

  /**
   * Remove backward compatibility fields from all clients
   */
  async removeBackwardCompatibilityFields(): Promise<{
    cleaned: number;
    skipped: number;
    errors: string[];
  }> {
    console.log('🧹 Starting backward compatibility field removal...');
    
    const results = {
      cleaned: 0,
      skipped: 0,
      errors: [] as string[]
    };

    try {
      // Get all existing clients
      const allClientsResult = await this.db.getAllClients();
      if (!allClientsResult.success) {
        throw new Error(`Failed to get clients: ${allClientsResult.error.message}`);
      }

      const clients = allClientsResult.data;
      console.log(`📊 Found ${clients.length} clients to clean`);

      for (const client of clients) {
        try {
          const cleanupResult = await this.cleanupClient(client);
          if (cleanupResult.cleaned) {
            results.cleaned++;
            console.log(`✅ Cleaned client: ${client.user_principal_id}`);
          } else {
            results.skipped++;
            console.log(`⏭️ Skipped client: ${client.user_principal_id} (${cleanupResult.reason})`);
          }
        } catch (error) {
          const errorMsg = `Failed to clean client ${client.user_principal_id}: ${error}`;
          results.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

      console.log('🎉 Cleanup completed!');
      console.log(`📊 Results: ${results.cleaned} cleaned, ${results.skipped} skipped, ${results.errors.length} errors`);

      return results;
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Remove backward compatibility fields from a single client
   */
  private async cleanupClient(client: ClientStruct): Promise<{
    cleaned: boolean;
    reason?: string;
  }> {
    // Check if client has backward compatibility fields that need to be removed
    const hasDeprecatedFields = (
      (client as any).jobID !== undefined ||
      (client as any).jobStatus !== undefined ||
      (client as any).jobStartTime !== undefined ||
      (client as any).jobEndTime !== undefined
    );

    if (!hasDeprecatedFields) {
      return {
        cleaned: false,
        reason: 'No deprecated fields found'
      };
    }

    // Ensure client has required multi-job fields before cleanup
    if (!client.activeJobs || !Array.isArray(client.activeJobs)) {
      return {
        cleaned: false,
        reason: 'Client missing activeJobs array - run initial migration first'
      };
    }

    if (!client.maxConcurrentJobs || typeof client.maxConcurrentJobs !== 'number') {
      return {
        cleaned: false,
        reason: 'Client missing maxConcurrentJobs - run initial migration first'
      };
    }

    // Create clean client structure without deprecated fields
    const cleanedClient: ClientStruct = {
      user_principal_id: client.user_principal_id,
      client_id: client.client_id,
      activeJobs: client.activeJobs,
      maxConcurrentJobs: client.maxConcurrentJobs,
      downloadSpeed: client.downloadSpeed || 0,
      ping: client.ping || 0,
      wsConnect: client.wsConnect,
      wsDisconnect: client.wsDisconnect || 0,
      todaysEarnings: client.todaysEarnings || 0,
      balance: client.balance || 0,
      referralCode: client.referralCode,
      totalReferral: client.totalReferral || 0,
      clientStatus: client.clientStatus || 'Inactive',
      pingTimestamp: client.pingTimestamp || Date.now(),
      totalUptime: client.totalUptime || 0,
      dailyUptime: client.dailyUptime || 0,
      uptimeReward: client.uptimeReward || 0
      // 🗑️ Explicitly NOT including: jobID, jobStatus, jobStartTime, jobEndTime
    };
    
    console.log(`🗑️ Removing deprecated fields (jobID, jobStatus, jobStartTime, jobEndTime) from client ${client.user_principal_id}`);
    
    // Set the client directly in Redis to completely replace the data
    const redis = this.db.getRedisClient();
    const clientKey = `client:${client.user_principal_id}`;
    await redis.set(clientKey, JSON.stringify(cleanedClient));
    
    console.log(`✅ Client data completely replaced with clean structure`);

    console.log(`🧹 Removed deprecated fields from client ${client.user_principal_id}`);
    return { cleaned: true };
  }

  /**
   * Verify all clients have proper multi-job structure (no deprecated fields)
   */
  async verifyCleanupComplete(): Promise<{
    totalClients: number;
    cleanClients: number;
    clientsWithDeprecatedFields: string[];
    issues: string[];
  }> {
    console.log('🔍 Verifying cleanup completion...');
    
    const results = {
      totalClients: 0,
      cleanClients: 0,
      clientsWithDeprecatedFields: [] as string[],
      issues: [] as string[]
    };

    try {
      const allClientsResult = await this.db.getAllClients();
      if (!allClientsResult.success) {
        throw new Error(`Failed to get clients: ${allClientsResult.error.message}`);
      }

      const clients = allClientsResult.data;
      results.totalClients = clients.length;

      for (const client of clients) {
        // Check for deprecated fields
        const hasDeprecatedFields = (
          (client as any).jobID !== undefined ||
          (client as any).jobStatus !== undefined ||
          (client as any).jobStartTime !== undefined ||
          (client as any).jobEndTime !== undefined
        );

        if (hasDeprecatedFields) {
          results.clientsWithDeprecatedFields.push(client.user_principal_id);
        } else {
          results.cleanClients++;
          
          // Verify clean client structure
          const issues = this.validateCleanClient(client);
          if (issues.length > 0) {
            results.issues.push(`Client ${client.user_principal_id}: ${issues.join(', ')}`);
          }
        }
      }

      console.log(`📊 Cleanup verification: ${results.cleanClients}/${results.totalClients} clients clean`);
      if (results.clientsWithDeprecatedFields.length > 0) {
        console.log(`⚠️ Clients with deprecated fields: ${results.clientsWithDeprecatedFields.join(', ')}`);
      }
      if (results.issues.length > 0) {
        console.log(`⚠️ Issues found: ${results.issues.length}`);
        results.issues.forEach(issue => console.log(`   - ${issue}`));
      }

      return results;
    } catch (error) {
      console.error('❌ Cleanup verification failed:', error);
      throw error;
    }
  }

  /**
   * Validate a clean client (no deprecated fields)
   */
  private validateCleanClient(client: ClientStruct): string[] {
    const issues: string[] = [];

    // Check required multi-job fields
    if (!Array.isArray(client.activeJobs)) {
      issues.push('activeJobs is not an array');
    }

    if (typeof client.maxConcurrentJobs !== 'number' || client.maxConcurrentJobs < 1) {
      issues.push('invalid maxConcurrentJobs');
    }

    // Check capacity consistency
    if (client.activeJobs && client.activeJobs.length > client.maxConcurrentJobs) {
      issues.push(`activeJobs (${client.activeJobs.length}) exceeds maxConcurrentJobs (${client.maxConcurrentJobs})`);
    }

    // Ensure no deprecated fields exist
    if ((client as any).jobID !== undefined) {
      issues.push('deprecated jobID field found');
    }
    if ((client as any).jobStatus !== undefined) {
      issues.push('deprecated jobStatus field found');
    }
    if ((client as any).jobStartTime !== undefined) {
      issues.push('deprecated jobStartTime field found');
    }
    if ((client as any).jobEndTime !== undefined) {
      issues.push('deprecated jobEndTime field found');
    }

    return issues;
  }

  /**
   * Backup current client data before cleanup (for safety)
   */
  async backupClientData(): Promise<{
    backupCount: number;
    backupFile: string;
    errors: string[];
  }> {
    console.log('💾 Creating backup of current client data...');
    
    const results = {
      backupCount: 0,
      backupFile: '',
      errors: [] as string[]
    };

    try {
      const allClientsResult = await this.db.getAllClients();
      if (!allClientsResult.success) {
        throw new Error(`Failed to get clients: ${allClientsResult.error.message}`);
      }

      const clients = allClientsResult.data;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `backup-clients-${timestamp}.json`;
      
      const fs = require('fs');
      const path = require('path');
      const backupPath = path.join(process.cwd(), 'data', backupFile);
      
      // Ensure data directory exists
      const dataDir = path.dirname(backupPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      fs.writeFileSync(backupPath, JSON.stringify(clients, null, 2));
      
      results.backupCount = clients.length;
      results.backupFile = backupPath;
      
      console.log(`✅ Backup created: ${backupPath} (${clients.length} clients)`);
      return results;
    } catch (error) {
      const errorMsg = `Failed to create backup: ${error}`;
      results.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
      throw error;
    }
  }
}

/**
 * CLI script runner for initial multi-job migration (adds activeJobs + keeps backward compatibility)
 */
export async function runInitialMigration(): Promise<void> {
  const config: DatabaseConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380'),
      password: 'sela123', // Hardcoded Redis password
      db: parseInt(process.env.REDIS_DB || '0')
    },
    timeouts: {
      deadTimeout: 300000,
      sessionTimeout: 3600
    },
    limits: {
      usageLimit: 1000,
      maxJobsPerClient: 10
    }
  };

  const migration = new MultiJobMigration(config);

  try {
    await migration.connect();
    
    console.log('🚀 Starting initial multi-job migration...');
    console.log('📝 This will add activeJobs + maxConcurrentJobs while keeping backward compatibility');
    console.log('💾 Creating backup first...\n');
    
    // Create backup first
    const backup = await migration.backupClientData();
    console.log(`✅ Backup created: ${backup.backupFile}\n`);
    
    // Run initial migration (adds activeJobs, keeps deprecated fields)
    const results = await migration.addMultiJobSupport();
    
    // Verify migration
    const verification = await migration.verifyInitialMigration();
    
    console.log('\n📋 Initial Migration Summary:');
    console.log(`- Total clients: ${verification.totalClients}`);
    console.log(`- Successfully migrated: ${results.migrated}`);
    console.log(`- Skipped: ${results.skipped}`);
    console.log(`- Clients with activeJobs: ${verification.migratedClients}`);
    console.log(`- Errors: ${results.errors.length}`);
    console.log(`- Issues found: ${verification.issues.length}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (verification.issues.length > 0) {
      console.log('\n⚠️ Issues:');
      verification.issues.forEach(issue => console.log(`   - ${issue}`));
    }

    if (verification.migratedClients === verification.totalClients) {
      console.log('\n🎉 SUCCESS: All clients now support multi-job structure!');
      console.log('✅ Initial migration is complete.');
      console.log('📝 Test your system thoroughly, then run cleanup migration to remove deprecated fields.');
    } else {
      console.log('\n⚠️ WARNING: Some clients were not migrated. Review and run again if needed.');
    }

  } catch (error) {
    console.error('❌ Initial migration script failed:', error);
    process.exit(1);
  } finally {
    await migration.disconnect();
  }
}

/**
 * CLI script runner for removing backward compatibility fields
 */
export async function runCleanupMigration(): Promise<void> {
  const config: DatabaseConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380'),
      password: 'sela123', // Hardcoded Redis password
      db: parseInt(process.env.REDIS_DB || '0')
    },
    timeouts: {
      deadTimeout: 300000,
      sessionTimeout: 3600
    },
    limits: {
      usageLimit: 1000,
      maxJobsPerClient: 10
    }
  };

  const migration = new MultiJobMigration(config);

  try {
    await migration.connect();
    
    console.log('🚀 Starting final cleanup migration...');
    console.log('⚠️  This will PERMANENTLY remove backward compatibility fields!');
    console.log('💾 Creating backup first...\n');
    
    // Create backup first
    const backup = await migration.backupClientData();
    console.log(`✅ Backup created: ${backup.backupFile}\n`);
    
    // Remove backward compatibility fields
    const results = await migration.removeBackwardCompatibilityFields();
    
    // Verify cleanup
    const verification = await migration.verifyCleanupComplete();
    
    console.log('\n📋 Cleanup Migration Summary:');
    console.log(`- Total clients: ${verification.totalClients}`);
    console.log(`- Successfully cleaned: ${results.cleaned}`);
    console.log(`- Skipped: ${results.skipped}`);
    console.log(`- Clean clients: ${verification.cleanClients}`);
    console.log(`- Clients with deprecated fields: ${verification.clientsWithDeprecatedFields.length}`);
    console.log(`- Errors: ${results.errors.length}`);
    console.log(`- Issues found: ${verification.issues.length}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (verification.issues.length > 0) {
      console.log('\n⚠️ Issues:');
      verification.issues.forEach(issue => console.log(`   - ${issue}`));
    }

    if (verification.clientsWithDeprecatedFields.length > 0) {
      console.log('\n⚠️ Clients still with deprecated fields:');
      verification.clientsWithDeprecatedFields.forEach(id => console.log(`   - ${id}`));
    }

    if (verification.cleanClients === verification.totalClients) {
      console.log('\n🎉 SUCCESS: All clients are now clean of deprecated fields!');
      console.log('✅ Multi-job migration is complete.');
      console.log('📝 You can now remove deprecated field definitions from ClientStruct interface.');
    } else {
      console.log('\n⚠️ WARNING: Some clients still have deprecated fields. Review and run again if needed.');
    }

  } catch (error) {
    console.error('❌ Cleanup migration script failed:', error);
    process.exit(1);
  } finally {
    await migration.disconnect();
  }
}

// Run initial migration if this file is executed directly
if (require.main === module) {
  // Check command line arguments
  const args = process.argv.slice(2);
  const isCleanup = args.includes('--cleanup') || args.includes('cleanup');
  
  if (isCleanup) {
    runCleanupMigration().catch(error => {
      console.error('❌ Cleanup migration failed:', error);
      process.exit(1);
    });
  } else {
    runInitialMigration().catch(error => {
      console.error('❌ Initial migration failed:', error);
      process.exit(1);
    });
  }
}

