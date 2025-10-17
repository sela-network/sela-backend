import { Database } from '../db/database';
import { DatabaseService } from '../db/service';
import { DatabaseConfig } from '../db/types';

async function testDatabase() {
  console.log('🧪 Testing Database Integration...');

  // Database configuration
  const config: DatabaseConfig = {
    redis: {
      url: process.env.REDIS_URL || 'redis://127.0.0.1:6380',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0')
    },
    timeouts: {
      deadTimeout: parseInt(process.env.DEAD_TIMEOUT || '3600000'),
      sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '86400')
    },
    limits: {
      usageLimit: parseInt(process.env.USAGE_LIMIT || '10000'),
      maxJobsPerClient: parseInt(process.env.MAX_JOBS_PER_CLIENT || '10')
    }
  };

  const db = new Database(config);
  const dbService = new DatabaseService(db);

  try {
    // Connect to database
    console.log('🔗 Connecting to database...');
    await db.connect();
    console.log('✅ Database connected');

    // Test health check
    const isHealthy = await db.healthCheck();
    console.log(`🏥 Database health: ${isHealthy ? 'OK' : 'FAILED'}`);

    if (!isHealthy) {
      throw new Error('Database health check failed');
    }

    // Test client operations
    console.log('\n👤 Testing client operations...');
    const testUserId = 'test_user_' + Date.now();
    
    // Create client
    const loginResult = await dbService.login(testUserId);
    if (!loginResult.success) {
      throw new Error(`Login failed: ${loginResult.error.message}`);
    }
    console.log('✅ Client login successful');

    // Get client
    const clientResult = await db.getClient(testUserId);
    if (!clientResult.success) {
      throw new Error(`Get client failed: ${clientResult.error.message}`);
    }
    console.log('✅ Client retrieval successful');

    // Update client
    const updateResult = await dbService.updateClientInternetSpeed(testUserId, '100.5');
    if (!updateResult.success) {
      throw new Error(`Update client failed: ${updateResult.error.message}`);
    }
    console.log('✅ Client update successful');

    // Test job operations
    console.log('\n📋 Testing job operations...');
    const testJobUUID = 'test_job_' + Date.now();
    
    // Create job
    const jobResult = await dbService.addJobToDB(testJobUUID, 'test_job_type', 'test_target');
    if (!jobResult.success) {
      throw new Error(`Create job failed: ${jobResult.error.message}`);
    }
    console.log('✅ Job creation successful');

    // Get job
    const getJobResult = await dbService.getJobWithID(jobResult.data);
    if (!getJobResult.success) {
      throw new Error(`Get job failed: ${getJobResult.error.message}`);
    }
    console.log('✅ Job retrieval successful');

    // Test session operations
    console.log('\n🔐 Testing session operations...');
    const sessionId = await dbService.wsCreateSession(testUserId, '123');
    if (sessionId === 'Failed to create session') {
      throw new Error('Session creation failed');
    }
    console.log('✅ Session creation successful');

    // Test uptime stats
    console.log('\n📊 Testing uptime stats...');
    const statsResult = await dbService.wsGetUptimeStats(testUserId);
    if (!statsResult.success) {
      throw new Error(`Get uptime stats failed: ${statsResult.error.message}`);
    }
    console.log('✅ Uptime stats retrieval successful');

    // Test API key operations
    console.log('\n🔑 Testing API key operations...');
    const apiKeyResult = await db.createAPIKey(testUserId);
    if (!apiKeyResult.success) {
      throw new Error(`Create API key failed: ${apiKeyResult.error.message}`);
    }
    console.log('✅ API key creation successful');

    // Test usage increment
    const usageResult = await db.incrementAPIUsage(testUserId);
    if (!usageResult.success) {
      throw new Error(`Increment usage failed: ${usageResult.error.message}`);
    }
    console.log('✅ API usage increment successful');

    console.log('\n🎉 All database tests passed!');

  } catch (error) {
    console.error('❌ Database test failed:', error);
    process.exit(1);
  } finally {
    // Disconnect from database
    await db.disconnect();
    console.log('🔌 Database disconnected');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDatabase().catch(console.error);
}

export { testDatabase };
