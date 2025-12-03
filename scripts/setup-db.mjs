#!/usr/bin/env node

import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env file
config();

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ Missing DATABASE_URL environment variable');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('🚀 Running database setup...\n');

    // Run base migrations
    const migrations = [
      'supabase/migrations/00000000000000_initial_schema.sql',
      'supabase/migrations/00000000000001_add_auth.sql'
    ];

    for (const migrationPath of migrations) {
      const sql = readFileSync(join(process.cwd(), migrationPath), 'utf8');
      console.log(`📄 Running ${migrationPath.split('/').pop()}...`);

      await client.query(sql);
      console.log('✅ Success!\n');
    }

    // Enable realtime
    console.log('🔄 Enabling realtime for execution tables...');
    try {
      await client.query(`
        ALTER PUBLICATION supabase_realtime ADD TABLE scout_executions;
        ALTER PUBLICATION supabase_realtime ADD TABLE scout_execution_steps;
      `);
      console.log('✅ Realtime enabled!\n');
    } catch (realtimeError) {
      if (realtimeError.message.includes('already member')) {
        console.log('✅ Realtime already enabled!\n');
      } else {
        throw realtimeError;
      }
    }

    // Check if pg_cron, pg_net, and vector extensions are enabled
    console.log('🔍 Checking for required extensions...');
    const { rows: extensions } = await client.query(`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net', 'vector', 'supabase_vault');
    `);

    const hasPgCron = extensions.some(e => e.extname === 'pg_cron');
    const hasPgNet = extensions.some(e => e.extname === 'pg_net');
    const hasVector = extensions.some(e => e.extname === 'vector');
    const hasVault = extensions.some(e => e.extname === 'supabase_vault');

    if (!hasVector) {
      console.log('⚠️  pgvector extension not enabled\n');
      console.log('📝 To enable vector embeddings:');
      console.log('   1. Go to Supabase Dashboard → Database → Extensions');
      console.log('   2. Enable the "vector" extension');
      console.log('   3. Run this script again: npm run setup:db\n');
    } else {
      console.log('✅ pgvector extension enabled!');
    }

    if (hasPgCron && hasPgNet) {
      console.log('✅ Scheduling extensions (pg_cron, pg_net) enabled!');
    } else {
      console.log('⚠️  Scheduling extensions not enabled yet\n');
      console.log('📝 To enable automatic scheduling:');
      console.log('   1. Go to Supabase Dashboard → Database → Extensions');
      const missing = [];
      if (!hasPgCron) missing.push('pg_cron');
      if (!hasPgNet) missing.push('pg_net');
      console.log(`   2. Enable: ${missing.join(', ')}`);
      console.log('   3. Run this script again: npm run setup:db\n');
    }

    if (hasVault) {
      console.log('✅ Vault extension enabled!');
    } else {
      console.log('⚠️  Vault extension not enabled (will try to enable)\n');
    }

    console.log('');

    // Set up the scalable dispatcher architecture if extensions are available
    if (hasPgCron && hasPgNet) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceRoleKey) {
        console.log('⚠️  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        console.log('   Skipping dispatcher setup. Add these to .env and run again.\n');
      } else {
        console.log('🔧 Setting up scalable scout dispatcher...\n');

        // Enable vault if not already enabled
        if (!hasVault) {
          try {
            await client.query('CREATE EXTENSION IF NOT EXISTS supabase_vault;');
            console.log('✅ Enabled supabase_vault extension');
          } catch (vaultError) {
            console.log('⚠️  Could not enable vault:', vaultError.message);
            console.log('   Enable it manually in Dashboard → Database → Extensions\n');
          }
        }

        // Store secrets in vault (upsert pattern)
        console.log('🔐 Configuring vault secrets...');
        try {
          // Delete existing secrets if they exist, then create new ones
          await client.query(`
            DELETE FROM vault.secrets WHERE name IN ('project_url', 'service_role_key');
          `);

          await client.query(`
            SELECT vault.create_secret($1, 'project_url');
          `, [supabaseUrl]);

          await client.query(`
            SELECT vault.create_secret($1, 'service_role_key');
          `, [serviceRoleKey]);

          console.log('✅ Vault secrets configured!\n');
        } catch (secretError) {
          console.log('⚠️  Could not configure vault secrets:', secretError.message);
          console.log('   You may need to run this manually in SQL Editor:\n');
          console.log(`   SELECT vault.create_secret('${supabaseUrl}', 'project_url');`);
          console.log(`   SELECT vault.create_secret('your-service-role-key', 'service_role_key');\n`);
        }

        // Run the dispatcher migration
        const dispatcherMigrationPath = 'supabase/migrations/20251202000000_add_scout_dispatcher.sql';
        if (existsSync(join(process.cwd(), dispatcherMigrationPath))) {
          console.log('📄 Running scout dispatcher migration...');
          try {
            const dispatcherSql = readFileSync(join(process.cwd(), dispatcherMigrationPath), 'utf8');
            await client.query(dispatcherSql);
            console.log('✅ Dispatcher migration complete!\n');
          } catch (dispatcherError) {
            // Check if it's just a "already exists" error
            if (dispatcherError.message.includes('already exists')) {
              console.log('✅ Dispatcher already configured!\n');
            } else {
              console.log('⚠️  Dispatcher migration warning:', dispatcherError.message);
              console.log('   This may be okay if already configured.\n');
            }
          }
        }

        // Clean up old cron jobs and verify new ones
        console.log('⏰ Configuring cron jobs...');

        // Remove old-style cron jobs
        const oldJobs = ['scout-cron-hourly', 'scout-cron-5min'];
        for (const jobName of oldJobs) {
          try {
            await client.query(`SELECT cron.unschedule($1);`, [jobName]);
            console.log(`   Removed old job: ${jobName}`);
          } catch {
            // Job doesn't exist, that's fine
          }
        }

        // Verify the new dispatcher jobs exist, create them if missing
        let { rows: cronJobs } = await client.query(`
          SELECT jobname, schedule FROM cron.job WHERE jobname IN ('dispatch-scouts', 'cleanup-scouts');
        `);

        // If jobs are missing, try to create them directly
        if (cronJobs.length < 2) {
          console.log('   Creating dispatcher cron jobs...');

          const hasDispatch = cronJobs.some(j => j.jobname === 'dispatch-scouts');
          const hasCleanup = cronJobs.some(j => j.jobname === 'cleanup-scouts');

          if (!hasDispatch) {
            try {
              await client.query(`
                SELECT cron.schedule(
                  'dispatch-scouts',
                  '* * * * *',
                  'SELECT dispatch_due_scouts()'
                );
              `);
              console.log('   Created: dispatch-scouts (every minute)');
            } catch (e) {
              console.log('   Could not create dispatch-scouts:', e.message);
            }
          }

          if (!hasCleanup) {
            try {
              await client.query(`
                SELECT cron.schedule(
                  'cleanup-scouts',
                  '*/5 * * * *',
                  'SELECT cleanup_scout_executions()'
                );
              `);
              console.log('   Created: cleanup-scouts (every 5 minutes)');
            } catch (e) {
              console.log('   Could not create cleanup-scouts:', e.message);
            }
          }

          // Re-check
          const result = await client.query(`
            SELECT jobname, schedule FROM cron.job WHERE jobname IN ('dispatch-scouts', 'cleanup-scouts');
          `);
          cronJobs = result.rows;
        }

        if (cronJobs.length >= 2) {
          console.log('✅ Dispatcher cron jobs configured:');
          cronJobs.forEach(job => {
            console.log(`   - ${job.jobname}: ${job.schedule}`);
          });
          console.log('');
        } else {
          console.log('⚠️  Dispatcher cron jobs may not be fully configured.');
          console.log('   Try running this SQL in the Supabase SQL Editor:\n');
          console.log(`   SELECT cron.schedule('dispatch-scouts', '* * * * *', 'SELECT dispatch_due_scouts()');`);
          console.log(`   SELECT cron.schedule('cleanup-scouts', '*/5 * * * *', 'SELECT cleanup_scout_executions()');\n`);
        }

        console.log('🎯 Scalable Architecture Enabled!');
        console.log('   Each scout now runs in its own isolated edge function.');
        console.log('   This supports thousands of scouts without timeout issues.\n');
      }
    }

    console.log('🎉 Database setup complete!\n');

    // Authentication setup instructions
    console.log('🔐 Authentication Setup');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 To enable Google OAuth:');
    console.log('   1. Go to Google Cloud Console: https://console.cloud.google.com/');
    console.log('   2. Create OAuth 2.0 credentials');
    console.log('   3. Set authorized redirect URI to:');
    console.log('      https://<your-project-ref>.supabase.co/auth/v1/callback');
    console.log('   4. In Supabase Dashboard → Authentication → Providers → Google');
    console.log('   5. Enable Google and add your Client ID and Secret\n');
    console.log('📝 To enable Email/Password auth:');
    console.log('   1. Go to Supabase Dashboard → Authentication → Providers → Email');
    console.log('   2. Enable Email provider (enabled by default)');
    console.log('   3. Configure email templates as needed\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations().catch(console.error);
