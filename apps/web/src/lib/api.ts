// API client for backend endpoints

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface Profile {
    profile_id: string;
    telegram_handle: string;
    edit_secret?: string;
    edit_secret_hash?: string; // Returned for pending profiles
    has_edit_access: boolean;
    is_pending?: boolean; // True if profile not yet persisted to DB
    wallets: Wallet[];
    snapshot: ProfileSnapshot | null;
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

export interface ProfileSnapshot {
    run_id: string;
    profile_id: string;
    total_chog_raw: string;
    eligible: number;
    details_json: string;
}

export interface NonceResponse {
    nonce: string;
    expires_at: number;
    expires_in_seconds: number;
}

export interface WalletLookup {
    linked: boolean;
    profile_id?: string;
    telegram_handle?: string;
}

class ApiClient {
    private baseUrl: string;

    constructor(baseUrl: string = API_URL) {
        this.baseUrl = baseUrl;
    }

    private async fetch<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data as T;
    }

    // Profile endpoints
    async upsertProfile(telegramHandle: string, editSecret?: string): Promise<Profile> {
        return this.fetch<Profile>('/api/profile/upsert', {
            method: 'POST',
            body: JSON.stringify({ telegram_handle: telegramHandle, edit_secret: editSecret }),
        });
    }

    async getProfile(profileId: string): Promise<Profile> {
        return this.fetch<Profile>(`/api/profile/${profileId}`);
    }

    async recoverProfile(address: string): Promise<Profile> {
        return this.fetch<Profile>('/api/profile/recover', {
            method: 'POST',
            body: JSON.stringify({ address }),
        });
    }

    // SIWE endpoints
    async getNonce(profileId: string, editSecret: string, editSecretHash?: string): Promise<NonceResponse> {
        return this.fetch<NonceResponse>('/api/siwe/nonce', {
            method: 'POST',
            body: JSON.stringify({
                profile_id: profileId,
                edit_secret: editSecret,
                edit_secret_hash: editSecretHash,
            }),
        });
    }

    // Wallet endpoints
    async linkWallet(params: {
        profileId: string;
        editSecret: string;
        address: string;
        siweMessage: string;
        signature: string;
        walletRdns?: string;
        // For pending profiles (first wallet link)
        telegramHandle?: string;
        editSecretHash?: string;
    }): Promise<{ success: boolean; wallet_id: string; address: string }> {
        return this.fetch('/api/wallets/link', {
            method: 'POST',
            body: JSON.stringify({
                profile_id: params.profileId,
                edit_secret: params.editSecret,
                address: params.address,
                siwe_message: params.siweMessage,
                signature: params.signature,
                wallet_rdns: params.walletRdns,
                telegram_handle: params.telegramHandle,
                edit_secret_hash: params.editSecretHash,
            }),
        });
    }

    async unlinkWallet(params: {
        profileId: string;
        editSecret: string;
        address: string;
    }): Promise<{ success: boolean }> {
        return this.fetch('/api/wallets/unlink', {
            method: 'POST',
            body: JSON.stringify({
                profile_id: params.profileId,
                edit_secret: params.editSecret,
                address: params.address,
            }),
        });
    }

    async lookupWallet(address: string): Promise<WalletLookup> {
        return this.fetch<WalletLookup>(`/api/wallets/lookup/${address}`);
    }

    async getWhaleStats(): Promise<{ whale_total_millions: string; percentage: string }> {
        return this.fetch(`/api/profile/stats/whale-order`);
    }
}

export const api = new ApiClient();
