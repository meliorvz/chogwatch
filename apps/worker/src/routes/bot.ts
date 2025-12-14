// Telegram Bot Webhook Handler
import { Hono } from 'hono';
import type { Env } from '../index';
import { approveChatJoinRequest, declineChatJoinRequest, sendTelegramMessage } from '../lib/telegram';
import { formatChogBalance, isEligible } from '../lib/chog';

export const botRoutes = new Hono<{ Bindings: Env }>();

// Telegram update types
interface TelegramUser {
    id: number;
    username?: string;
    first_name: string;
}

interface ChatJoinRequest {
    chat: { id: number };
    from: TelegramUser;
    date: number;
}

interface TelegramMessage {
    message_id: number;
    from: TelegramUser;
    chat: { id: number; type: string };
    text?: string;
}

interface ChatMember {
    user: TelegramUser;
    status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
}

interface ChatMemberUpdated {
    chat: { id: number; type: string };
    from: TelegramUser;
    date: number;
    old_chat_member: ChatMember;
    new_chat_member: ChatMember;
}

interface TelegramUpdate {
    update_id: number;
    chat_join_request?: ChatJoinRequest;
    message?: TelegramMessage;
    chat_member?: ChatMemberUpdated;  // When any user's status changes
}

/**
 * POST /api/bot/webhook
 * Handle incoming Telegram updates
 */
botRoutes.post('/webhook', async (c) => {
    const update = await c.req.json<TelegramUpdate>();

    try {
        // Handle chat join requests
        if (update.chat_join_request) {
            await handleJoinRequest(c.env, update.chat_join_request);
        }

        // Handle chat member updates (joins/leaves)
        if (update.chat_member) {
            await handleMemberUpdate(c.env, update.chat_member);
        }

        // Handle bot commands
        if (update.message?.text?.startsWith('/')) {
            await handleCommand(c.env, update.message);
        }

        return c.json({ ok: true });
    } catch (err) {
        console.error('Bot webhook error:', err);
        return c.json({ ok: true }); // Always return 200 to Telegram
    }
});

/**
 * Handle chat join request - check eligibility and approve/decline
 */
async function handleJoinRequest(env: Env, request: ChatJoinRequest) {
    const { from, chat } = request;
    const username = from.username?.toLowerCase();

    if (!username) {
        // No username, can't verify - decline
        await declineChatJoinRequest(env.TELEGRAM_BOT_TOKEN, String(chat.id), from.id);
        return;
    }

    // Look up profile by Telegram handle
    const profile = await env.DB.prepare(
        `SELECT p.*, ps.total_chog_raw, ps.eligible 
         FROM profiles p
         LEFT JOIN profile_snapshots ps ON p.id = ps.profile_id
         WHERE LOWER(REPLACE(p.telegram_handle, '@', '')) = ?
         ORDER BY ps.run_id DESC
         LIMIT 1`
    ).bind(username).first<{
        id: string;
        telegram_handle: string;
        total_chog_raw: string | null;
        eligible: number | null;
    }>();

    if (!profile) {
        // No registered profile - decline
        await declineChatJoinRequest(env.TELEGRAM_BOT_TOKEN, String(chat.id), from.id);
        return;
    }

    // Check eligibility
    const isUserEligible = profile.eligible === 1;

    if (isUserEligible) {
        await approveChatJoinRequest(env.TELEGRAM_BOT_TOKEN, String(chat.id), from.id);

        // Send welcome message
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(chat.id),
            `🐸 Welcome @${username}! Your CHOG eligibility has been verified.`
        );
    } else {
        await declineChatJoinRequest(env.TELEGRAM_BOT_TOKEN, String(chat.id), from.id);
    }
}

/**
 * Handle bot commands
 */
async function handleCommand(env: Env, message: TelegramMessage) {
    const text = message.text || '';
    const command = text.split(' ')[0].toLowerCase();
    const from = message.from;

    switch (command) {
        case '/status':
            await handleStatusCommand(env, message);
            break;
        case '/admin':
            await handleAdminCommand(env, message);
            break;
        case '/help':
            await sendTelegramMessage(
                env.TELEGRAM_BOT_TOKEN,
                String(message.chat.id),
                `🐸 *CHOG Eligibility Bot*\n\n` +
                `Commands:\n` +
                `• /status - Check your eligibility\n` +
                `• /admin - Register as admin for OTP delivery\n` +
                `• /help - Show this message`
            );
            break;
    }
}

/**
 * Handle /admin command - register admin's telegram_user_id for OTP DMs
 */
