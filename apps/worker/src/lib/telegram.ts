// Telegram Bot API integration

export interface TelegramSendResult {
    success: boolean;
    messageId?: number;
    error?: string;
}

/**
 * Send a message to a Telegram chat
 */
export async function sendTelegramMessage(
    botToken: string,
    chatId: string,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'Markdown'
): Promise<TelegramSendResult> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: parseMode,
                disable_web_page_preview: true,
            }),
        });

        const data = await response.json() as {
            ok: boolean;
            result?: { message_id: number };
            description?: string;
        };

        if (!data.ok) {
            return { success: false, error: data.description || 'Unknown error' };
        }

        return { success: true, messageId: data.result?.message_id };
    } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        return { success: false, error };
    }
}

/**
 * Format the daily eligibility summary message
 */
export function formatEligibilityMessage(data: {
    date: string;
    eligibleCount: number;
    newlyEligible: Array<{ handle: string; totalChog: string }>;
    droppedEligible: Array<{ handle: string }>;
    topEligible?: Array<{ handle: string; totalChog: string }>;
}): string {
    const lines: string[] = [];

    // Header
    lines.push(`🐸 *CHOG Eligibility — ${data.date}*`);
    lines.push('');

    // Counts
    lines.push(`📊 *Summary*`);
    lines.push(`• Eligible: ${data.eligibleCount}`);
    lines.push(`• New: ${data.newlyEligible.length}`);
    lines.push(`• Dropped: ${data.droppedEligible.length}`);
    lines.push('');

    // Newly eligible
    if (data.newlyEligible.length > 0) {
        lines.push(`✅ *Newly Eligible*`);
        for (const user of data.newlyEligible.slice(0, 20)) {
            lines.push(`• @${user.handle} — ${formatNumber(user.totalChog)} CHOG`);
        }
        if (data.newlyEligible.length > 20) {
            lines.push(`  _...and ${data.newlyEligible.length - 20} more_`);
        }
        lines.push('');
    }

    // Dropped
    if (data.droppedEligible.length > 0) {
        lines.push(`❌ *No Longer Eligible*`);
        for (const user of data.droppedEligible.slice(0, 10)) {
            lines.push(`• @${user.handle}`);
        }
        if (data.droppedEligible.length > 10) {
            lines.push(`  _...and ${data.droppedEligible.length - 10} more_`);
        }
        lines.push('');
    }

    // Top eligible (optional)
    if (data.topEligible && data.topEligible.length > 0) {
        lines.push(`🏆 *Top 10 Holders*`);
        data.topEligible.slice(0, 10).forEach((user, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            lines.push(`${medal} @${user.handle} — ${formatNumber(user.totalChog)} CHOG`);
        });
    }

    return lines.join('\n');
}

/**
 * Format a number with commas for display
 */
function formatNumber(value: string): string {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ============== Group Management Functions ==============

export interface TelegramApiResult {
    success: boolean;
    error?: string;
}

export interface ChatMember {
    user: {
        id: number;
        username?: string;
        first_name: string;
    };
    status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
}

/**
 * Get a chat member's info
 */
export async function getChatMember(
    botToken: string,
    chatId: string,
    userId: number
): Promise<{ success: boolean; member?: ChatMember; error?: string }> {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, user_id: userId }),
        });

        const data = await response.json() as { ok: boolean; result?: ChatMember; description?: string };
        if (!data.ok) {
            return { success: false, error: data.description || 'Unknown error' };
        }

        return { success: true, member: data.result };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

/**
 * Kick a user from a chat (ban and optionally unban to just remove)
 */
export async function kickChatMember(
    botToken: string,
    chatId: string,
    userId: number,
    revokeMessages: boolean = false
): Promise<TelegramApiResult> {
    const url = `https://api.telegram.org/bot${botToken}/banChatMember`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                user_id: userId,
                revoke_messages: revokeMessages,
            }),
        });

        const data = await response.json() as { ok: boolean; description?: string };
        if (!data.ok) {
            return { success: false, error: data.description || 'Unknown error' };
        }

        // Optionally unban to allow them to rejoin later
        await fetch(`https://api.telegram.org/bot${botToken}/unbanChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                user_id: userId,
                only_if_banned: true,
            }),
        });

        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

/**
 * Approve a chat join request
 */
export async function approveChatJoinRequest(
    botToken: string,
    chatId: string,
    userId: number
): Promise<TelegramApiResult> {
    const url = `https://api.telegram.org/bot${botToken}/approveChatJoinRequest`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, user_id: userId }),
        });

        const data = await response.json() as { ok: boolean; description?: string };
        return { success: data.ok, error: data.ok ? undefined : data.description };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

/**
 * Decline a chat join request
 */
export async function declineChatJoinRequest(
    botToken: string,
    chatId: string,
    userId: number
): Promise<TelegramApiResult> {
    const url = `https://api.telegram.org/bot${botToken}/declineChatJoinRequest`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, user_id: userId }),
        });

        const data = await response.json() as { ok: boolean; description?: string };
        return { success: data.ok, error: data.ok ? undefined : data.description };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

/**
 * Send a direct message to a user (requires user to have started chat with bot)
 */
export async function sendDirectMessage(
    botToken: string,
    userId: number,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'Markdown'
): Promise<TelegramSendResult> {
    return sendTelegramMessage(botToken, String(userId), text, parseMode);
}

/**
 * Get chat info (title, id, etc.)
 */
export async function getChat(
    botToken: string,
    chatId: string
): Promise<{ success: boolean; chat?: { id: number; title: string; type: string }; error?: string }> {
    const url = `https://api.telegram.org/bot${botToken}/getChat`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId }),
        });

        const data = await response.json() as {
            ok: boolean;
            result?: { id: number; title: string; type: string };
            description?: string;
        };

        if (!data.ok) {
            return { success: false, error: data.description || 'Unknown error' };
        }

        return { success: true, chat: data.result };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

