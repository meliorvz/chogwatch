// EIP-6963 Multi Injected Provider Discovery
// https://eips.ethereum.org/EIPS/eip-6963

export interface EIP6963ProviderInfo {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
}

export interface EIP6963ProviderDetail {
    info: EIP6963ProviderInfo;
    provider: EIP1193Provider;
}

export interface EIP1193Provider {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

// Global state for discovered providers
let discoveredProviders: EIP6963ProviderDetail[] = [];
let listeners: Array<(providers: EIP6963ProviderDetail[]) => void> = [];

/**
 * Initialize EIP-6963 provider discovery
 * Call this once on app load
 */
export function initEIP6963Discovery(): void {
    if (typeof window === 'undefined') return;

    // Listen for provider announcements
    window.addEventListener('eip6963:announceProvider', ((
        event: CustomEvent<EIP6963ProviderDetail>
    ) => {
        const detail = event.detail;

        // Avoid duplicates
        if (!discoveredProviders.find(p => p.info.uuid === detail.info.uuid)) {
            discoveredProviders = [...discoveredProviders, detail];
            notifyListeners();
        }
    }) as EventListener);

    // Request providers to announce themselves
    window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/**
 * Subscribe to provider updates
 */
export function subscribeToProviders(
    callback: (providers: EIP6963ProviderDetail[]) => void
): () => void {
    listeners.push(callback);

    // Immediately notify with current providers
    callback(discoveredProviders);

    // Return unsubscribe function
    return () => {
        listeners = listeners.filter(l => l !== callback);
    };
}

/**
 * Get currently discovered providers
 */
export function getDiscoveredProviders(): EIP6963ProviderDetail[] {
    return discoveredProviders;
}

/**
 * Check if Phantom is available (special handling)
 * Phantom recommends checking window.phantom.ethereum to avoid conflicts
 */
export function getPhantomProvider(): EIP1193Provider | null {
    if (typeof window === 'undefined') return null;

    const phantom = (window as any).phantom?.ethereum;
    if (phantom?.isPhantom) {
        return phantom;
    }
    return null;
}

function notifyListeners(): void {
    listeners.forEach(l => l(discoveredProviders));
}

// Monad chain configuration
export const MONAD_CHAIN = {
    chainId: 143,
    chainIdHex: '0x8f',
    chainName: 'Monad',
    nativeCurrency: {
        name: 'MON',
        symbol: 'MON',
        decimals: 18,
    },
    rpcUrls: ['https://rpc.monad.xyz'],
    blockExplorerUrls: ['https://monadvision.com'],
};

/**
 * Request wallet to switch to Monad chain
 */
export async function switchToMonad(provider: EIP1193Provider): Promise<void> {
    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: MONAD_CHAIN.chainIdHex }],
        });
    } catch (error: any) {
        // Chain not added, try to add it
        if (error.code === 4902) {
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: MONAD_CHAIN.chainIdHex,
                    chainName: MONAD_CHAIN.chainName,
                    nativeCurrency: MONAD_CHAIN.nativeCurrency,
                    rpcUrls: MONAD_CHAIN.rpcUrls,
                    blockExplorerUrls: MONAD_CHAIN.blockExplorerUrls,
                }],
            });
        } else {
            throw error;
        }
    }
}

/**
 * Request accounts from wallet
 */
export async function requestAccounts(provider: EIP1193Provider): Promise<string[]> {
    const accounts = await provider.request({
        method: 'eth_requestAccounts',
    }) as string[];
    return accounts;
}

/**
 * Sign a message with personal_sign
 */
export async function signMessage(
    provider: EIP1193Provider,
    message: string,
    address: string
): Promise<string> {
    const signature = await provider.request({
        method: 'personal_sign',
        params: [message, address],
    }) as string;
    return signature;
}
