// Admin routes with OTP authentication
import { Hono } from 'hono';
import type { Env } from '../index';
import { runScreening } from '../cron/screening';
import { generateId, generateOTP, hashSecret, verifySecret, generateSecret } from '../lib/crypto';
import { sendTelegramMessage, getChat, kickChatMember } from '../lib/telegram';
import { getChogTotalSupply, formatChogBalance } from '../lib/chog';

export const adminRoutes = new Hono<{ Bindings: Env }>();

// Types for admin sessions
interface AdminSession {
    id: string;
    otp_hash: string;
    telegram_handle: string;
    created_at: number;
    expires_at: number;
    verified_at: number | null;
    session_token_hash: string | null;
}

// OTP expiry: 5 minutes
const OTP_EXPIRY_MS = 5 * 60 * 1000;
// Session expiry: 24 hours
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Helper to verify session token
 */
async function verifyAdminSession(db: D1Database, token: string): Promise<AdminSession | null> {
    const tokenHash = await hashSecret(token);
    const session = await db.prepare(
        `SELECT * FROM admin_sessions 
         WHERE session_token_hash = ? AND verified_at IS NOT NULL AND expires_at > ?`
    ).bind(tokenHash, Date.now()).first<AdminSession>();
    return session || null;
}

/**
 * Helper to get the group chat ID - checks DB first, falls back to env
 */
export async function getGroupChatId(db: D1Database, envChatId: string): Promise<string> {
    const setting = await db.prepare(
        `SELECT value FROM settings WHERE key = 'telegram_chat_id'`
    ).first<{ value: string }>();
    return setting?.value || envChatId;
}

/**
 * Auth middleware - skips for auth endpoints
 */
adminRoutes.use('*', async (c, next) => {
    const path = c.req.path;

    // Skip auth for OTP request/verify endpoints
    if (path.endsWith('/auth/request-otp') || path.endsWith('/auth/verify-otp')) {
        return next();
    }

    // Check for session token
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.slice(7);

    // First try legacy ADMIN_TOKEN for backwards compatibility
    if (token === c.env.ADMIN_TOKEN) {
        return next();
    }

    // Then try session token
    const session = await verifyAdminSession(c.env.DB, token);
    if (!session) {
        return c.json({ error: 'Invalid or expired session' }, 403);
    }

    return next();
});

/**
 * POST /api/admin/auth/request-otp
 * Request an OTP code sent to Telegram
 */
