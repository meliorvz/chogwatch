'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet } from '@/lib/api';
import { Copy, Trash2, CheckCircle, AlertCircle, Clock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface WalletListProps {
    wallets: Wallet[];
    hasEditAccess: boolean;
    onUnlink: (address: string) => void;
}

export function WalletList({ wallets, hasEditAccess, onUnlink }: WalletListProps) {
    const copyAddress = (address: string) => {
        navigator.clipboard.writeText(address);
        toast.success('Address copied to clipboard');
    };

    const formatAddress = (address: string) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const formatChog = (raw: string | null): string => {
        if (!raw) return '—';
        try {
            const value = BigInt(raw);
            const decimals = 18;
            const divisor = BigInt(10 ** decimals);
            const whole = value / divisor;
            return whole.toLocaleString();
        } catch {
            return '—';
        }
    };

    const formatTime = (timestamp: number | null): string => {
        if (!timestamp) return 'Never';
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getStatusBadge = (status: Wallet['status']) => {
        switch (status) {
            case 'verified':
                return (
                    <Badge variant="success" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Verified
                    </Badge>
                );
            case 'pending':
                return (
                    <Badge variant="warning" className="gap-1">
                        <Clock className="h-3 w-3" />
                        Pending
                    </Badge>
                );
            case 'error':
                return (
                    <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Error
                    </Badge>
                );
        }
    };

    if (wallets.length === 0) {
        return (
            <div className="text-center py-8 text-muted-foreground">
                No wallets linked yet. Add a wallet to get started.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {wallets.map((wallet) => (
                <div
                    key={wallet.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card/50"
                >
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <code className="text-sm font-mono">
                                    {formatAddress(wallet.address)}
                                </code>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => copyAddress(wallet.address)}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                                <a
                                    href={`https://monadvision.com/address/${wallet.address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {getStatusBadge(wallet.status)}
                                <span>•</span>
                                <span>Last check: {formatTime(wallet.last_checked_at)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className="font-semibold text-primary">
                                {formatChog(wallet.last_total_chog_raw)} CHOG
                            </div>
                            {wallet.last_lp_chog_raw && BigInt(wallet.last_lp_chog_raw || '0') > BigInt(0) && (
                                <div className="text-xs text-muted-foreground">
                                    incl. {formatChog(wallet.last_lp_chog_raw)} from LP
                                </div>
                            )}
                        </div>

                        {hasEditAccess && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => onUnlink(wallet.address)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
