'use client';

import * as React from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { WalletPicker } from '@/components/wallet-picker';
import { WalletList } from '@/components/wallet-list';
import { EligibilityCard } from '@/components/eligibility-card';
import { api, Profile } from '@/lib/api';
import { loadProfile, saveProfile, clearProfile } from '@/lib/storage';
import { initEIP6963Discovery, subscribeToProviders, EIP6963ProviderDetail } from '@/lib/eip6963';
import { Plus, LogOut, Wallet, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface WhaleStats {
    whale_total_millions: string;
    percentage: string;
}

export default function HomePage() {
    const [handle, setHandle] = React.useState('');
    const [handleError, setHandleError] = React.useState<string | null>(null);
    const [profile, setProfile] = React.useState<Profile | null>(null);
    const [editSecret, setEditSecret] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [submitting, setSubmitting] = React.useState(false);
    const [walletPickerOpen, setWalletPickerOpen] = React.useState(false);
    const [recoveryPickerOpen, setRecoveryPickerOpen] = React.useState(false);
    const [providers, setProviders] = React.useState<EIP6963ProviderDetail[]>([]);
    const [whaleStats, setWhaleStats] = React.useState<WhaleStats | null>(null);

    // Telegram username validation rules:
    // - 5-32 characters
    // - Only a-z, A-Z, 0-9, underscore (_)
    // - Case-insensitive
    const validateHandle = (value: string): string | null => {
        if (!value) return null;
        if (value.length < 5) return 'Username must be at least 5 characters';
        if (value.length > 32) return 'Username must be at most 32 characters';
        if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers, and underscores allowed';
        return null;
    };

    const handleHandleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setHandle(value);
        setHandleError(validateHandle(value));
    };

    // Fetch whale stats for landing page
    React.useEffect(() => {
        api.getWhaleStats()
            .then(setWhaleStats)
            .catch((err) => console.error('Failed to load whale stats:', err));
    }, []);

    // Initialize and load stored profile
    React.useEffect(() => {
        initEIP6963Discovery();
        const unsub = subscribeToProviders(setProviders);

        const stored = loadProfile();
        if (stored) {
            // Try to load the profile
            api.upsertProfile(stored.telegramHandle, stored.editSecret)
                .then((p) => {
                    setProfile(p);
                    if (p.has_edit_access && p.edit_secret) {
                        setEditSecret(p.edit_secret);
                    } else if (stored.editSecret) {
                        setEditSecret(stored.editSecret);
                    }
                    setHandle(p.telegram_handle);
                })
                .catch((err) => {
                    console.error('Failed to load profile:', err);
                    clearProfile();
                })
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }

        return unsub;
    }, []);

    const handleCreateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!handle.trim()) return;

        // Validate handle before submission
        const error = validateHandle(handle);
        if (error) {
            setHandleError(error);
            return;
        }

        setSubmitting(true);
        try {
            const p = await api.upsertProfile(handle);
            setProfile(p);

            if (p.edit_secret) {
                setEditSecret(p.edit_secret);
                saveProfile({
                    profileId: p.profile_id,
                    editSecret: p.edit_secret,
                    telegramHandle: p.telegram_handle,
                });
                toast.success('Profile created!');
            } else if (!p.has_edit_access) {
                toast.info('Profile exists. Connect a linked wallet to edit.');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to create profile');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRecoverWithWallet = () => {
        setRecoveryPickerOpen(true);
    };

    const handleRecoverySuccess = (recovered: Profile, secret: string) => {
        setProfile(recovered);
        setEditSecret(secret);
        saveProfile({
            profileId: recovered.profile_id,
            editSecret: secret,
            telegramHandle: recovered.telegram_handle,
        });
        toast.success('Profile recovered! You now have edit access.');
    };

    const handleUnlinkWallet = async (address: string) => {
        if (!profile || !editSecret) return;

        try {
            await api.unlinkWallet({
                profileId: profile.profile_id,
                editSecret,
                address,
            });

            // Refresh profile
            const updated = await api.getProfile(profile.profile_id);
            setProfile({
                ...updated,
                has_edit_access: true,
            });
            toast.success('Wallet unlinked');
        } catch (err: any) {
            toast.error(err.message || 'Failed to unlink wallet');
        }
    };

    const handleWalletLinked = async () => {
        if (!profile) return;

        // Refresh profile
        const updated = await api.getProfile(profile.profile_id);
        setProfile({
            ...updated,
            has_edit_access: !!editSecret,
        });
    };

    const handleLogout = () => {
        clearProfile();
        setProfile(null);
        setEditSecret(null);
        setHandle('');
        toast.success('Logged out');
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <Card className="w-full max-w-xl">
                    <CardHeader>
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-4 w-72" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-10 w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Landing / Create profile view
    if (!profile) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <Card className="w-full max-w-xl">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4">
                            <Image src="/choglogo.svg" alt="CHOG" width={80} height={80} className="mx-auto" />
                        </div>
                        <CardTitle className="text-2xl">Chog Whale Order</CardTitle>
                        <CardDescription>
                            {whaleStats ? (
                                <>The whales currently control <span style={{ color: '#22c55e', fontWeight: 600 }}>{whaleStats.whale_total_millions}M CHOG</span> ({whaleStats.percentage}% supply).<br />Link your wallets to join the order.</>
                            ) : (
                                <>Link your wallets to join the whale order.</>
                            )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreateProfile} className="space-y-4">
                            <div className="space-y-2">
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 select-none pointer-events-none">
                                        @
                                    </span>
                                    <Input
                                        className="pl-7"
                                        placeholder="username"
                                        value={handle}
                                        onChange={handleHandleChange}
                                        disabled={submitting}
                                        maxLength={32}
                                    />
                                </div>
                                {handleError && (
                                    <p className="text-sm text-destructive">{handleError}</p>
                                )}
                            </div>
                            <Button
                                type="submit"
                                className="w-full"
                                disabled={submitting || !handle.trim() || !!handleError}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    'Continue'
                                )}
                            </Button>
                        </form>

                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <Separator />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">
                                    Or recover existing profile
                                </span>
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={handleRecoverWithWallet}
                        >
                            <Wallet className="mr-2 h-4 w-4" />
                            Connect with linked wallet
                        </Button>

                        {/* Recovery Wallet Picker Dialog */}
                        <WalletPicker
                            mode="recover"
                            open={recoveryPickerOpen}
                            onOpenChange={setRecoveryPickerOpen}
                            onRecovered={handleRecoverySuccess}
                        />
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Profile dashboard view
    return (
        <div className="flex-1 p-4 md:p-8">
            <div className="mx-auto max-w-2xl space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Image src="/choglogo.svg" alt="CHOG" width={32} height={32} className="inline-block" />
                            {profile.telegram_handle}
                        </h1>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleLogout}>
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>

                {/* Read-only warning */}
                {!profile.has_edit_access && (
                    <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Read-only mode</AlertTitle>
                        <AlertDescription className="flex items-center justify-between">
                            <span>Connect a linked wallet to edit this profile.</span>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRecoverWithWallet}
                            >
                                Recover access
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

                {/* Eligibility Card */}
                <EligibilityCard
                    snapshot={profile.snapshot}
                    wallets={profile.wallets}
                />

                {/* Wallets Card */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                            <CardTitle className="text-lg">Linked Wallets</CardTitle>
                            <CardDescription>
                                {profile.wallets.length} wallet{profile.wallets.length !== 1 ? 's' : ''} linked
                            </CardDescription>
                        </div>
                        {profile.has_edit_access && (
                            <Button onClick={() => setWalletPickerOpen(true)}>
                                <Plus className="h-4 w-4 mr-2" />
                                Add Wallet
                            </Button>
                        )}
                    </CardHeader>
                    <CardContent>
                        <WalletList
                            wallets={profile.wallets}
                            hasEditAccess={profile.has_edit_access}
                            onUnlink={handleUnlinkWallet}
                        />
                    </CardContent>
                </Card>

                {/* Wallet Picker Dialog */}
                {editSecret && (
                    <WalletPicker
                        mode="link"
                        open={walletPickerOpen}
                        onOpenChange={setWalletPickerOpen}
                        profileId={profile.profile_id}
                        editSecret={editSecret}
                        telegramHandle={profile.telegram_handle}
                        editSecretHash={profile.edit_secret_hash}
                        onWalletLinked={handleWalletLinked}
                    />
                )}
            </div>
        </div>
    );
}
