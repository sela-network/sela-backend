import { Database } from '../db/database';
import { ClientStruct, DatabaseConfig, REDIS_KEYS } from '../db/types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Migration script to index all existing referral codes
 * This script creates referral code lookup entries for all existing clients
 * who have referral codes but are not indexed in the referral lookup table
 */

export class ReferralCodeMigration {
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
   * Create backup of current referral code lookup data
   */
  async backupReferralCodeLookups(): Promise<{
    backupCount: number;
    backupFile: string;
    errors: string[];
  }> {
    const errors: string[] = [];
    let backupCount = 0;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `./data/backup-referral-codes-${timestamp}.json`;
      
      // Ensure backup directory exists
      const backupDir = path.dirname(backupFile);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const redisClient = this.db.getRedisClient();
      
      // Get all existing referral code lookups
      const lookupKeys = await redisClient.keys(`${REDIS_KEYS.REFERRAL.CODE_LOOKUP}*`);
      const backupData: Record<string, string> = {};

      for (const key of lookupKeys) {
        try {
          const value = await redisClient.get(key);
          if (value) {
            backupData[key] = value;
            backupCount++;
          }
        } catch (error) {
          errors.push(`Failed to backup key ${key}: ${error}`);
        }
      }

      // Write backup to file
      fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
      
      console.log(`✅ Backup created: ${backupFile}`);
      console.log(`📊 Backed up ${backupCount} referral code lookups`);

      return {
        backupCount,
        backupFile,
        errors
      };
    } catch (error) {
      errors.push(`Backup failed: ${error}`);
      throw error;
    }
  }

  /**
   * Audit current state of referral code indexing
   */
  async auditReferralCodeIndex(): Promise<{
    totalClients: number;
    indexedCodes: number;
    missingCodes: number;
    duplicateCodes: string[];
    missingEntries: Array<{ user_principal_id: string; referral_code: string }>;
  }> {
    console.log('🔍 Auditing referral code index...');

    const allClients = await this.db.getAllClients();
    if (!allClients.success) {
      throw new Error('Failed to get all clients for audit');
    }

    const redisClient = this.db.getRedisClient();
    let indexedCodes = 0;
    let missingCodes = 0;
    const duplicateCodes: string[] = [];
    const missingEntries: Array<{ user_principal_id: string; referral_code: string }> = [];
    const codeUsage: Record<string, string[]> = {};

    // Check each client's referral code
    for (const client of allClients.data) {
      if (!client.referralCode || client.referralCode.trim() === '') {
        continue; // Skip clients without referral codes
      }

      const lookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${client.referralCode}`;
      const existingEntry = await redisClient.get(lookupKey);

      if (existingEntry) {
        indexedCodes++;
        
        // Check for duplicates
        if (existingEntry !== client.user_principal_id) {
          if (!codeUsage[client.referralCode]) {
            codeUsage[client.referralCode] = [];
          }
          codeUsage[client.referralCode].push(existingEntry, client.user_principal_id);
        }
      } else {
        missingCodes++;
        missingEntries.push({
          user_principal_id: client.user_principal_id,
          referral_code: client.referralCode
        });
      }
    }

    // Find duplicate codes
    for (const [code, users] of Object.entries(codeUsage)) {
      if (users.length > 1) {
        duplicateCodes.push(code);
      }
    }

    console.log(`📊 Audit Results:`);
    console.log(`   - Total clients: ${allClients.data.length}`);
    console.log(`   - Indexed referral codes: ${indexedCodes}`);
    console.log(`   - Missing referral codes: ${missingCodes}`);
    console.log(`   - Duplicate referral codes: ${duplicateCodes.length}`);

    if (duplicateCodes.length > 0) {
      console.log(`⚠️  Duplicate codes found: ${duplicateCodes.join(', ')}`);
    }

    return {
      totalClients: allClients.data.length,
      indexedCodes,
      missingCodes,
      duplicateCodes,
      missingEntries
    };
  }

  /**
   * Index all missing referral codes
   */
  async indexMissingReferralCodes(): Promise<{
    indexed: number;
    skipped: number;
    errors: string[];
    duplicates: string[];
  }> {
    console.log('🔄 Indexing missing referral codes...');

    const audit = await this.auditReferralCodeIndex();
    const redisClient = this.db.getRedisClient();
    
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];
    const duplicates: string[] = [];

    // Handle duplicate codes first
    if (audit.duplicateCodes.length > 0) {
      console.log(`⚠️  Found ${audit.duplicateCodes.length} duplicate referral codes. These will be skipped.`);
      duplicates.push(...audit.duplicateCodes);
    }

    // Index missing codes
    for (const entry of audit.missingEntries) {
      try {
        // Check if this code is a duplicate
        if (duplicates.includes(entry.referral_code)) {
          skipped++;
          console.log(`⏭️  Skipped duplicate code: ${entry.referral_code} (user: ${entry.user_principal_id})`);
          continue;
        }

        const lookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${entry.referral_code}`;
        
        // Double-check that it's still missing (race condition protection)
        const existing = await redisClient.get(lookupKey);
        if (existing) {
          skipped++;
          console.log(`⏭️  Code already indexed: ${entry.referral_code}`);
          continue;
        }

        // Create the lookup entry
        await redisClient.set(lookupKey, entry.user_principal_id);
        indexed++;
        
        console.log(`✅ Indexed: ${entry.referral_code} -> ${entry.user_principal_id}`);
      } catch (error) {
        const errorMsg = `Failed to index ${entry.referral_code} for user ${entry.user_principal_id}: ${error}`;
        errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }

    console.log(`📊 Indexing Results:`);
    console.log(`   - Indexed: ${indexed}`);
    console.log(`   - Skipped: ${skipped}`);
    console.log(`   - Errors: ${errors.length}`);
    console.log(`   - Duplicates: ${duplicates.length}`);

    return {
      indexed,
      skipped,
      errors,
      duplicates
    };
  }

  /**
   * Verify the migration was successful
   */
  async verifyMigration(): Promise<{
    totalClients: number;
    indexedCodes: number;
    missingCodes: number;
    issues: string[];
  }> {
    console.log('🔍 Verifying migration...');

    const audit = await this.auditReferralCodeIndex();
    const issues: string[] = [];

    // Check for remaining issues
    if (audit.missingCodes > 0) {
      issues.push(`${audit.missingCodes} referral codes are still not indexed`);
    }

    if (audit.duplicateCodes.length > 0) {
      issues.push(`${audit.duplicateCodes.length} duplicate referral codes found: ${audit.duplicateCodes.join(', ')}`);
    }

    console.log(`📊 Verification Results:`);
    console.log(`   - Total clients: ${audit.totalClients}`);
    console.log(`   - Indexed codes: ${audit.indexedCodes}`);
    console.log(`   - Missing codes: ${audit.missingCodes}`);
    console.log(`   - Issues: ${issues.length}`);

    return {
      totalClients: audit.totalClients,
      indexedCodes: audit.indexedCodes,
      missingCodes: audit.missingCodes,
      issues
    };
  }

  /**
   * Generate new referral codes for clients with duplicate codes
   */
  async fixDuplicateReferralCodes(): Promise<{
    fixed: number;
    errors: string[];
  }> {
    console.log('🔧 Fixing duplicate referral codes...');

    const audit = await this.auditReferralCodeIndex();
    const redisClient = this.db.getRedisClient();
    
    let fixed = 0;
    const errors: string[] = [];

    for (const duplicateCode of audit.duplicateCodes) {
      try {
        // Get all clients with this duplicate code
        const allClients = await this.db.getAllClients();
        if (!allClients.success) continue;

        const clientsWithDuplicate = allClients.data.filter(
          client => client.referralCode === duplicateCode
        );

        // Keep the first client with the original code, generate new codes for others
        for (let i = 1; i < clientsWithDuplicate.length; i++) {
          const client = clientsWithDuplicate[i];
          const newCode = await this.generateUniqueReferralCode();
          
          // Update client with new referral code
          await this.db.updateClient(client.user_principal_id, {
            referralCode: newCode
          });

          // Create lookup entry for new code
          const newLookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${newCode}`;
          await redisClient.set(newLookupKey, client.user_principal_id);

          // Remove old lookup entry if it exists
          const oldLookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${duplicateCode}`;
          const oldEntry = await redisClient.get(oldLookupKey);
          if (oldEntry === client.user_principal_id) {
            await redisClient.del(oldLookupKey);
          }

          fixed++;
          console.log(`✅ Fixed duplicate: ${client.user_principal_id} now has code ${newCode}`);
        }
      } catch (error) {
        const errorMsg = `Failed to fix duplicate code ${duplicateCode}: ${error}`;
        errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }

    console.log(`📊 Duplicate Fix Results:`);
    console.log(`   - Fixed: ${fixed}`);
    console.log(`   - Errors: ${errors.length}`);

    return { fixed, errors };
  }

  /**
   * Generate a unique referral code
   */
  private async generateUniqueReferralCode(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const maxAttempts = 100;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let result = '';
      for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // Check if code is unique
      const lookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${result}`;
      const exists = await this.db.getRedisClient().get(lookupKey);
      
      if (!exists) {
        return result;
      }
    }
    
    throw new Error('Failed to generate unique referral code after 100 attempts');
  }
}

/**
 * CLI script runner for referral code migration
 */
export async function runReferralCodeMigration(): Promise<void> {
  const config: DatabaseConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380'),
      password: process.env.REDIS_PASSWORD || 'sela123',
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

  const migration = new ReferralCodeMigration(config);

  try {
    await migration.connect();
    
    console.log('🚀 Starting referral code migration...');
    console.log('📝 This will index all existing referral codes in the lookup table');
    console.log('💾 Creating backup first...\n');
    
    // Create backup first
    const backup = await migration.backupReferralCodeLookups();
    console.log(`✅ Backup created: ${backup.backupFile}\n`);
    
    // Run initial audit
    console.log('🔍 Running initial audit...');
    const initialAudit = await migration.auditReferralCodeIndex();
    
    if (initialAudit.missingCodes === 0) {
      console.log('✅ All referral codes are already indexed! No migration needed.');
      return;
    }

    // Fix duplicate codes first if any exist
    if (initialAudit.duplicateCodes.length > 0) {
      console.log(`\n🔧 Fixing ${initialAudit.duplicateCodes.length} duplicate referral codes...`);
      const duplicateFix = await migration.fixDuplicateReferralCodes();
      console.log(`✅ Fixed ${duplicateFix.fixed} duplicate codes\n`);
    }
    
    // Index missing codes
    console.log('🔄 Indexing missing referral codes...');
    const results = await migration.indexMissingReferralCodes();
    
    // Verify migration
    console.log('\n🔍 Verifying migration...');
    const verification = await migration.verifyMigration();
    
    console.log('\n📋 Migration Summary:');
    console.log(`- Total clients: ${verification.totalClients}`);
    console.log(`- Indexed referral codes: ${verification.indexedCodes}`);
    console.log(`- Missing codes: ${verification.missingCodes}`);
    console.log(`- Successfully indexed: ${results.indexed}`);
    console.log(`- Skipped: ${results.skipped}`);
    console.log(`- Errors: ${results.errors.length}`);
    console.log(`- Issues found: ${verification.issues.length}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (verification.issues.length > 0) {
      console.log('\n⚠️  Issues:');
      verification.issues.forEach(issue => console.log(`   - ${issue}`));
    }

    if (verification.missingCodes === 0 && verification.issues.length === 0) {
      console.log('\n🎉 Migration completed successfully! All referral codes are now indexed.');
    } else {
      console.log('\n⚠️  Migration completed with some issues. Please review the output above.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await migration.disconnect();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runReferralCodeMigration().catch(error => {
    console.error('❌ Referral code migration failed:', error);
    process.exit(1);
  });
}
