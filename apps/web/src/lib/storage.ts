// localStorage helpers for profile persistence

const STORAGE_KEYS = {
    PROFILE_ID: 'chogwatch_profile_id',
    EDIT_SECRET: 'chogwatch_edit_secret',
    TELEGRAM_HANDLE: 'chogwatch_telegram_handle',
} as const;

export interface StoredProfile {
    profileId: string;
    editSecret: string;
    telegramHandle: string;
}

/**
 * Save profile to localStorage
 */
export function saveProfile(profile: StoredProfile): void {
    if (typeof window === 'undefined') return;

    localStorage.setItem(STORAGE_KEYS.PROFILE_ID, profile.profileId);
    localStorage.setItem(STORAGE_KEYS.EDIT_SECRET, profile.editSecret);
    localStorage.setItem(STORAGE_KEYS.TELEGRAM_HANDLE, profile.telegramHandle);
}

/**
 * Load profile from localStorage
 */
export function loadProfile(): StoredProfile | null {
    if (typeof window === 'undefined') return null;

    const profileId = localStorage.getItem(STORAGE_KEYS.PROFILE_ID);
    const editSecret = localStorage.getItem(STORAGE_KEYS.EDIT_SECRET);
    const telegramHandle = localStorage.getItem(STORAGE_KEYS.TELEGRAM_HANDLE);

    if (!profileId || !editSecret || !telegramHandle) {
        return null;
    }

    return { profileId, editSecret, telegramHandle };
}

/**
 * Clear profile from localStorage
 */
export function clearProfile(): void {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(STORAGE_KEYS.PROFILE_ID);
    localStorage.removeItem(STORAGE_KEYS.EDIT_SECRET);
    localStorage.removeItem(STORAGE_KEYS.TELEGRAM_HANDLE);
}

/**
 * Update edit secret after recovery
 */
export function updateEditSecret(editSecret: string): void {
    if (typeof window === 'undefined') return;

    localStorage.setItem(STORAGE_KEYS.EDIT_SECRET, editSecret);
}
