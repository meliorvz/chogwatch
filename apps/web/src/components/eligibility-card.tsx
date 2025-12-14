'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ProfileSnapshot, Wallet } from '@/lib/api';
import { CheckCircle, XCircle, TrendingUp } from 'lucide-react';

interface EligibilityCardProps {
    snapshot: ProfileSnapshot | null;
    wallets: Wallet[];
}

const ELIGIBILITY_THRESHOLD = 1_000_000;

export function EligibilityCard({ snapshot, wallets }: EligibilityCardProps) {
    const formatChog = (raw: string | null): { whole: string; formatted: string } => {
        if (!raw) return { whole: '0', formatted: '0' };
        try {
            const value = BigInt(raw);
            const decimals = 18;
            const divisor = BigInt(10 ** decimals);
            const whole = value / divisor;
            return {
                whole: whole.toString(),
                formatted: whole.toLocaleString()
            };
        } catch {
            return { whole: '0', formatted: '0' };
        }
    };

    // Calculate total from wallets in real-time if no snapshot
    const calculateTotalFromWallets = (): string => {
        let total = 0n;
        for (const wallet of wallets) {
            if (wallet.last_total_chog_raw) {
                try {
                    total += BigInt(wallet.last_total_chog_raw);
                } catch {
                    // Ignore invalid values
                }
            }
        }
        return total.toString();
    };

    // Use snapshot if available, otherwise calculate from wallet balances
    const totalChogRaw = snapshot?.total_chog_raw || calculateTotalFromWallets();
    const { whole, formatted } = formatChog(totalChogRaw);
    const totalChog = parseInt(whole, 10);

    // Eligibility: use snapshot if available, otherwise compute from real-time balance
    const isEligible = snapshot
        ? snapshot.eligible === 1
        : totalChog >= ELIGIBILITY_THRESHOLD;

    const hasScreeningData = !!snapshot;

    return (
        <Card className="border-primary/20">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Eligibility Status
                </CardTitle>
                <CardDescription>
                    Hold at least 1,000,000 CHOG across linked wallets
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-4xl font-bold text-primary">
                            {formatted}
                        </div>
                        <div className="text-sm text-muted-foreground">Total CHOG</div>
                    </div>
                    <div>
                        {isEligible ? (
                            <Badge variant="success" className="gap-1 text-lg py-1 px-3">
                                <CheckCircle className="h-4 w-4" />
                                Eligible
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="gap-1 text-lg py-1 px-3">
                                <XCircle className="h-4 w-4" />
                                Not Eligible
                            </Badge>
                        )}
                    </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <div className="text-muted-foreground">Threshold</div>
                        <div className="font-medium">1,000,000 CHOG</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Linked Wallets</div>
                        <div className="font-medium">{wallets.length}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Progress</div>
                        <div className="font-medium">
                            {Math.min(100, (totalChog / ELIGIBILITY_THRESHOLD) * 100).toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Last Check</div>
                        <div className="font-medium">
                            {hasScreeningData ? 'Daily screening' : 'Real-time'}
                        </div>
                    </div>
                </div>

                {!isEligible && totalChog > 0 && (
                    <div className="text-sm text-muted-foreground text-center pt-2">
                        Need {(ELIGIBILITY_THRESHOLD - totalChog).toLocaleString()} more CHOG to be eligible
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
