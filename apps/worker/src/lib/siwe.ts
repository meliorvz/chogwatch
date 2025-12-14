// SIWE (Sign-In with Ethereum) verification using viem
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';

export interface SiweVerifyResult {
    success: boolean;
    address?: string;
    error?: string;
}

export interface SiweVerifyOptions {
    message: string;
    signature: string;
    expectedDomain?: string; // Optional - skip domain validation if not provided
    expectedChainId: number;
    expectedNonce: string;
}

// Create a public client for signature verification
// Note: We use mainnet as a fallback since viem needs a client, 
// but signature verification is done locally without RPC calls
const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(),
});

/**
 * Verify a SIWE signature using viem
 */
export async function verifySiweSignature(options: SiweVerifyOptions): Promise<SiweVerifyResult> {
    const { message, signature, expectedDomain, expectedChainId, expectedNonce } = options;

    try {
        // Parse the SIWE message first to extract fields
        const parsedMessage = parseSiweMessage(message);

        if (!parsedMessage.address) {
            return { success: false, error: 'Invalid SIWE message: no address' };
        }

        // Verify the signature
        const isValid = await verifySiweMessage(publicClient, {
            message,
            signature: signature as `0x${string}`,
        });

        if (!isValid) {
            return { success: false, error: 'Invalid signature' };
        }

        // Check domain (only if expectedDomain is provided)
        if (expectedDomain && parsedMessage.domain !== expectedDomain) {
            return {
                success: false,
                error: `Invalid domain: expected ${expectedDomain}, got ${parsedMessage.domain}`
            };
        }

        // Check chain ID
        if (parsedMessage.chainId !== expectedChainId) {
            return {
                success: false,
                error: `Invalid chain ID: expected ${expectedChainId}, got ${parsedMessage.chainId}`
            };
        }

        // Check nonce
        if (parsedMessage.nonce !== expectedNonce) {
            return {
                success: false,
                error: `Invalid nonce: expected ${expectedNonce}, got ${parsedMessage.nonce}`
            };
        }

        // Check expiration
        if (parsedMessage.expirationTime) {
            const expiration = new Date(parsedMessage.expirationTime);
            if (expiration < new Date()) {
                return { success: false, error: 'Message has expired' };
            }
        }

        return { success: true, address: parsedMessage.address };
    } catch (err) {
        console.error('SIWE verification error:', err);
        let error = 'Unknown error';
        if (err instanceof Error) {
            error = err.message;
        } else if (typeof err === 'string') {
            error = err;
        } else if (err && typeof err === 'object') {
            error = JSON.stringify(err);
        }
        return { success: false, error };
    }
}

