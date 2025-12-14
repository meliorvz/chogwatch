// Cryptographic utilities for edit secret hashing

/**
 * Generate a cryptographically secure random string
 */
export function generateSecret(length: number = 32): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Generate a UUID v4
 */
export function generateId(): string {
    return crypto.randomUUID();
}

/**
 * Hash a secret using SHA-256
 */
export async function hashSecret(secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(secret);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare a secret with a hash
 */
export async function verifySecret(secret: string, hash: string): Promise<boolean> {
    const secretHash = await hashSecret(secret);
    return secretHash === hash;
}

/**
 * Generate a nonce for SIWE
 */
export function generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a 6-digit OTP code
 */
export function generateOTP(): string {
    const array = new Uint8Array(4);
    crypto.getRandomValues(array);
    const num = new DataView(array.buffer).getUint32(0);
    return String(num % 1000000).padStart(6, '0');
}