adminRoutes.post('/auth/request-otp', async (c) => {
    const body = await c.req.json<{ telegram_handle: string }>();

    if (!body.telegram_handle) {
        return c.json({ error: 'telegram_handle is required' }, 400);
    }

    // Normalize handle
    let handle = body.telegram_handle.trim().toLowerCase();
    if (handle.startsWith('@')) {
        handle = handle.slice(1);
    }

    // Bootstrap first admin if admins table is empty
    const adminCount = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM admins'
    ).first<{ count: number }>();

    if (adminCount && adminCount.count === 0 && c.env.ADMIN_TELEGRAM_HANDLE) {
        // Bootstrap first admin from env var
        const bootstrapHandle = c.env.ADMIN_TELEGRAM_HANDLE.toLowerCase().replace('@', '');
        await c.env.DB.prepare(
            'INSERT INTO admins (id, telegram_handle, added_at) VALUES (?, ?, ?)'
        ).bind(generateId(), bootstrapHandle, Date.now()).run();
        console.log('Bootstrapped first admin:', bootstrapHandle);
    }

    // Check if this handle is an admin
    const admin = await c.env.DB.prepare(
        'SELECT * FROM admins WHERE LOWER(telegram_handle) = ?'
    ).bind(handle).first<{ id: string; telegram_handle: string; telegram_user_id: number | null }>();

    if (!admin) {
        // Don't reveal if the handle is wrong - just say OTP sent
        return c.json({ success: true, message: 'If this handle is registered, an OTP has been sent' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = await hashSecret(otp);
    const sessionId = generateId();
    const now = Date.now();

    // Store OTP session
    await c.env.DB.prepare(
        `INSERT INTO admin_sessions (id, otp_hash, telegram_handle, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
    ).bind(sessionId, otpHash, handle, now, now + OTP_EXPIRY_MS).run();

    // Clean up old sessions
    await c.env.DB.prepare(
        'DELETE FROM admin_sessions WHERE expires_at < ?'
    ).bind(now - SESSION_EXPIRY_MS).run();

    // Send OTP via Telegram - require DM registration
    const message = `🔐 *CHOG Admin OTP*\n\nYour one-time code is: \`${otp}\`\n\nThis code expires in 5 minutes.`;

    if (!admin.telegram_user_id) {
        // Admin hasn't registered with the bot yet
        return c.json({
            error: 'Please send /admin to the bot first to enable OTP delivery',
            needs_registration: true
        }, 400);
    }

    // Send via DM
    const sendResult = await sendTelegramMessage(
        c.env.TELEGRAM_BOT_TOKEN,
        String(admin.telegram_user_id),
        message
    );

    if (!sendResult.success) {
        console.error('Failed to send OTP:', sendResult.error);
    }

    // Update last_login_at
    await c.env.DB.prepare(
        'UPDATE admins SET last_login_at = ? WHERE id = ?'
    ).bind(now, admin.id).run();

    return c.json({
        success: true,
        message: 'If this handle is registered, an OTP has been sent',
        session_id: sessionId
    });
});

/**
 * POST /api/admin/auth/verify-otp
 * Verify OTP and get session token
 */
adminRoutes.post('/auth/verify-otp', async (c) => {
    const body = await c.req.json<{ session_id: string; otp: string }>();

    if (!body.session_id || !body.otp) {
        return c.json({ error: 'session_id and otp are required' }, 400);
    }

    // Find the session
    const session = await c.env.DB.prepare(
        `SELECT * FROM admin_sessions 
         WHERE id = ? AND verified_at IS NULL AND expires_at > ?`
    ).bind(body.session_id, Date.now()).first<AdminSession>();

    if (!session) {
        return c.json({ error: 'Invalid or expired OTP session' }, 400);
    }

    // Verify OTP
    const otpValid = await verifySecret(body.otp, session.otp_hash);
    if (!otpValid) {
        return c.json({ error: 'Invalid OTP' }, 400);
    }

    // Generate session token
    const sessionToken = generateSecret(48);
    const sessionTokenHash = await hashSecret(sessionToken);
    const now = Date.now();

    // Update session with token
    await c.env.DB.prepare(
        `UPDATE admin_sessions 
         SET verified_at = ?, session_token_hash = ?, expires_at = ?
         WHERE id = ?`
    ).bind(now, sessionTokenHash, now + SESSION_EXPIRY_MS, session.id).run();

    return c.json({
        success: true,
        session_token: sessionToken,
        expires_at: now + SESSION_EXPIRY_MS
    });
});

/**
 * POST /api/admin/auth/logout
 * Invalidate session
 */
adminRoutes.post('/auth/logout', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const tokenHash = await hashSecret(token);
        await c.env.DB.prepare(
            'DELETE FROM admin_sessions WHERE session_token_hash = ?'
        ).bind(tokenHash).run();
    }
    return c.json({ success: true });
});

/**
 * POST /api/admin/screening/run-now
 * Manually trigger a screening run
 */
adminRoutes.post('/screening/run-now', async (c) => {
    try {
        const result = await runScreening(c.env, true); // force=true for manual runs
        return c.json({ success: true, result });
    } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error }, 500);
    }
});

/**
 * GET /api/admin/stats
 * Get screening run stats
 */
adminRoutes.get('/stats', async (c) => {
    const { results: runs } = await c.env.DB.prepare(
        'SELECT * FROM screening_runs ORDER BY started_at DESC LIMIT 10'
    ).all();

    const { results: settings } = await c.env.DB.prepare(
        'SELECT * FROM settings'
    ).all();

    const profileCount = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM profiles'
    ).first<{ count: number }>();

    const walletCount = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM wallets WHERE status = ?'
    ).bind('verified').first<{ count: number }>();

    return c.json({
        recent_runs: runs,
        settings: Object.fromEntries(settings.map((s: any) => [s.key, s.value])),
        profile_count: profileCount?.count || 0,
        wallet_count: walletCount?.count || 0,
    });
});

