// Database helper types and queries
import type { Env } from '../index';

export interface Profile {
    id: string;
    telegram_handle: string;
    edit_secret_hash: string;
    created_at: number;
    updated_at: number;
}

export interface Wallet {
    id: string;
    profile_id: string;
    address: string;
    wallet_rdns: string | null;
    verified_at: number | null;
    last_checked_at: number | null;
    last_direct_chog_raw: string | null;
    last_lp_chog_raw: string | null;
    last_total_chog_raw: string | null;
    status: 'verified' | 'pending' | 'error';
    error_reason: string | null;
    created_at: number;
}

export interface Nonce {
    nonce: string;
    profile_id: string;
    created_at: number;
    expires_at: number;
    used_at: number | null;
}

export interface LpPair {
    pair_address: string;
    name: string | null;
    token0: string;
    token1: string;
    chog_side: number;
    enabled: number;
    created_at: number;
}

export interface ScreeningRun {
    id: string;
    started_at: number;
    finished_at: number | null;
    status: 'running' | 'success' | 'error' | 'partial';
    error: string | null;
    profiles_processed: number;
    wallets_processed: number;
    eligible_count: number;
    message_sent: number;
}

export interface ProfileSnapshot {
    run_id: string;
    profile_id: string;
    total_chog_raw: string;
    eligible: number;
    details_json: string;
}

// Query helpers
export async function getProfileByHandle(db: D1Database, handle: string): Promise<Profile | null> {
    const normalized = handle.toLowerCase().replace(/^@/, '');
    const result = await db.prepare(
        "SELECT * FROM profiles WHERE lower(replace(telegram_handle, '@', '')) = ?"
    ).bind(normalized).first<Profile>();
    return result;
}

export async function getProfileById(db: D1Database, id: string): Promise<Profile | null> {
    return db.prepare('SELECT * FROM profiles WHERE id = ?').bind(id).first<Profile>();
}

export async function getProfileByWalletAddress(db: D1Database, address: string): Promise<Profile | null> {
    const normalized = address.toLowerCase();
    const wallet = await db.prepare(
        'SELECT profile_id FROM wallets WHERE lower(address) = ?'
    ).bind(normalized).first<{ profile_id: string }>();

    if (!wallet) return null;
    return getProfileById(db, wallet.profile_id);
}

export async function createProfile(
    db: D1Database,
    id: string,
    handle: string,
    editSecretHash: string
): Promise<void> {
    const now = Date.now();
    await db.prepare(
        'INSERT INTO profiles (id, telegram_handle, edit_secret_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, handle, editSecretHash, now, now).run();
}

export async function updateProfileEditSecret(
    db: D1Database,
    id: string,
    editSecretHash: string
): Promise<void> {
    await db.prepare(
        'UPDATE profiles SET edit_secret_hash = ?, updated_at = ? WHERE id = ?'
    ).bind(editSecretHash, Date.now(), id).run();
}

export async function getWalletsByProfile(db: D1Database, profileId: string): Promise<Wallet[]> {
    const { results } = await db.prepare(
        'SELECT * FROM wallets WHERE profile_id = ? ORDER BY created_at DESC'
    ).bind(profileId).all<Wallet>();
    return results;
}

export async function getWalletByAddress(db: D1Database, address: string): Promise<Wallet | null> {
    const normalized = address.toLowerCase();
    return db.prepare(
        'SELECT * FROM wallets WHERE lower(address) = ?'
    ).bind(normalized).first<Wallet>();
}

export async function createWallet(
    db: D1Database,
    id: string,
    profileId: string,
    address: string,
    walletRdns: string | null
): Promise<void> {
    const now = Date.now();
    await db.prepare(
        `INSERT INTO wallets (id, profile_id, address, wallet_rdns, status, verified_at, created_at) 
     VALUES (?, ?, ?, ?, 'verified', ?, ?)`
    ).bind(id, profileId, address.toLowerCase(), walletRdns, now, now).run();
}

export async function deleteWallet(db: D1Database, profileId: string, address: string): Promise<boolean> {
    const result = await db.prepare(
        'DELETE FROM wallets WHERE profile_id = ? AND lower(address) = ?'
    ).bind(profileId, address.toLowerCase()).run();
    return result.meta.changes > 0;
}

export async function createNonce(
    db: D1Database,
    nonce: string,
    profileId: string,
    expiresAt: number
): Promise<void> {
    const now = Date.now();
    await db.prepare(
        'INSERT INTO nonces (nonce, profile_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(nonce, profileId, now, expiresAt).run();
}

export async function getNonce(db: D1Database, nonce: string): Promise<Nonce | null> {
    return db.prepare('SELECT * FROM nonces WHERE nonce = ?').bind(nonce).first<Nonce>();
}

export async function markNonceUsed(db: D1Database, nonce: string): Promise<void> {
    await db.prepare(
        'UPDATE nonces SET used_at = ? WHERE nonce = ?'
    ).bind(Date.now(), nonce).run();
}

export async function getEnabledLpPairs(db: D1Database): Promise<LpPair[]> {
    const { results } = await db.prepare(
        'SELECT * FROM lp_pairs WHERE enabled = 1'
    ).all<LpPair>();
    return results;
}

export async function getAllProfilesWithWallets(db: D1Database): Promise<(Profile & { wallets: Wallet[] })[]> {
    const { results: profiles } = await db.prepare('SELECT * FROM profiles').all<Profile>();

    const profilesWithWallets: (Profile & { wallets: Wallet[] })[] = [];

    for (const profile of profiles) {
        const wallets = await getWalletsByProfile(db, profile.id);
        if (wallets.length > 0) {
            profilesWithWallets.push({ ...profile, wallets });
        }
    }

    return profilesWithWallets;
}

export async function getLastScreeningRun(db: D1Database): Promise<ScreeningRun | null> {
    return db.prepare(
        'SELECT * FROM screening_runs WHERE status = ? ORDER BY started_at DESC LIMIT 1'
    ).bind('success').first<ScreeningRun>();
}

export async function getSnapshotsForRun(db: D1Database, runId: string): Promise<ProfileSnapshot[]> {
    const { results } = await db.prepare(
        'SELECT * FROM profile_snapshots WHERE run_id = ?'
    ).bind(runId).all<ProfileSnapshot>();
    return results;
}

export async function getLatestSnapshotForProfile(db: D1Database, profileId: string): Promise<ProfileSnapshot | null> {
    return db.prepare(
        `SELECT ps.* FROM profile_snapshots ps 
     JOIN screening_runs sr ON ps.run_id = sr.id 
     WHERE ps.profile_id = ? AND sr.status = 'success'
     ORDER BY sr.started_at DESC LIMIT 1`
    ).bind(profileId).first<ProfileSnapshot>();
}

export async function updateWalletBalances(
    db: D1Database,
    walletId: string,
    directChog: string,
    lpChog: string,
    totalChog: string
): Promise<void> {
    await db.prepare(
        `UPDATE wallets SET 
     last_direct_chog_raw = ?, 
     last_lp_chog_raw = ?, 
     last_total_chog_raw = ?,
     last_checked_at = ?
     WHERE id = ?`
    ).bind(directChog, lpChog, totalChog, Date.now(), walletId).run();
}
