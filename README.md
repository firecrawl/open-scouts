# Open Scouts

Create AI scouts that continuously search the web and notify you when they find what you're looking for.

![open-scouts_4](https://github.com/user-attachments/assets/a1ff82ef-97e4-469b-9712-99d0367755a7)

## About

Open Scouts is an AI-powered monitoring platform that lets you create "scouts" - automated tasks that run on a schedule to continuously search for and track information. Whether you're looking for new restaurants near you, monitoring AI news, or tracking any other updates, scouts work 24/7 to find what you need and notify you when they discover it.

## Tech Stack

- **Next.js 15**
- **React 19**
- **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (Database + Auth + Edge Functions)
- **pgvector** (Vector embeddings for semantic search)
- **Firecrawl SDK** (@mendable/firecrawl-js)
- **OpenAI API** (AI Agent + Embeddings)
- **Resend** (Email Notifications)

## Getting Started

### Prerequisites

- Node.js 18+
- bun (default), npm, or pnpm
- Supabase account ([supabase.com](https://supabase.com))
- OpenAI API key ([platform.openai.com](https://platform.openai.com))
- Firecrawl API key ([firecrawl.dev](https://firecrawl.dev))
- Resend API key ([resend.com](https://resend.com)) - for email notifications
- Google Cloud Console account (for Google OAuth - optional)

### 1. Clone and Install

```bash
git clone https://github.com/firecrawl/open-scouts
cd open-scouts
bun install  # or: npm install / pnpm install
```

### 2. Create Supabase Project

1. Go to [supabase.com](https://supabase.com/dashboard)
2. Create a new project
3. Wait for the project to finish provisioning

### 3. Enable Required Extensions

In your Supabase Dashboard:

1. Go to **Database → Extensions**
2. Search for and enable:
   - `pg_cron` (for scheduled jobs)
   - `pg_net` (for HTTP requests from database)
   - `vector` (for AI-powered semantic search on execution summaries)
   - `supabase_vault` (for secure credential storage - usually enabled by default)

### 4. Set Up Environment Variables

Create a `.env` file in the root directory by copying the example file:

```bash
cp .env.example .env
```

Then fill in your actual values in the `.env` file.

**The `.env.example` file contains all required environment variables with detailed instructions and direct links for where to obtain each API key.**

### 5. Run Database Setup

First, link your Supabase project (required for syncing secrets):

```bash
bunx supabase login        # Login to Supabase CLI (one-time)
bunx supabase link --project-ref <your-project-ref>  # Find ref in Supabase Dashboard URL
```

Then run the setup script:

```bash
bun run setup:db  # or: npm run setup:db / pnpm run setup:db
```

This will:
- Create all required tables (`scouts`, `scout_executions`, `scout_execution_steps`, etc.)
- Add user authentication support (user_id columns, Row Level Security)
- Enable real-time subscriptions
- Set up vector embeddings for AI-generated execution summaries
- Configure the **scalable dispatcher architecture** (pg_cron + pg_net + vault)
- Automatically store your Supabase URL and service role key in the vault
- Set up cron jobs for scout dispatching and cleanup
- **Sync Edge Function secrets** from your `.env` file (OPENAI_API_KEY, FIRECRAWL_API_KEY, RESEND_API_KEY)

**Note:** The setup script will check if the required extensions (`vector`, `pg_cron`, `pg_net`) are enabled. If not, follow the on-screen instructions to enable them in the Supabase Dashboard, then run the script again.

### 6. Set Up Authentication

Open Scouts uses Supabase Auth for user authentication, supporting both email/password and Google OAuth.

#### Enable Email/Password Auth (Enabled by Default)

1. Go to Supabase Dashboard → **Authentication** → **Providers** → **Email**
2. Ensure "Enable Email Provider" is toggled on
3. Configure email templates as needed in **Authentication** → **Email Templates**

#### Enable Google OAuth (Optional but Recommended)

1. **Create Google OAuth Credentials:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Navigate to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **OAuth client ID**
   - Choose "Web application" as Application type
   - Add authorized JavaScript origins:
     - `http://localhost:3000` (development)
     - `https://your-domain.com` (production)
   - Add authorized redirect URIs:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client Secret**

2. **Configure in Supabase:**
   - Go to Supabase Dashboard → **Authentication** → **Providers** → **Google**
   - Toggle "Enable Google Provider"
   - Paste your Client ID and Client Secret
   - Save

### 7. Deploy Edge Functions

Deploy the scout execution agent and email functions to Supabase Cloud:

```bash
bunx supabase functions deploy scout-cron
bunx supabase functions deploy send-test-email
```

**Note:** Secrets (OPENAI_API_KEY, FIRECRAWL_API_KEY, RESEND_API_KEY) are automatically synced when you run `setup:db`. If you need to update them manually:

```bash
bunx supabase secrets set OPENAI_API_KEY=sk-proj-...
```

### 8. Set Up Resend (Email Notifications)

Email notifications are sent to your account email when scouts find results.

1. **Create a Resend account** at [resend.com](https://resend.com)
2. **Get your API key** from the Resend dashboard
3. **Add to `.env`** and run `setup:db` again to sync, or set manually:
   ```bash
   bunx supabase secrets set RESEND_API_KEY=re_...
   ```
4. **Verify a custom domain** at [resend.com/domains](https://resend.com/domains) to send to any email

**Important - Free Tier Limitations:**
- Without a verified domain, Resend only sends to your Resend account email
- Free tier includes 3,000 emails/month (100/day limit)

**Testing Email Setup:**
1. Go to **Settings** in the app
2. Click **Send Test Email** to verify the configuration
3. Check your inbox for the test email

### 9. Firecrawl Configuration

Open Scouts uses [Firecrawl](https://firecrawl.dev) for web scraping and search.

> **📌 Important: No Environment Variable Configuration Required**
>
> **You do NOT need to configure a Firecrawl API key in your environment variables.** Each user can simply add their own custom Firecrawl API key directly in the **Settings** page within the app. This is the recommended approach for most users.

#### Custom API Key (Recommended)

The simplest way to use Open Scouts:

1. Sign up at [firecrawl.dev](https://firecrawl.dev)
2. Get your API key from the [dashboard](https://www.firecrawl.dev/app/api-keys)
3. Go to **Settings** in the Open Scouts app
4. Enter your Firecrawl API key in the **Firecrawl Integration** section
5. Click **Save** - you're ready to go!

Each user manages their own API key, and usage is tracked to their individual Firecrawl account.

#### Server-Side API Key (Optional - For Self-Hosting)

If you're self-hosting and want to provide a shared API key for all users:

1. Sign up at [firecrawl.dev](https://firecrawl.dev)
2. Get your API key from the [dashboard](https://www.firecrawl.dev/app/api-keys)
3. Add to your `.env` file:
   ```bash
   FIRECRAWL_API_KEY=fc-your-key-here
   ```
4. Set the edge function secret:
   ```bash
   npx supabase secrets set FIRECRAWL_API_KEY=fc-your-key-here
   ```

**Note:** Users who add their own custom API key in Settings will use their personal key instead of the server-side shared key.

#### Partner Integration (Enterprise - Closed Beta)

> **⚠️ The Partner Key feature is currently in closed beta and only available for enterprise customers.** This feature is not publicly available.

**How Partner Integration Works (when available):**
- When users sign up, a unique Firecrawl API key is automatically created for them
- Each user's usage is tracked separately
- Keys are stored securely in the `user_preferences` table
- If a user's key fails, the system automatically falls back to the shared partner key
- Users can view their connection status in **Settings → Firecrawl Integration**

### 10. Run the Development Server

```bash
bun run dev  # or: npm run dev / pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## How It Works

### User Authentication Flow

1. **Public Home Page**: Users can browse the landing page without signing in
2. **Create Scout**: When a user types a query and hits Enter, they're prompted to sign in
3. **Sign In/Sign Up**: Users can authenticate via email/password or Google OAuth
4. **Continue Flow**: After authentication, the scout creation continues automatically
5. **User Isolation**: Each user only sees and manages their own scouts

### Scout System

1. **Create a Scout**: Define what you want to monitor (e.g., "Scout for any recent Indian restaurants near me" or "Scout for any AI news")
2. **AI Agent Setup**: The system automatically configures search queries and strategies
3. **Set Frequency**: Choose how often to run (hourly, every 3 days, weekly)
4. **Configure Notifications**: Add your email in Settings to receive alerts when scouts find results
5. **Continuous Monitoring**: The dispatcher checks every minute and triggers due scouts individually
6. **AI Summaries**: Each successful execution generates a concise one-sentence summary with semantic embeddings
7. **Get Notified**: Receive email alerts when scouts find new results (if email is configured)
8. **View Results**: See all findings with AI-generated summaries in real-time on the scout page

### Manual Execution

Click the **"Run Now"** button on any scout page to trigger execution immediately without waiting for the cron.

### Email Notifications

When scouts find results, you'll automatically receive email alerts at your account email:

- **Automatic**: Emails are sent only when scouts successfully find results
- **Rich Content**: Beautiful HTML emails with scout results and links
- **Test**: Use the "Send Test Email" button in Settings to verify setup

**Email Service**: Powered by Resend (free tier includes 3,000 emails/month)

**Note:** On Resend's free tier without a verified domain, emails can only be sent to your Resend account email. Verify a custom domain at [resend.com/domains](https://resend.com/domains) to send to any email.

### Architecture

- **Frontend**: Next.js app with real-time updates via Supabase Realtime
- **Database**: PostgreSQL (Supabase) with pg_cron for scheduling and pgvector for semantic search
- **Authentication**: Supabase Auth (Email/Password + Google OAuth)
- **AI Agent**: OpenAI GPT-4 with function calling (search & scrape tools)
- **AI Summaries**: Auto-generated one-sentence summaries with vector embeddings for each successful execution
- **Edge Function**: Deno-based serverless function that orchestrates agent execution
- **Web Scraping**: Firecrawl API for search and content extraction (supports per-user API keys via partner integration)

#### Scalable Dispatcher Architecture

Open Scouts uses a dispatcher pattern designed to scale to thousands of scouts:

```
Every minute:
pg_cron → dispatch_due_scouts() → finds due scouts → pg_net HTTP POST
                                                          ↓
                                    ┌──────────────────────┼──────────────────────┐
                                    ↓                      ↓                      ↓
                              Edge Function          Edge Function          Edge Function
                              (scout A)              (scout B)              (scout C)
                              [isolated]             [isolated]             [isolated]
```

- **Dispatcher (SQL)**: Runs every minute via pg_cron, queries for due scouts, and fires individual HTTP requests
- **Isolated Execution**: Each scout runs in its own edge function invocation with full resources (256MB memory, 400s timeout)
- **Automatic Cleanup**: A separate cron job cleans up stuck executions every 5 minutes
- **Vault Integration**: Supabase credentials are securely stored in the vault and read by the dispatcher

## Security

- **Row Level Security (RLS)**: All database tables have RLS policies ensuring users can only access their own data
- **User Isolation**: Scouts, messages, and executions are all tied to authenticated users
- **Secure Auth Flow**: OAuth tokens and sessions are managed by Supabase Auth
- **Service Role**: Server-side operations (cron jobs, edge functions) use service role for privileged access
- **API Key Storage**: Firecrawl API keys (when using partner integration) are stored server-side in `user_preferences` and never exposed to the client

## Build for Production

```bash
bun run build  # or: npm run build / pnpm run build
bun start      # or: npm start / pnpm start
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