/**
 * GET /api/admin/wallets
 * List all wallets with pagination
 */
adminRoutes.get('/wallets', async (c) => {
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const search = c.req.query('search') || '';
    const offset = (page - 1) * limit;

    let query = `
        SELECT w.*, p.telegram_handle 
        FROM wallets w
        LEFT JOIN profiles p ON w.profile_id = p.id
    `;
    let countQuery = 'SELECT COUNT(*) as count FROM wallets w';
    const bindings: any[] = [];

    if (search) {
        query += ` WHERE w.address LIKE ? OR p.telegram_handle LIKE ?`;
        countQuery += ` LEFT JOIN profiles p ON w.profile_id = p.id WHERE w.address LIKE ? OR p.telegram_handle LIKE ?`;
        bindings.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY w.created_at DESC LIMIT ? OFFSET ?`;

    // Get total count
    const countResult = search
        ? await c.env.DB.prepare(countQuery).bind(...bindings).first<{ count: number }>()
        : await c.env.DB.prepare(countQuery).first<{ count: number }>();

    // Get wallets
    const { results: wallets } = await c.env.DB.prepare(query)
        .bind(...bindings, limit, offset)
        .all();

    return c.json({
        wallets,
        pagination: {
            page,
            limit,
            total: countResult?.count || 0,
            pages: Math.ceil((countResult?.count || 0) / limit)
        }
    });
});

/**
 * GET /api/admin/settings
 * Get all settings
 */
adminRoutes.get('/settings', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM settings').all();
    return c.json({
        settings: Object.fromEntries(results.map((s: any) => [s.key, s.value]))
    });
});

/**
 * PUT /api/admin/settings/:key
 * Update a setting
 */
adminRoutes.put('/settings/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<{ value: string }>();

    if (!body.value) {
        return c.json({ error: 'value is required' }, 400);
    }

    // Validate known settings
    const allowedSettings = [
        'screening_interval_hours',
        'eligibility_threshold_raw',
        'chog_decimals',
        'bot_notifications_enabled',
        'msg_template_eligibility',
        'msg_template_welcome',
        'msg_template_status',
        'telegram_chat_id'
    ];
    if (!allowedSettings.includes(key)) {
        return c.json({ error: 'Unknown setting key' }, 400);
    }

    await c.env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).bind(key, body.value).run();

    return c.json({ success: true, key, value: body.value });
});

/**
 * GET /api/admin/admins
 * List all admins
 */
adminRoutes.get('/admins', async (c) => {
    const { results: admins } = await c.env.DB.prepare(
        'SELECT id, telegram_handle, added_at, last_login_at FROM admins ORDER BY added_at'
    ).all();

    return c.json({ admins });
});

/**
 * POST /api/admin/admins
 * Add a new admin
 */
adminRoutes.post('/admins', async (c) => {
    const body = await c.req.json<{ telegram_handle: string }>();

    if (!body.telegram_handle) {
        return c.json({ error: 'telegram_handle is required' }, 400);
    }

    // Normalize handle
    let handle = body.telegram_handle.trim().toLowerCase();
    if (handle.startsWith('@')) {
        handle = handle.slice(1);
    }

    // Validate
    if (handle.length < 5 || handle.length > 32) {
        return c.json({ error: 'Username must be between 5 and 32 characters' }, 400);
    }
    if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
        return c.json({ error: 'Username can only contain letters, numbers, and underscores' }, 400);
    }

    // Check if already exists
    const existing = await c.env.DB.prepare(
        'SELECT id FROM admins WHERE LOWER(telegram_handle) = ?'
    ).bind(handle).first();

    if (existing) {
        return c.json({ error: 'Admin already exists' }, 400);
    }

    // Get current admin's ID from session
    const authHeader = c.req.header('Authorization');
    let addedBy = null;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const session = await verifyAdminSession(c.env.DB, token);
        if (session) {
            const currentAdmin = await c.env.DB.prepare(
                'SELECT id FROM admins WHERE LOWER(telegram_handle) = ?'
            ).bind(session.telegram_handle).first<{ id: string }>();
            addedBy = currentAdmin?.id;
        }
    }

    // Add new admin
    const adminId = generateId();
    await c.env.DB.prepare(
        'INSERT INTO admins (id, telegram_handle, added_by, added_at) VALUES (?, ?, ?, ?)'
    ).bind(adminId, handle, addedBy, Date.now()).run();

    return c.json({ success: true, admin_id: adminId, telegram_handle: handle });
});

/**
 * DELETE /api/admin/admins/:id
 * Remove an admin (cannot remove yourself)
 */
adminRoutes.delete('/admins/:id', async (c) => {
    const adminId = c.req.param('id');

    // Get current admin from session
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice(7);
    const session = await verifyAdminSession(c.env.DB, token);
    if (!session) {
        return c.json({ error: 'Invalid session' }, 403);
    }

    const currentAdmin = await c.env.DB.prepare(
        'SELECT id FROM admins WHERE LOWER(telegram_handle) = ?'
    ).bind(session.telegram_handle).first<{ id: string }>();

    if (!currentAdmin) {
        return c.json({ error: 'Current admin not found' }, 403);
    }

    // Cannot remove yourself
    if (currentAdmin.id === adminId) {
        return c.json({ error: 'Cannot remove yourself' }, 400);
    }

    // Check that at least one admin will remain
    const adminCount = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM admins'
    ).first<{ count: number }>();

    if (adminCount && adminCount.count <= 1) {
        return c.json({ error: 'Cannot remove the last admin' }, 400);
    }

    // Remove admin
    await c.env.DB.prepare(
        'DELETE FROM admins WHERE id = ?'
    ).bind(adminId).run();

    return c.json({ success: true });
});

// ============== NEW ENDPOINTS ==============

/**
 * GET /api/admin/profiles
 * List profiles ranked by total CHOG with wallet counts and 7-day change
 */
adminRoutes.get('/profiles', async (c) => {
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const search = c.req.query('search') || '';
    const offset = (page - 1) * limit;

    // Get the most recent screening run for current balances
    const latestRun = await c.env.DB.prepare(
        `SELECT id, started_at FROM screening_runs WHERE status = 'success' ORDER BY started_at DESC LIMIT 1`
    ).first<{ id: string; started_at: number }>();

    // Get run from 7 days ago for comparison
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const oldRun = await c.env.DB.prepare(
        `SELECT id FROM screening_runs WHERE status = 'success' AND started_at <= ? ORDER BY started_at DESC LIMIT 1`
    ).bind(sevenDaysAgo).first<{ id: string }>();

    // Build the query
    let baseQuery = `
        SELECT 
            p.id,
            p.telegram_handle,
            p.created_at,
            COUNT(w.id) as wallet_count,
            ps.total_chog_raw,
            ps_old.total_chog_raw as old_total_chog_raw,
            gm.telegram_user_id,
            CASE 
                WHEN gm.telegram_user_id IS NOT NULL AND gm.left_at IS NULL THEN 1
                WHEN gm.telegram_user_id IS NOT NULL AND gm.left_at IS NOT NULL THEN 0
                ELSE -1
            END as in_group
        FROM profiles p
        LEFT JOIN wallets w ON p.id = w.profile_id
        LEFT JOIN profile_snapshots ps ON p.id = ps.profile_id AND ps.run_id = ?
        LEFT JOIN profile_snapshots ps_old ON p.id = ps_old.profile_id AND ps_old.run_id = ?
        LEFT JOIN group_members gm ON LOWER(REPLACE(p.telegram_handle, '@', '')) = LOWER(gm.telegram_username)
    `;

    const bindings: any[] = [latestRun?.id || '', oldRun?.id || ''];

    if (search) {
        baseQuery += ` WHERE LOWER(p.telegram_handle) LIKE LOWER(?)`;
        bindings.push(`%${search}%`);
    }

    baseQuery += ` GROUP BY p.id ORDER BY CAST(COALESCE(ps.total_chog_raw, '0') AS INTEGER) DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const { results: profiles } = await c.env.DB.prepare(baseQuery).bind(...bindings).all();

    // Get total count
    let countQuery = `SELECT COUNT(DISTINCT p.id) as count FROM profiles p`;
    if (search) {
        countQuery += ` WHERE LOWER(p.telegram_handle) LIKE LOWER(?)`;
    }
    const countResult = search
        ? await c.env.DB.prepare(countQuery).bind(`%${search}%`).first<{ count: number }>()
        : await c.env.DB.prepare(countQuery).first<{ count: number }>();

    return c.json({
        profiles: profiles.map((p: any) => ({
            ...p,
            change_7d: p.total_chog_raw && p.old_total_chog_raw
                ? (BigInt(p.total_chog_raw) - BigInt(p.old_total_chog_raw)).toString()
                : null
        })),
        pagination: {
            page,
            limit,
            total: countResult?.count || 0,
            pages: Math.ceil((countResult?.count || 0) / limit)
        },
        last_updated: latestRun?.started_at || null
    });
});

/**
 * GET /api/admin/profiles/:id/wallets
 * Get wallet details for a specific profile
 */
adminRoutes.get('/profiles/:id/wallets', async (c) => {
    const profileId = c.req.param('id');

    const { results: wallets } = await c.env.DB.prepare(`
        SELECT 
            id,
            address,
            last_total_chog_raw,
            last_direct_chog_raw,
            last_lp_chog_raw,
            last_checked_at,
            created_at,
            status
        FROM wallets
        WHERE profile_id = ?
        ORDER BY CAST(COALESCE(last_total_chog_raw, '0') AS INTEGER) DESC
    `).bind(profileId).all();

    return c.json({ wallets });
});

/**
 * GET /api/admin/whale-ownership
 * Get whale ownership as percentage of total supply
 */
adminRoutes.get('/whale-ownership', async (c) => {
    // Get total CHOG held by all profiles (whales) - fetch as strings to avoid overflow
    const { results: snapshots } = await c.env.DB.prepare(`
        SELECT ps.total_chog_raw
        FROM profile_snapshots ps
        INNER JOIN (
            SELECT profile_id, MAX(run_id) as latest_run
            FROM profile_snapshots
            GROUP BY profile_id
        ) latest ON ps.profile_id = latest.profile_id AND ps.run_id = latest.latest_run
    `).all<{ total_chog_raw: string }>();

    // Sum using BigInt to avoid overflow
    let whaleTotal = 0n;
    for (const s of snapshots) {
        if (s.total_chog_raw) {
            try {
                whaleTotal += BigInt(s.total_chog_raw);
            } catch {
                // Skip invalid values
            }
        }
    }

    // Get total CHOG supply from contract
    let totalSupply = 0n;
    try {
        totalSupply = await getChogTotalSupply(c.env.MONAD_RPC_URL, c.env.CHOG_CONTRACT);
    } catch (err) {
        console.error('Failed to fetch total supply:', err);
    }

    const percentage = totalSupply > 0n
        ? Number((whaleTotal * 10000n) / totalSupply) / 100
        : 0;

    return c.json({
        whale_total_raw: whaleTotal.toString(),
        whale_total_formatted: formatChogBalance(whaleTotal),
        total_supply_raw: totalSupply.toString(),
        total_supply_formatted: formatChogBalance(totalSupply),
        percentage: percentage.toFixed(2)
    });
});

/**
 * GET /api/admin/kick-add-lists
 * Get lists of users to kick from or add to the group
 */
adminRoutes.get('/kick-add-lists', async (c) => {
    // Get eligibility threshold
    const thresholdSetting = await c.env.DB.prepare(
        `SELECT value FROM settings WHERE key = 'eligibility_threshold_raw'`
    ).first<{ value: string }>();
    const threshold = BigInt(thresholdSetting?.value || '1000000000000000000000000');

    const now = Date.now();

    // Users in group but NOT eligible (to kick)
    // Also find when they first dropped below threshold
    const { results: toKick } = await c.env.DB.prepare(`
        SELECT 
            gm.telegram_username,
            gm.telegram_user_id,
            gm.first_name,
            ps.total_chog_raw,
            first_ineligible.first_ineligible_at
        FROM group_members gm
        LEFT JOIN profiles p ON LOWER(REPLACE(p.telegram_handle, '@', '')) = LOWER(gm.telegram_username)
        LEFT JOIN profile_snapshots ps ON p.id = ps.profile_id
        LEFT JOIN (
            SELECT profile_id, MAX(run_id) as latest_run
            FROM profile_snapshots
            GROUP BY profile_id
        ) latest ON ps.profile_id = latest.profile_id AND ps.run_id = latest.latest_run
        LEFT JOIN (
            -- Find the first screening run where the user was ineligible
            SELECT 
                ps2.profile_id,
                MIN(sr.started_at) as first_ineligible_at
            FROM profile_snapshots ps2
            INNER JOIN screening_runs sr ON ps2.run_id = sr.id
            WHERE ps2.eligible = 0
            GROUP BY ps2.profile_id
        ) first_ineligible ON p.id = first_ineligible.profile_id
        WHERE gm.left_at IS NULL
        AND (p.id IS NULL OR CAST(COALESCE(ps.total_chog_raw, '0') AS INTEGER) < ?)
    `).bind(threshold.toString()).all();

    // Calculate days below threshold for each user
    const toKickWithDays = toKick.map((user: any) => ({
        ...user,
        days_below_threshold: user.first_ineligible_at
            ? Math.floor((now - user.first_ineligible_at) / (24 * 60 * 60 * 1000))
            : null
    }));

    // Users eligible but NOT in group (to add)
    const { results: toAdd } = await c.env.DB.prepare(`
        SELECT 
            p.telegram_handle,
            ps.total_chog_raw
        FROM profiles p
        INNER JOIN profile_snapshots ps ON p.id = ps.profile_id
        INNER JOIN (
            SELECT profile_id, MAX(run_id) as latest_run
            FROM profile_snapshots
            GROUP BY profile_id
        ) latest ON ps.profile_id = latest.profile_id AND ps.run_id = latest.latest_run
        LEFT JOIN group_members gm ON LOWER(REPLACE(p.telegram_handle, '@', '')) = LOWER(gm.telegram_username) AND gm.left_at IS NULL
        WHERE CAST(ps.total_chog_raw AS INTEGER) >= ?
        AND gm.telegram_user_id IS NULL
    `).bind(threshold.toString()).all();

    return c.json({
        to_kick: toKickWithDays,
        to_add: toAdd,
        threshold_raw: threshold.toString(),
        threshold_formatted: formatChogBalance(threshold)
    });
});


/**
 * GET /api/admin/group-info
 * Get linked Telegram group info
 */
adminRoutes.get('/group-info', async (c) => {
    const chatId = await getGroupChatId(c.env.DB, c.env.TELEGRAM_CHAT_ID);

    if (!chatId) {
        return c.json({ error: 'No Telegram chat configured' }, 400);
    }

    const result = await getChat(c.env.TELEGRAM_BOT_TOKEN, chatId);

    if (!result.success) {
        return c.json({
            chat_id: chatId,
            error: result.error
        });
    }

    // Get member count from our tracking
    const memberCount = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM group_members WHERE left_at IS NULL`
    ).first<{ count: number }>();

    return c.json({
        chat_id: result.chat?.id,
        title: result.chat?.title,
        type: result.chat?.type,
        tracked_member_count: memberCount?.count || 0
    });
});

/**
 * POST /api/admin/group-members/import
 * Import group members from CSV (telegram_user_id,username,first_name)
 */
adminRoutes.post('/group-members/import', async (c) => {
    const body = await c.req.json<{ members: Array<{ telegram_user_id: number; username?: string; first_name?: string }> }>();

    if (!body.members || !Array.isArray(body.members)) {
        return c.json({ error: 'members array is required' }, 400);
    }

    const now = Date.now();
    let imported = 0;
    let updated = 0;

    for (const member of body.members) {
        if (!member.telegram_user_id) continue;

        const existing = await c.env.DB.prepare(
            `SELECT telegram_user_id FROM group_members WHERE telegram_user_id = ?`
        ).bind(member.telegram_user_id).first();

        if (existing) {
            // Update existing member
            await c.env.DB.prepare(`
                UPDATE group_members 
                SET telegram_username = ?, first_name = ?, left_at = NULL, updated_at = ?
                WHERE telegram_user_id = ?
            `).bind(
                member.username || null,
                member.first_name || null,
                now,
                member.telegram_user_id
            ).run();
            updated++;
        } else {
            // Insert new member
            await c.env.DB.prepare(`
                INSERT INTO group_members (telegram_user_id, telegram_username, first_name, joined_at, source, updated_at)
                VALUES (?, ?, ?, ?, 'import', ?)
            `).bind(
                member.telegram_user_id,
                member.username || null,
                member.first_name || null,
                now,
                now
            ).run();
            imported++;
        }
    }

    return c.json({ success: true, imported, updated });
});

/**
 * GET /api/admin/group-members/export
 * Export current group members
 */
adminRoutes.get('/group-members/export', async (c) => {
    const { results: members } = await c.env.DB.prepare(`
        SELECT telegram_user_id, telegram_username, first_name, joined_at, source
        FROM group_members
        WHERE left_at IS NULL
        ORDER BY joined_at DESC
    `).all();

    return c.json({ members });
});

/**
 * POST /api/admin/group/validate
 * Validate that the bot can access a chat ID
 */
adminRoutes.post('/group/validate', async (c) => {
    const body = await c.req.json<{ chat_id: string }>();

    if (!body.chat_id) {
        return c.json({ error: 'chat_id is required' }, 400);
    }

    // Clean up the chat ID (remove spaces, handle negative numbers for groups)
    const chatId = body.chat_id.trim();

    // Validate format (should be a number, possibly negative for groups)
    if (!/^-?\d+$/.test(chatId)) {
        return c.json({ error: 'Invalid chat ID format. Should be a number (negative for groups).' }, 400);
    }

    // Try to get chat info
    const result = await getChat(c.env.TELEGRAM_BOT_TOKEN, chatId);

    if (!result.success) {
        return c.json({
            valid: false,
            error: result.error || 'Unable to access this chat. Make sure the bot is added to the group.'
        });
    }

    return c.json({
        valid: true,
        chat_id: result.chat?.id,
        title: result.chat?.title,
        type: result.chat?.type
    });
});

/**
 * POST /api/admin/group/request-migration-otp
 * Request OTP for group migration (reuses existing OTP infrastructure)
 */
adminRoutes.post('/group/request-migration-otp', async (c) => {
    // Get current admin from session
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice(7);
    const session = await verifyAdminSession(c.env.DB, token);
    if (!session) {
        return c.json({ error: 'Invalid session' }, 403);
    }

    const handle = session.telegram_handle;

    // Get admin info
    const admin = await c.env.DB.prepare(
        'SELECT * FROM admins WHERE LOWER(telegram_handle) = ?'
    ).bind(handle).first<{ id: string; telegram_handle: string; telegram_user_id: number | null }>();

    if (!admin) {
        return c.json({ error: 'Admin not found' }, 403);
    }

    if (!admin.telegram_user_id) {
        return c.json({
            error: 'Please send /admin to the bot first to enable OTP delivery',
            needs_registration: true
        }, 400);
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = await hashSecret(otp);
    const migrationSessionId = generateId();
    const now = Date.now();

    // Store OTP session (use same admin_sessions table with a migration flag in the handle)
    await c.env.DB.prepare(
        `INSERT INTO admin_sessions (id, otp_hash, telegram_handle, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
    ).bind(migrationSessionId, otpHash, `migration:${handle}`, now, now + OTP_EXPIRY_MS).run();

    // Send OTP via Telegram DM
    const message = `🔐 *Group Migration OTP*\n\nYour one-time code to confirm group migration is: \`${otp}\`\n\n⚠️ This will change where all bot notifications are sent.\n\nThis code expires in 5 minutes.`;

    const sendResult = await sendTelegramMessage(
        c.env.TELEGRAM_BOT_TOKEN,
        String(admin.telegram_user_id),
        message
    );

    if (!sendResult.success) {
        console.error('Failed to send migration OTP:', sendResult.error);
        return c.json({ error: 'Failed to send OTP' }, 500);
    }

    return c.json({
        success: true,
        session_id: migrationSessionId
    });
});

/**
 * POST /api/admin/group/migrate
 * Migrate to a new group chat (requires OTP verification)
 */
adminRoutes.post('/group/migrate', async (c) => {
    const body = await c.req.json<{
        new_chat_id: string;
        otp: string;
        session_id: string;
    }>();

    if (!body.new_chat_id || !body.otp || !body.session_id) {
        return c.json({ error: 'new_chat_id, otp, and session_id are required' }, 400);
    }

    // Verify the migration OTP session
    const session = await c.env.DB.prepare(
        `SELECT * FROM admin_sessions 
         WHERE id = ? AND verified_at IS NULL AND expires_at > ? AND telegram_handle LIKE 'migration:%'`
    ).bind(body.session_id, Date.now()).first<AdminSession>();

    if (!session) {
        return c.json({ error: 'Invalid or expired migration session' }, 400);
    }

    // Verify OTP
    const otpValid = await verifySecret(body.otp, session.otp_hash);
    if (!otpValid) {
        return c.json({ error: 'Invalid OTP' }, 400);
    }

    // Clean up the chat ID
    const newChatId = body.new_chat_id.trim();

    // Validate format
    if (!/^-?\d+$/.test(newChatId)) {
        return c.json({ error: 'Invalid chat ID format' }, 400);
    }

    // Validate that the bot can access this chat
    const result = await getChat(c.env.TELEGRAM_BOT_TOKEN, newChatId);
    if (!result.success) {
        return c.json({
            error: result.error || 'Unable to access the new chat. Make sure the bot is added to the group.'
        }, 400);
    }

    // Save the new chat ID to settings
    await c.env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).bind('telegram_chat_id', newChatId).run();

    // Mark the OTP session as verified (consumed)
    await c.env.DB.prepare(
        'UPDATE admin_sessions SET verified_at = ? WHERE id = ?'
    ).bind(Date.now(), body.session_id).run();

    // Send a test message to the new group
    const welcomeMessage = `✅ *CHOG Bot Connected*\n\nThis group is now linked to the CHOG eligibility tracker. Bot notifications will be sent here.`;
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, newChatId, welcomeMessage);

    return c.json({
        success: true,
        chat_id: result.chat?.id,
        title: result.chat?.title,
        type: result.chat?.type
    });
});

