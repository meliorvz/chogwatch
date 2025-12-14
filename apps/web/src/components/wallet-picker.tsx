'use client';

import * as React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    EIP6963ProviderDetail,
    subscribeToProviders,
    initEIP6963Discovery,
    requestAccounts,
    switchToMonad,
    signMessage,
    MONAD_CHAIN,
} from '@/lib/eip6963';
import { api, Profile } from '@/lib/api';
import { createSiweMessage } from '@/lib/siwe-client';
import { AlertCircle, Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';

interface WalletPickerLinkProps {
    mode: 'link';
    open: boolean;
    onOpenChange: (open: boolean) => void;
    profileId: string;
    editSecret: string;
    telegramHandle: string;
    editSecretHash?: string; // Required for pending profiles (first wallet link)
    onWalletLinked: () => void;
}

interface WalletPickerRecoverProps {
    mode: 'recover';
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRecovered: (profile: Profile, editSecret: string) => void;
}

type WalletPickerProps = WalletPickerLinkProps | WalletPickerRecoverProps;

export function WalletPicker(props: WalletPickerProps) {
    const { open, onOpenChange, mode } = props;
    const [providers, setProviders] = React.useState<EIP6963ProviderDetail[]>([]);
    const [connecting, setConnecting] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        initEIP6963Discovery();
        return subscribeToProviders(setProviders);
    }, []);

    const handleConnect = async (providerDetail: EIP6963ProviderDetail) => {
        setConnecting(providerDetail.info.uuid);
        setError(null);

        try {
            const provider = providerDetail.provider;

            // 1. Request accounts
            const accounts = await requestAccounts(provider);
            if (!accounts.length) {
                throw new Error('No accounts returned');
            }
            const address = accounts[0];

            if (mode === 'recover') {
                // Recovery mode: just try to recover with this wallet
                const recovered = await api.recoverProfile(address);
                if (recovered.edit_secret) {
                    props.onRecovered(recovered, recovered.edit_secret);
                    onOpenChange(false);
                } else {
                    throw new Error('Recovery failed - no edit access granted');
                }
            } else {
                // Link mode: full SIWE flow
                const { profileId, editSecret, telegramHandle, editSecretHash, onWalletLinked } = props;

                // 2. Check if wallet is already linked
                const lookup = await api.lookupWallet(address);
                if (lookup.linked) {
                    if (lookup.profile_id === profileId) {
                        throw new Error('This wallet is already linked to your profile');
                    }
                    throw new Error('This wallet is already linked to another profile');
                }

                // 3. Switch to Monad chain
                await switchToMonad(provider);

                // 4. Get nonce from backend (pass editSecretHash for pending profiles)
                const { nonce } = await api.getNonce(profileId, editSecret, editSecretHash);

                // 5. Create SIWE message
                const siweMessage = createSiweMessage({
                    address,
                    telegramHandle,
                    nonce,
                    chainId: MONAD_CHAIN.chainId,
                });

                // 6. Sign message
                const signature = await signMessage(provider, siweMessage, address);

                // 7. Link wallet (and create profile if pending)
                await api.linkWallet({
                    profileId,
                    editSecret,
                    address,
                    siweMessage,
                    signature,
                    walletRdns: providerDetail.info.rdns,
                    telegramHandle, // For pending profiles
                    editSecretHash, // For pending profiles
                });

                toast.success('Wallet linked successfully!');
                onWalletLinked();
                onOpenChange(false);
            }
        } catch (err: any) {
            console.error('Wallet connection error:', err);

            if (err.code === 4001) {
                setError('Connection cancelled by user');
            } else if (err.message?.includes('No profile found')) {
                setError('No profile linked to this wallet');
            } else {
                setError(err.message || 'Failed to connect wallet');
            }
        } finally {
            setConnecting(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wallet className="h-5 w-5" />
                        {mode === 'recover' ? 'Recover with Wallet' : 'Choose a wallet'}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'recover'
                            ? "Connect a wallet that's already linked to a profile to recover access."
                            : "Select a wallet to link to your profile. You'll need to sign a message to verify ownership."}
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <div className="flex flex-col gap-2">
                    {providers.length === 0 ? (
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>No wallets detected</AlertTitle>
                            <AlertDescription>
                                Install a wallet extension like MetaMask, Rabby, or Phantom to continue.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        providers.map((provider) => (
                            <Button
                                key={provider.info.uuid}
                                variant="outline"
                                className="w-full justify-start gap-3 h-14"
                                onClick={() => handleConnect(provider)}
                                disabled={connecting !== null}
                            >
                                {connecting === provider.info.uuid ? (
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                ) : (
                                    <img
                                        src={provider.info.icon}
                                        alt={provider.info.name}
                                        className="h-6 w-6 rounded"
                                    />
                                )}
                                <div className="flex flex-col items-start">
                                    <span className="font-medium">{provider.info.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {provider.info.rdns}
                                    </span>
                                </div>
                            </Button>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