async function handleAdminCommand(env: Env, message: TelegramMessage) {
    const username = message.from.username?.toLowerCase();
    const userId = message.from.id;

    if (!username) {
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(message.chat.id),
            `❌ You need a Telegram username to register as admin.`
        );
        return;
    }

    // Check if they're in the admins table
    const admin = await env.DB.prepare(
        'SELECT id, telegram_user_id FROM admins WHERE LOWER(telegram_handle) = ?'
    ).bind(username).first<{ id: string; telegram_user_id: number | null }>();

    if (!admin) {
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(message.chat.id),
            `❌ @${username} is not registered as an admin.`
        );
        return;
    }

    // Update their telegram_user_id
    await env.DB.prepare(
        'UPDATE admins SET telegram_user_id = ? WHERE id = ?'
    ).bind(userId, admin.id).run();

    // Only respond in private chat for security
    if (message.chat.type === 'private') {
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(message.chat.id),
            `✅ Admin registration complete!\n\n` +
            `Your Telegram ID (${userId}) has been linked to @${username}.\n\n` +
            `OTP codes will now be sent directly to this chat.`
        );
    } else {
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(message.chat.id),
            `✅ Admin @${username} registered for OTP delivery.\n\n` +
            `_For security, send /admin in a private message to the bot._`
        );
    }
}

/**
 * Handle /status command - show user's eligibility
 */
async function handleStatusCommand(env: Env, message: TelegramMessage) {
    const username = message.from.username?.toLowerCase();

    if (!username) {
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(message.chat.id),
            `❌ You need a Telegram username to check your status.`,
        );
        return;
    }

    // Look up profile
    const profile = await env.DB.prepare(
        `SELECT p.*, ps.total_chog_raw, ps.eligible 
         FROM profiles p
         LEFT JOIN profile_snapshots ps ON p.id = ps.profile_id
         WHERE LOWER(REPLACE(p.telegram_handle, '@', '')) = ?
         ORDER BY ps.run_id DESC
         LIMIT 1`
    ).bind(username).first<{
        id: string;
        telegram_handle: string;
        total_chog_raw: string | null;
        eligible: number | null;
    }>();

    if (!profile) {
        await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            String(message.chat.id),
            `❓ No profile found for @${username}.\n\n` +
            `Register at: [CHOG Eligibility Verifier](${env.MONAD_RPC_URL ? 'https://your-app.com' : 'http://localhost:3000'})`
        );
        return;
    }

    const totalChog = profile.total_chog_raw
        ? formatChogBalance(BigInt(profile.total_chog_raw))
        : '0';
    const isUserEligible = profile.eligible === 1;

    const statusEmoji = isUserEligible ? '✅' : '❌';
    const statusText = isUserEligible ? 'Eligible' : 'Not Eligible';

    await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        String(message.chat.id),
        `🐸 *CHOG Status for @${username}*\n\n` +
        `💰 Total CHOG: ${totalChog}\n` +
        `${statusEmoji} Status: ${statusText}\n\n` +
        `_Threshold: 1,000,000 CHOG_`
    );
}

/**
 * Handle chat member updates - track joins/leaves for group membership
 */
async function handleMemberUpdate(env: Env, update: ChatMemberUpdated) {
    // Only track updates for our configured group
    if (String(update.chat.id) !== env.TELEGRAM_CHAT_ID) {
        return;
    }

    const user = update.new_chat_member.user;
    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;
    const now = Date.now();

    // Statuses that mean "in group"
    const inGroupStatuses = ['creator', 'administrator', 'member', 'restricted'];
    const wasInGroup = inGroupStatuses.includes(oldStatus);
    const isInGroup = inGroupStatuses.includes(newStatus);

    if (!wasInGroup && isInGroup) {
        // User joined the group
        await env.DB.prepare(`
            INSERT INTO group_members (telegram_user_id, telegram_username, first_name, joined_at, left_at, source, updated_at)
            VALUES (?, ?, ?, ?, NULL, 'webhook', ?)
            ON CONFLICT(telegram_user_id) DO UPDATE SET
                telegram_username = excluded.telegram_username,
                first_name = excluded.first_name,
                left_at = NULL,
                updated_at = excluded.updated_at
        `).bind(user.id, user.username || null, user.first_name, now, now).run();

        console.log(`Member joined: ${user.username || user.id}`);
    } else if (wasInGroup && !isInGroup) {
        // User left or was kicked from the group
        await env.DB.prepare(`
            UPDATE group_members 
            SET left_at = ?, updated_at = ?
            WHERE telegram_user_id = ?
        `).bind(now, now, user.id).run();

        console.log(`Member left: ${user.username || user.id}`);
    } else if (isInGroup) {
        // User is still in group, just update their info (username might have changed)
        await env.DB.prepare(`
            INSERT INTO group_members (telegram_user_id, telegram_username, first_name, joined_at, left_at, source, updated_at)
            VALUES (?, ?, ?, ?, NULL, 'webhook', ?)
            ON CONFLICT(telegram_user_id) DO UPDATE SET
                telegram_username = excluded.telegram_username,
                first_name = excluded.first_name,
                updated_at = excluded.updated_at
        `).bind(user.id, user.username || null, user.first_name, now, now).run();
    }
}
