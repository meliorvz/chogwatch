// CHOG exposure calculation using viem
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import type { LpPair } from './db';

// Monad Mainnet RPC URL (Chain ID 143)
const RPC_URL = "https://rpc.monad.xyz";

// ERC20 ABI for balanceOf and decimals
const ERC20_ABI = parseAbi([
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
]);

// V2 LP Pair ABI
const LP_PAIR_ABI = parseAbi([
    'function balanceOf(address account) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
]);

export interface ChogExposure {
    directBalance: bigint;
    lpBalance: bigint;
    totalBalance: bigint;
    lpBreakdown: Array<{
        pairAddress: string;
        pairName: string | null;
        userLpBalance: bigint;
        chogUnderlying: bigint;
    }>;
}

// Cache for CHOG decimals
let chogDecimalsCache: number | null = null;

/**
 * Get CHOG token decimals (cached)
 */
export async function getChogDecimals(
    rpcUrl: string,
    chogContract: string
): Promise<number> {
    if (chogDecimalsCache !== null) {
        return chogDecimalsCache;
    }

    const client = createPublicClient({
        transport: http(rpcUrl),
    });

    const decimals = await client.readContract({
        address: chogContract as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'decimals',
    });

    chogDecimalsCache = decimals;
    return decimals;
}

/**
 * Get CHOG token total supply
 */
export async function getChogTotalSupply(
    rpcUrl: string,
    chogContract: string
): Promise<bigint> {
    const client = createPublicClient({
        transport: http(rpcUrl),
    });

    const totalSupply = await client.readContract({
        address: chogContract as `0x${string}`,
        abi: parseAbi(['function totalSupply() view returns (uint256)']),
        functionName: 'totalSupply',
    });

    return totalSupply;
}

/**
 * Get direct CHOG balance for an address
 */
export async function getDirectChogBalance(
    rpcUrl: string,
    chogContract: string,
    userAddress: string
): Promise<bigint> {
    const client = createPublicClient({
        transport: http(rpcUrl),
    });

    const balance = await client.readContract({
        address: chogContract as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress as `0x${string}`],
    });

    return balance;
}

/**
 * Calculate CHOG exposure from a V2 LP position
 */
export async function getLpChogExposure(
    rpcUrl: string,
    chogContract: string,
    lpPair: LpPair,
    userAddress: string
): Promise<{ userLpBalance: bigint; chogUnderlying: bigint }> {
    const client = createPublicClient({
        transport: http(rpcUrl),
    });

    const pairAddress = lpPair.pair_address as `0x${string}`;

    // Batch read all LP data
    const [userLpBalance, totalSupply, reserves] = await Promise.all([
        client.readContract({
            address: pairAddress,
            abi: LP_PAIR_ABI,
            functionName: 'balanceOf',
            args: [userAddress as `0x${string}`],
        }),
        client.readContract({
            address: pairAddress,
            abi: LP_PAIR_ABI,
            functionName: 'totalSupply',
        }),
        client.readContract({
            address: pairAddress,
            abi: LP_PAIR_ABI,
            functionName: 'getReserves',
        }),
    ]);

    // If user has no LP tokens, return 0
    if (userLpBalance === 0n || totalSupply === 0n) {
        return { userLpBalance: 0n, chogUnderlying: 0n };
    }

    // Get CHOG reserve based on which side it's on
    const chogReserve = lpPair.chog_side === 0 ? reserves[0] : reserves[1];

    // Calculate user's share of CHOG in the pool
    // chogUnderlying = (userLpBalance / totalSupply) * chogReserve
    const chogUnderlying = (userLpBalance * chogReserve) / totalSupply;

    return { userLpBalance, chogUnderlying };
}

/**
 * Get total CHOG exposure for an address (direct + LP)
 */
export async function getTotalChogExposure(
    rpcUrl: string,
    chogContract: string,
    lpPairs: LpPair[],
    userAddress: string
): Promise<ChogExposure> {
    // Get direct balance
    const directBalance = await getDirectChogBalance(rpcUrl, chogContract, userAddress);

    // Get LP exposures
    const lpBreakdown: ChogExposure['lpBreakdown'] = [];
    let lpBalance = 0n;

    for (const pair of lpPairs) {
        try {
            const { userLpBalance, chogUnderlying } = await getLpChogExposure(
                rpcUrl,
                chogContract,
                pair,
                userAddress
            );

            if (chogUnderlying > 0n) {
                lpBreakdown.push({
                    pairAddress: pair.pair_address,
                    pairName: pair.name,
                    userLpBalance,
                    chogUnderlying,
                });
                lpBalance += chogUnderlying;
            }
        } catch (err) {
            console.error(`Error getting LP exposure for ${pair.pair_address}:`, err);
            // Continue with other pairs
        }
    }

    return {
        directBalance,
        lpBalance,
        totalBalance: directBalance + lpBalance,
        lpBreakdown,
    };
}

/**
 * Format raw CHOG balance for display (in millions)
 */
export function formatChogBalance(raw: bigint | string, decimals: number = 18): string {
    const value = typeof raw === 'string' ? BigInt(raw) : raw;
    // Convert to millions
    const whole = Number(value / BigInt(10 ** decimals));
    const inMillions = whole / 1_000_000;
    return `${inMillions.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

/**
 * Check if balance meets eligibility threshold
 */
export function isEligible(balance: bigint | string, thresholdRaw: string): boolean {
    const balanceValue = typeof balance === 'string' ? BigInt(balance) : balance;
    const threshold = BigInt(thresholdRaw);
    return balanceValue >= threshold;
}
