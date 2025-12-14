import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { profileRoutes } from './routes/profile';
import { siweRoutes } from './routes/siwe';
import { walletRoutes } from './routes/wallets';
import { adminRoutes } from './routes/admin';
import { botRoutes } from './routes/bot';
import { runScreening } from './cron/screening';

export interface Env {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
    ADMIN_TOKEN: string;
    ADMIN_TELEGRAM_HANDLE: string;
    MONAD_RPC_URL: string;
    MONAD_CHAIN_ID: string;
    CHOG_CONTRACT: string;
    ELIGIBILITY_THRESHOLD: string;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for frontend
app.use('*', cors({
    origin: (origin) => {
        const allowed = [
            'https://chogwatch.pages.dev',
            'http://localhost:3000',
        ];
        // Allow exact matches
        if (allowed.includes(origin)) return origin;
        // Allow preview deployments (e.g., abc123.chogwatch.pages.dev)
        if (/^https:\/\/[a-z0-9]+\.chogwatch\.pages\.dev$/.test(origin)) return origin;
        return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// Mount routes
app.route('/api/profile', profileRoutes);
app.route('/api/siwe', siweRoutes);
app.route('/api/wallets', walletRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/bot', botRoutes);

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
});

export default {
    fetch: app.fetch,

    // Cron trigger handler
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(runScreening(env));
    },
};
