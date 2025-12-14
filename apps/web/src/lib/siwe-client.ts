// SIWE message construction for client-side signing
import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';

export interface CreateSiweMessageParams {
    address: string;
    telegramHandle: string;
    nonce: string;
    chainId: number;
}

/**
 * Create a SIWE message for wallet linking
 */
export function createSiweMessage(params: CreateSiweMessageParams): string {
    const { address, telegramHandle, nonce, chainId } = params;

    // Normalize address to EIP-55 checksum format
    // SIWE library requires checksummed addresses but wallets often return lowercase
    const checksumAddress = getAddress(address);

    const domain = typeof window !== 'undefined' ? window.location.host : 'localhost';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

    const now = new Date();
    const expirationTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

    const message = new SiweMessage({
        domain,
        address: checksumAddress,
        statement: `Link wallet to Telegram handle ${telegramHandle}`,
        uri: origin,
        version: '1',
        chainId,
        nonce,
        issuedAt: now.toISOString(),
        expirationTime: expirationTime.toISOString(),
    });

    return message.prepareMessage();
}
