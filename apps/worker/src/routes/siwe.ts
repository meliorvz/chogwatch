// SIWE nonce management routes
import { Hono } from 'hono';
import type { Env } from '../index';
import { getProfileById, createNonce } from '../lib/db';
import { generateNonce } from '../lib/crypto';
import { verifySecret } from '../lib/crypto';

export const siweRoutes = new Hono<{ Bindings: Env }>();

const NONCE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/siwe/nonce
 * Generate a single-use nonce for SIWE signing
 */
siweRoutes.post('/nonce', async (c) => {
    const body = await c.req.json<{
        profile_id: string;
        edit_secret: string;
        // For pending profiles (not yet in DB)
        edit_secret_hash?: string;
    }>();

    if (!body.profile_id || !body.edit_secret) {
        return c.json({ error: 'profile_id and edit_secret are required' }, 400);
    }

    // Check if profile exists in DB
    const profile = await getProfileById(c.env.DB, body.profile_id);

    let editSecretHash: string;

    if (profile) {
        // Profile exists - use its hash
        editSecretHash = profile.edit_secret_hash;
    } else if (body.edit_secret_hash) {
        // Pending profile - use provided hash
        editSecretHash = body.edit_secret_hash;
    } else {
        return c.json({ error: 'Profile not found and no edit_secret_hash provided' }, 404);
    }

    const valid = await verifySecret(body.edit_secret, editSecretHash);
    if (!valid) {
        return c.json({ error: 'Invalid edit_secret' }, 403);
    }

    // Generate nonce
    const nonce = generateNonce();
    const expiresAt = Date.now() + NONCE_EXPIRY_MS;

    // Store nonce (profile_id may not exist in DB yet for pending profiles)
    await createNonce(c.env.DB, nonce, body.profile_id, expiresAt);

    return c.json({
        nonce,
        expires_at: expiresAt,
        expires_in_seconds: NONCE_EXPIRY_MS / 1000
    });
});

