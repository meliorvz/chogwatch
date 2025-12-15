// Daily screening cron job
import type { Env } from '../index';
import {
    getAllProfilesWithWallets,
    getEnabledLpPairs,
    getLastScreeningRun,
    getSnapshotsForRun,
    updateWalletBalances,
    type Wallet
} from '../lib/db';
import { getTotalChogExposure, formatChogBalance, isEligible } from '../lib/chog';
import { sendTelegramMessage, formatEligibilityMessage } from '../lib/telegram';
import { generateId } from '../lib/crypto';
import { getGroupChatId } from '../routes/admin';

export interface ScreeningResult {
    runId: string;
    status: 'success' | 'error' | 'partial';
    profilesProcessed: number;
    walletsProcessed: number;
    eligibleCount: number;
    messageSent: boolean;
    error?: string;
}

/**
 * Run the screening job
 * @param env - Worker environment
 * @param force - If true, skip the interval check (used for manual runs)
 */
export async function runScreening(env: Env, force: boolean = false): Promise<ScreeningResult> {
    const runId = generateId();
    const startedAt = Date.now();

    // Check if enough time has passed since last run (unless forced)
    if (!force) {
        const lastRun = await getLastScreeningRun(env.DB);
        if (lastRun && lastRun.status === 'success') {
            // Get screening interval from settings (default 24 hours)
            const intervalSetting = await env.DB.prepare(
                'SELECT value FROM settings WHERE key = ?'
            ).bind('screening_interval_hours').first<{ value: string }>();
            const intervalHours = parseInt(intervalSetting?.value || '24', 10);
            const intervalMs = intervalHours * 60 * 60 * 1000;

            const timeSinceLastRun = startedAt - lastRun.started_at;
            if (timeSinceLastRun < intervalMs) {
                const hoursRemaining = Math.ceil((intervalMs - timeSinceLastRun) / (60 * 60 * 1000));
                console.log(`Screening skipped: ${hoursRemaining}h until next run (interval: ${intervalHours}h)`);
                return {
                    runId: '',
                    status: 'success',
                    profilesProcessed: 0,
                    walletsProcessed: 0,
                    eligibleCount: 0,
                    messageSent: false,
                    error: `Skipped: ${hoursRemaining}h until next run`,
                };
            }
        }
    }

    // Create screening run record
    await env.DB.prepare(
        `INSERT INTO screening_runs (id, started_at, status, profiles_processed, wallets_processed, eligible_count, message_sent)
     VALUES (?, ?, 'running', 0, 0, 0, 0)`
    ).bind(runId, startedAt).run();

    try {
        // Get all profiles with wallets
        const profiles = await getAllProfilesWithWallets(env.DB);
        const lpPairs = await getEnabledLpPairs(env.DB);

        // Get previous run for diff calculation
        const lastRun = await getLastScreeningRun(env.DB);
        const previousSnapshots = lastRun
            ? await getSnapshotsForRun(env.DB, lastRun.id)
            : [];
        const previousEligible = new Map(
            previousSnapshots.filter(s => s.eligible).map(s => [s.profile_id, s])
        );

        let walletsProcessed = 0;
        let eligibleCount = 0;
        const newlyEligible: Array<{ handle: string; totalChog: string }> = [];
        const droppedEligible: Array<{ handle: string }> = [];
        const allEligible: Array<{ handle: string; totalChog: string; totalRaw: bigint }> = [];

        // Get eligibility threshold from settings
        const thresholdSetting = await env.DB.prepare(
            'SELECT value FROM settings WHERE key = ?'
        ).bind('eligibility_threshold_raw').first<{ value: string }>();
        const thresholdRaw = thresholdSetting?.value || '1000000000000000000000000';

        // Process each profile
        for (const profile of profiles) {
            let profileTotalChog = 0n;
            const walletDetails: Array<{
                address: string;
                directChog: string;
                lpChog: string;
                totalChog: string;
            }> = [];

            // Calculate exposure for each wallet
            for (const wallet of profile.wallets) {
                try {
                    const exposure = await getTotalChogExposure(
                        env.MONAD_RPC_URL,
                        env.CHOG_CONTRACT,
                        lpPairs,
                        wallet.address
                    );

                    // Update wallet balances in DB
                    await updateWalletBalances(
                        env.DB,
                        wallet.id,
                        exposure.directBalance.toString(),
                        exposure.lpBalance.toString(),
                        exposure.totalBalance.toString()
                    );

                    walletDetails.push({
                        address: wallet.address,
                        directChog: exposure.directBalance.toString(),
                        lpChog: exposure.lpBalance.toString(),
                        totalChog: exposure.totalBalance.toString(),
                    });

                    profileTotalChog += exposure.totalBalance;
                    walletsProcessed++;
                } catch (err) {
                    console.error(`Error processing wallet ${wallet.address}:`, err);
                    // Mark wallet as error
                    await env.DB.prepare(
                        `UPDATE wallets SET status = 'error', error_reason = ? WHERE id = ?`
                    ).bind(err instanceof Error ? err.message : 'Unknown error', wallet.id).run();
                }
            }

            // Check eligibility
            const eligible = isEligible(profileTotalChog, thresholdRaw);
            const wasEligible = previousEligible.has(profile.id);

            if (eligible) {
                eligibleCount++;
                const formattedChog = formatChogBalance(profileTotalChog);
                allEligible.push({
                    handle: profile.telegram_handle.replace('@', ''),
                    totalChog: formattedChog,
                    totalRaw: profileTotalChog
                });

                if (!wasEligible) {
                    newlyEligible.push({
                        handle: profile.telegram_handle.replace('@', ''),
                        totalChog: formattedChog
                    });
                }
            } else if (wasEligible) {
                droppedEligible.push({ handle: profile.telegram_handle.replace('@', '') });
            }

            // Store snapshot
            await env.DB.prepare(
                `INSERT INTO profile_snapshots (run_id, profile_id, total_chog_raw, eligible, details_json)
         VALUES (?, ?, ?, ?, ?)`
            ).bind(
                runId,
                profile.id,
                profileTotalChog.toString(),
                eligible ? 1 : 0,
                JSON.stringify(walletDetails)
            ).run();
        }

        // Sort all eligible by total CHOG (descending)
        allEligible.sort((a, b) => (b.totalRaw > a.totalRaw ? 1 : -1));
        const topEligible = allEligible.slice(0, 10).map(({ handle, totalChog }) => ({ handle, totalChog }));

        // Format and send Telegram message
        const today = new Date().toISOString().split('T')[0];
        const message = formatEligibilityMessage({
            date: today,
            eligibleCount,
            newlyEligible,
            droppedEligible,
            topEligible,
        });

        let messageSent = false;
        const groupChatId = await getGroupChatId(env.DB, env.TELEGRAM_CHAT_ID);
        if (env.TELEGRAM_BOT_TOKEN && groupChatId) {
            // Check if bot notifications are enabled
            const notificationsSetting = await env.DB.prepare(
                `SELECT value FROM settings WHERE key = 'bot_notifications_enabled'`
            ).first<{ value: string }>();
            const notificationsEnabled = notificationsSetting?.value !== 'false';

            if (notificationsEnabled) {
                const result = await sendTelegramMessage(
                    env.TELEGRAM_BOT_TOKEN,
                    groupChatId,
                    message
                );
                messageSent = result.success;
                if (!result.success) {
                    console.error('Failed to send Telegram message:', result.error);
                }
            } else {
                console.log('Bot notifications disabled, skipping group message');
            }
        }

        // Update screening run record
        await env.DB.prepare(
            `UPDATE screening_runs SET 
       finished_at = ?, status = 'success', 
       profiles_processed = ?, wallets_processed = ?, 
       eligible_count = ?, message_sent = ?
       WHERE id = ?`
        ).bind(
            Date.now(), profiles.length, walletsProcessed,
            eligibleCount, messageSent ? 1 : 0, runId
        ).run();

        return {
            runId,
            status: 'success',
            profilesProcessed: profiles.length,
            walletsProcessed,
            eligibleCount,
            messageSent,
        };
    } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        console.error('Screening error:', error);

        // Update screening run with error
        await env.DB.prepare(
            `UPDATE screening_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?`
        ).bind(Date.now(), error, runId).run();

        return {
            runId,
            status: 'error',
            profilesProcessed: 0,
            walletsProcessed: 0,
            eligibleCount: 0,
            messageSent: false,
            error,
        };
    }
}