/**
 * POST /api/admin/kick-users
 * Kick selected users from the Telegram group
 */
adminRoutes.post('/kick-users', async (c) => {
    const body = await c.req.json<{
        users: Array<{ telegram_user_id: number; telegram_username?: string }>;
    }>();

    if (!body.users || !Array.isArray(body.users) || body.users.length === 0) {
        return c.json({ error: 'users array is required and must not be empty' }, 400);
    }

    // Get the group chat ID
    const chatId = await getGroupChatId(c.env.DB, c.env.TELEGRAM_CHAT_ID);

    if (!chatId) {
        return c.json({ error: 'No Telegram group configured' }, 400);
    }

    let kicked = 0;
    let failed = 0;
    const errors: string[] = [];
    const now = Date.now();

    for (const user of body.users) {
        if (!user.telegram_user_id) {
            failed++;
            errors.push(`Missing telegram_user_id`);
            continue;
        }

        try {
            // Kick the user from the group
            const result = await kickChatMember(
                c.env.TELEGRAM_BOT_TOKEN,
                chatId,
                user.telegram_user_id
            );

            if (result.success) {
                kicked++;

                // Update group_members table to mark them as left
                await c.env.DB.prepare(`
                    UPDATE group_members 
                    SET left_at = ?, updated_at = ?
                    WHERE telegram_user_id = ?
                `).bind(now, now, user.telegram_user_id).run();
            } else {
                failed++;
                const username = user.telegram_username || user.telegram_user_id;
                errors.push(`${username}: ${result.error}`);
            }
        } catch (err) {
            failed++;
            const username = user.telegram_username || user.telegram_user_id;
            errors.push(`${username}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }

    return c.json({
        success: true,
        kicked,
        failed,
        errors: errors.slice(0, 10) // Limit to first 10 errors
    });
});
