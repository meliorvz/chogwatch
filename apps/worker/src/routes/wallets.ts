// Wallet linking/unlinking routes
import { Hono } from 'hono';
import type { Env } from '../index';
import {
    getProfileById,
    getWalletByAddress,
    getProfileByWalletAddress,
    getProfileByHandle,
    createProfile,
    updateProfileEditSecret,
    createWallet,
    deleteWallet,
    getNonce,
    markNonceUsed,
    getEnabledLpPairs,
    updateWalletBalances
} from '../lib/db';
import { verifySecret, generateId } from '../lib/crypto';
import { verifySiweSignature } from '../lib/siwe';
import { getTotalChogExposure } from '../lib/chog';

export const walletRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/wallets/link
 * Link a wallet to a profile via SIWE signature
 */
walletRoutes.post('/link', async (c) => {
    const body = await c.req.json<{
        profile_id: string;
        edit_secret: string;
        address: string;
        siwe_message: string;
        signature: string;
        wallet_rdns?: string;
        // For pending profiles (first wallet link)
        telegram_handle?: string;
        edit_secret_hash?: string;
    }>();

    // Validate required fields
    if (!body.profile_id || !body.edit_secret || !body.address || !body.siwe_message || !body.signature) {
        return c.json({ error: 'Missing required fields' }, 400);
    }

    // Check if profile exists in DB
    let profile = await getProfileById(c.env.DB, body.profile_id);
    let isNewProfile = false;

    if (!profile) {
        // Profile doesn't exist by ID - this is a pending profile being persisted on first wallet link
        // Validate required fields for profile creation
        if (!body.telegram_handle || !body.edit_secret_hash) {
            return c.json({ error: 'Profile not found and missing data for creation' }, 400);
        }

        // Check if another profile already has this handle
        const existingByHandle = await getProfileByHandle(c.env.DB, body.telegram_handle);
        if (existingByHandle) {
            // Profile with this handle already exists - adopt it
            // This handles race conditions and stale state from previous sessions
            // Update the edit_secret_hash to the new one since user is proving ownership via wallet
            await updateProfileEditSecret(c.env.DB, existingByHandle.id, body.edit_secret_hash);
            profile = existingByHandle;
            // Update the profile reference with new hash for subsequent verification
            profile = { ...profile, edit_secret_hash: body.edit_secret_hash };
        } else {
            // Create profile now (first wallet link)
            await createProfile(c.env.DB, body.profile_id, body.telegram_handle, body.edit_secret_hash);
            profile = await getProfileById(c.env.DB, body.profile_id);
            isNewProfile = true;

            if (!profile) {
                return c.json({ error: 'Failed to create profile' }, 500);
            }
        }
    }

    const validSecret = await verifySecret(body.edit_secret, profile.edit_secret_hash);
    if (!validSecret) {
        return c.json({ error: 'Invalid edit_secret' }, 403);
    }

    // Check if wallet is already linked to ANY profile (globally unique constraint)
    const existingWallet = await getWalletByAddress(c.env.DB, body.address);
    if (existingWallet) {
        if (existingWallet.profile_id === body.profile_id) {
            return c.json({ error: 'Wallet already linked to this profile' }, 409);
        }
        return c.json({ error: 'Wallet already linked to another profile' }, 409);
    }

    // Extract nonce from SIWE message and verify
    const nonceMatch = body.siwe_message.match(/Nonce: ([a-f0-9]+)/i);
    if (!nonceMatch) {
        return c.json({ error: 'Invalid SIWE message: no nonce found' }, 400);
    }

    const nonce = nonceMatch[1];
    const storedNonce = await getNonce(c.env.DB, nonce);

    if (!storedNonce) {
        return c.json({ error: 'Invalid nonce' }, 400);
    }

    if (storedNonce.profile_id !== body.profile_id) {
        return c.json({ error: 'Nonce does not belong to this profile' }, 403);
    }

    if (storedNonce.used_at) {
        return c.json({ error: 'Nonce already used' }, 400);
    }

    if (storedNonce.expires_at < Date.now()) {
        return c.json({ error: 'Nonce expired' }, 400);
    }


    // Get expected chain ID
    const expectedChainId = parseInt(c.env.MONAD_CHAIN_ID, 10);

    // Verify SIWE signature
    // Note: We don't verify the domain because in development the frontend (localhost:3000) 
    // and backend (localhost:8787) are on different ports. The signature itself proves
    // the message wasn't tampered with. In production, you may want to add domain validation.
    const verifyResult = await verifySiweSignature({
        message: body.siwe_message,
        signature: body.signature,
        expectedChainId,
        expectedNonce: nonce,
    });

    if (!verifyResult.success) {
        return c.json({ error: `SIWE verification failed: ${verifyResult.error}` }, 400);
    }

    // Ensure the verified address matches the claimed address
    if (verifyResult.address?.toLowerCase() !== body.address.toLowerCase()) {
        return c.json({ error: 'Address mismatch' }, 400);
    }

    // Mark nonce as used
    await markNonceUsed(c.env.DB, nonce);

    // Create wallet entry
    const walletId = generateId();
    await createWallet(c.env.DB, walletId, body.profile_id, body.address, body.wallet_rdns || null);

    // Fetch initial balance (don't fail request if this fails)
    try {
        const lpPairs = await getEnabledLpPairs(c.env.DB);
        const exposure = await getTotalChogExposure(
            c.env.MONAD_RPC_URL,
            c.env.CHOG_CONTRACT,
            lpPairs,
            body.address
        );

        await updateWalletBalances(
            c.env.DB,
            walletId,
            exposure.directBalance.toString(),
            exposure.lpBalance.toString(),
            exposure.totalBalance.toString()
        );
    } catch (err) {
        console.error('Failed to fetch initial balance:', err);
    }

    return c.json({
        success: true,
        wallet_id: walletId,
        address: body.address.toLowerCase()
    }, 201);
});

/**
 * POST /api/wallets/unlink
 * Remove a wallet from a profile
 */
walletRoutes.post('/unlink', async (c) => {
    const body = await c.req.json<{
        profile_id: string;
        edit_secret: string;
        address: string;
    }>();

    if (!body.profile_id || !body.edit_secret || !body.address) {
        return c.json({ error: 'Missing required fields' }, 400);
    }

    // Verify profile exists and edit_secret is valid
    const profile = await getProfileById(c.env.DB, body.profile_id);
    if (!profile) {
        return c.json({ error: 'Profile not found' }, 404);
    }

    const validSecret = await verifySecret(body.edit_secret, profile.edit_secret_hash);
    if (!validSecret) {
        return c.json({ error: 'Invalid edit_secret' }, 403);
    }

    // Delete wallet
    const deleted = await deleteWallet(c.env.DB, body.profile_id, body.address);

    if (!deleted) {
        return c.json({ error: 'Wallet not found' }, 404);
    }

    return c.json({ success: true });
});

/**
 * GET /api/wallets/lookup/:address
 * Check if an address is linked to any profile
 */
walletRoutes.get('/lookup/:address', async (c) => {
    const address = c.req.param('address');

    const profile = await getProfileByWalletAddress(c.env.DB, address);

    if (!profile) {
        return c.json({ linked: false });
    }

    return c.json({
        linked: true,
        profile_id: profile.id,
        telegram_handle: profile.telegram_handle
    });
});
