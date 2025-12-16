// Profile management routes
import { Hono } from 'hono';
import type { Env } from '../index';
import {
    getProfileByHandle,
    getProfileById,
    getProfileByWalletAddress,
    createProfile,
    updateProfileEditSecret,
    getWalletsByProfile,
    getLatestSnapshotForProfile
} from '../lib/db';
import { generateId, generateSecret, hashSecret, verifySecret } from '../lib/crypto';
import { getChogTotalSupply, formatChogBalance } from '../lib/chog';

export const profileRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/profile/stats/whale-order
 * Public endpoint for whale order statistics (used on homepage)
 */
profileRoutes.get('/stats/whale-order', async (c) => {
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

    // Format whale total in millions (divide by 10^18 for decimals, then by 10^6 for millions)
    const whaleTotalMillions = Number(whaleTotal / 10n ** 18n) / 1_000_000;

    return c.json({
        whale_total_millions: whaleTotalMillions.toFixed(1),
        percentage: percentage.toFixed(1)
    });
});

/**
 * POST /api/profile/upsert
 * Create a new profile or load existing one
 */
profileRoutes.post('/upsert', async (c) => {
    const body = await c.req.json<{ telegram_handle: string; edit_secret?: string }>();

    if (!body.telegram_handle) {
        return c.json({ error: 'telegram_handle is required' }, 400);
    }

    // Normalize handle - remove @ if present
    let handle = body.telegram_handle.trim();
    if (handle.startsWith('@')) {
        handle = handle.slice(1);
    }

    // Validate Telegram username rules:
    // - 5-32 characters
    // - Only a-z, A-Z, 0-9, underscore (_)
    if (handle.length < 5 || handle.length > 32) {
        return c.json({ error: 'Username must be between 5 and 32 characters' }, 400);
    }
    if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
        return c.json({ error: 'Username can only contain letters, numbers, and underscores' }, 400);
    }

    // Store with @ prefix for display
    const displayHandle = '@' + handle;

    // Check if profile exists
    const existing = await getProfileByHandle(c.env.DB, handle);

    if (existing) {
        // If edit_secret provided, verify it and return full profile
        if (body.edit_secret) {
            const valid = await verifySecret(body.edit_secret, existing.edit_secret_hash);
            if (valid) {
                const wallets = await getWalletsByProfile(c.env.DB, existing.id);
                const snapshot = await getLatestSnapshotForProfile(c.env.DB, existing.id);
                return c.json({
                    profile_id: existing.id,
                    telegram_handle: existing.telegram_handle,
                    edit_secret_hash: existing.edit_secret_hash, // Needed for wallet linking
                    wallets,
                    snapshot,
                    has_edit_access: true
                });
            }
        }

        // Return read-only profile (no edit_secret)
        const wallets = await getWalletsByProfile(c.env.DB, existing.id);
        const snapshot = await getLatestSnapshotForProfile(c.env.DB, existing.id);
        return c.json({
            profile_id: existing.id,
            telegram_handle: existing.telegram_handle,
            wallets,
            snapshot,
            has_edit_access: false
        });
    }

    // DON'T create profile in DB yet - wait until first wallet is linked
    // This prevents orphaned profiles when users enter a handle but never link a wallet
    const id = generateId();
    const editSecret = generateSecret();
    const editSecretHash = await hashSecret(editSecret);

    // Return a pending profile (not yet persisted)
    // The wallet link endpoint will create the profile when first wallet is linked
    return c.json({
        profile_id: id,
        telegram_handle: displayHandle,
        edit_secret: editSecret,
        edit_secret_hash: editSecretHash, // Needed for wallet link to create profile
        wallets: [],
        snapshot: null,
        has_edit_access: true,
        is_pending: true // Indicates profile not yet in DB
    }, 201);
});

/**
 * GET /api/profile/:id
 * Get profile details
 */
profileRoutes.get('/:id', async (c) => {
    const id = c.req.param('id');
    const profile = await getProfileById(c.env.DB, id);

    if (!profile) {
        return c.json({ error: 'Profile not found' }, 404);
    }

    const wallets = await getWalletsByProfile(c.env.DB, profile.id);
    const snapshot = await getLatestSnapshotForProfile(c.env.DB, profile.id);

    return c.json({
        profile_id: profile.id,
        telegram_handle: profile.telegram_handle,
        wallets,
        snapshot,
    });
});

/**
 * POST /api/profile/recover
 * Recover profile access via wallet signature
 * User connects a wallet that's already linked → gets new edit_secret
 */
profileRoutes.post('/recover', async (c) => {
    const body = await c.req.json<{ address: string }>();

    if (!body.address) {
        return c.json({ error: 'address is required' }, 400);
    }

    // Find profile by wallet address
    const profile = await getProfileByWalletAddress(c.env.DB, body.address);

    if (!profile) {
        return c.json({ error: 'No profile found with this wallet address' }, 404);
    }

    // Generate new edit secret
    const newEditSecret = generateSecret();
    const newEditSecretHash = await hashSecret(newEditSecret);

    await updateProfileEditSecret(c.env.DB, profile.id, newEditSecretHash);

    const wallets = await getWalletsByProfile(c.env.DB, profile.id);
    const snapshot = await getLatestSnapshotForProfile(c.env.DB, profile.id);

    return c.json({
        profile_id: profile.id,
        telegram_handle: profile.telegram_handle,
        edit_secret: newEditSecret,
        wallets,
        snapshot,
        has_edit_access: true
    });
});
