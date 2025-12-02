#!/usr/bin/env node

import { config } from 'dotenv';
import { readFileSync } from 'fs';
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
    console.log('🔍 Checking for pg_cron, pg_net, and vector extensions...');
    const { rows: extensions } = await client.query(`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net', 'vector');
    `);

    const hasPgCron = extensions.some(e => e.extname === 'pg_cron');
    const hasPgNet = extensions.some(e => e.extname === 'pg_net');
    const hasVector = extensions.some(e => e.extname === 'vector');

    if (!hasVector) {
      console.log('⚠️  pgvector extension not enabled\n');
      console.log('📝 To enable vector embeddings:');
      console.log('   1. Go to Supabase Dashboard → Database → Extensions');
      console.log('   2. Enable the "vector" extension');
      console.log('   3. Run this script again: npm run setup:db\n');
    } else {
      console.log('✅ pgvector extension enabled!\n');
    }

    if (hasPgCron && hasPgNet) {
      console.log('✅ Scheduling extensions (pg_cron, pg_net) already enabled!\n');

      // Set up cron job for scout executions
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseAnonKey) {
        console.log('⏰ Setting up cron job for scout executions...');
        try {
          // Remove existing jobs if they exist (both old hourly and new 5min)
          await client.query(`
            SELECT cron.unschedule('scout-cron-hourly');
          `);
        } catch {
          // Job doesn't exist, that's fine
        }

        try {
          await client.query(`
            SELECT cron.unschedule('scout-cron-5min');
          `);
        } catch {
          // Job doesn't exist, that's fine
        }

        try {
          // Create cron job to trigger scout executions every 5 minutes
          await client.query(`
            SELECT cron.schedule(
              'scout-cron-5min',
              '*/5 * * * *',
              $$
                SELECT net.http_post(
                  url:='${supabaseUrl}/functions/v1/scout-cron',
                  headers:=jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ${supabaseAnonKey}'
                  ),
                  body:='{}'::jsonb,
                  timeout_milliseconds:=150000
                );
              $$
            );
          `);
          console.log('✅ Cron job created! Scouts will run every 5 minutes.\n');
        } catch (cronError) {
          console.log('⚠️  Could not create cron job:', cronError.message);
          console.log('   You can create it manually in the SQL Editor\n');
        }
      } else {
        console.log('⚠️  Skipping cron setup (missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY)\n');
      }
    } else {
      console.log('⚠️  Scheduling extensions not enabled yet\n');
      console.log('📝 To enable automatic scheduling:');
      console.log('   1. Go to Supabase Dashboard → Database → Extensions');
      console.log(`   2. Enable these extensions: ${!hasPgCron ? 'pg_cron' : ''}${!hasPgCron && !hasPgNet ? ' and ' : ''}${!hasPgNet ? 'pg_net' : ''}`);
      console.log('   3. Run this script again: npm run setup:db\n');
      console.log('   Or use the "Run Now" button in the UI for manual execution.\n');
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
