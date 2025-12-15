'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Shield,
    LogOut,
    RefreshCw,
    Wallet,
    Settings,
    Users,
    Clock,
    Loader2,
    Search,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    UserPlus,
    Trash2,
    Upload,
    Download,
    PieChart,
    UserMinus,
    UserCheck,
    MessageSquare,
    Lock,
    Unlock,
    Save,
    X,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface AdminProfile {
    id: string;
    telegram_handle: string;
    created_at: number;
    wallet_count: number;
    total_chog_raw: string | null;
    old_total_chog_raw: string | null;
    change_7d: string | null;
    in_group: number; // 1 = in group, 0 = left, -1 = unknown
}

interface ProfileWallet {
    id: string;
    address: string;
    last_total_chog_raw: string | null;
    last_checked_at: number | null;
    created_at: number;
    status: string;
}

interface AdminStats {
    profile_count: number;
    wallet_count: number;
    settings: Record<string, string>;
    recent_runs: any[];
}

interface WhaleOwnership {
    whale_total_raw: string;
    whale_total_formatted: string;
    total_supply_raw: string;
    total_supply_formatted: string;
    percentage: string;
}

interface GroupInfo {
    chat_id: number;
    title: string;
    type: string;
    tracked_member_count: number;
    error?: string;
}

interface KickAddLists {
    to_kick: Array<{ telegram_username: string; telegram_user_id: number; total_chog_raw: string | null }>;
    to_add: Array<{ telegram_handle: string; total_chog_raw: string }>;
    threshold_formatted: string;
}

interface Admin {
    id: string;
    telegram_handle: string;
    added_at: number;
    last_login_at: number | null;
}

interface ProfilePagination {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

export default function AdminPage() {
    // Auth state
    const [sessionToken, setSessionToken] = React.useState<string | null>(null);
    const [handle, setHandle] = React.useState('');
    const [otp, setOtp] = React.useState('');
    const [sessionId, setSessionId] = React.useState<string | null>(null);
    const [authStep, setAuthStep] = React.useState<'handle' | 'otp'>('handle');
    const [authLoading, setAuthLoading] = React.useState(false);

    // Dashboard state
    const [stats, setStats] = React.useState<AdminStats | null>(null);
    const [profiles, setProfiles] = React.useState<AdminProfile[]>([]);
    const [pagination, setPagination] = React.useState<ProfilePagination | null>(null);
    const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);
    const [search, setSearch] = React.useState('');
    const [currentPage, setCurrentPage] = React.useState(1);
    const [loading, setLoading] = React.useState(false);
    const [screeningLoading, setScreeningLoading] = React.useState(false);
    const [settingsLoading, setSettingsLoading] = React.useState(false);
    const [screeningInterval, setScreeningInterval] = React.useState('24');
    const [botNotificationsEnabled, setBotNotificationsEnabled] = React.useState(true);

    // Expanded profile state
    const [expandedProfileId, setExpandedProfileId] = React.useState<string | null>(null);
    const [profileWallets, setProfileWallets] = React.useState<ProfileWallet[]>([]);
    const [walletsLoading, setWalletsLoading] = React.useState(false);

    // New sections state
    const [whaleOwnership, setWhaleOwnership] = React.useState<WhaleOwnership | null>(null);
    const [groupInfo, setGroupInfo] = React.useState<GroupInfo | null>(null);
    const [kickAddLists, setKickAddLists] = React.useState<KickAddLists | null>(null);

    // Message templates state
    const [templates, setTemplates] = React.useState<Record<string, string>>({});
    const [templateLocks, setTemplateLocks] = React.useState<Record<string, boolean>>({
        msg_template_eligibility: true,
        msg_template_welcome: true,
        msg_template_status: true,
    });
    const [editingTemplate, setEditingTemplate] = React.useState<string | null>(null);
    const [templateDraft, setTemplateDraft] = React.useState('');
    const [templateSaving, setTemplateSaving] = React.useState(false);

    // Admin management state
    const [admins, setAdmins] = React.useState<Admin[]>([]);
    const [newAdminHandle, setNewAdminHandle] = React.useState('');
    const [adminLoading, setAdminLoading] = React.useState(false);

    // Load session from localStorage on mount
    React.useEffect(() => {
        const stored = localStorage.getItem('admin_session');
        if (stored) {
            try {
                const { token, expires_at } = JSON.parse(stored);
                if (expires_at > Date.now()) {
                    setSessionToken(token);
                } else {
                    localStorage.removeItem('admin_session');
                }
            } catch {
                localStorage.removeItem('admin_session');
            }
        }
    }, []);

    // Load dashboard data when authenticated
    React.useEffect(() => {
        if (sessionToken) {
            loadDashboardData();
            loadAdmins();
            loadWhaleOwnership();
            loadGroupInfo();
            loadKickAddLists();
        }
    }, [sessionToken]);

    const authFetch = async (path: string, options: RequestInit = {}) => {
        const res = await fetch(`${API_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
                ...options.headers,
            },
        });
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                handleLogout();
            }
            throw new Error(data.error || 'Request failed');
        }
        return data;
    };

    const handleRequestOTP = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!handle.trim()) return;

        setAuthLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/admin/auth/request-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram_handle: handle }),
            });
            const data = await res.json();

            if (data.session_id) {
                setSessionId(data.session_id);
                setAuthStep('otp');
                toast.success('Check your Telegram for the OTP code');
            } else {
                toast.error(data.error || 'Failed to request OTP');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to request OTP');
        } finally {
            setAuthLoading(false);
        }
    };

    const handleVerifyOTP = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otp.trim() || !sessionId) return;

        setAuthLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/admin/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId, otp }),
            });
            const data = await res.json();

            if (data.session_token) {
                setSessionToken(data.session_token);
                localStorage.setItem('admin_session', JSON.stringify({
                    token: data.session_token,
                    expires_at: data.expires_at,
                }));
                toast.success('Logged in successfully');
            } else {
                throw new Error(data.error || 'Failed to verify OTP');
            }
        } catch (err: any) {
            toast.error(err.message || 'Invalid OTP');
        } finally {
            setAuthLoading(false);
        }
    };

    const handleLogout = async () => {
        if (sessionToken) {
            try {
                await authFetch('/api/admin/auth/logout', { method: 'POST' });
            } catch {
                // Ignore logout errors
            }
        }
        setSessionToken(null);
        localStorage.removeItem('admin_session');
        setAuthStep('handle');
        setOtp('');
        setSessionId(null);
        toast.success('Logged out');
    };

    const loadDashboardData = async () => {
        setLoading(true);
        try {
            const [statsData, profilesData] = await Promise.all([
                authFetch('/api/admin/stats'),
                authFetch(`/api/admin/profiles?page=${currentPage}&search=${encodeURIComponent(search)}`),
            ]);
            setStats(statsData);
            setProfiles(profilesData.profiles);
            setPagination(profilesData.pagination);
            setLastUpdated(profilesData.last_updated);
            setScreeningInterval(statsData.settings.screening_interval_hours || '24');
            setBotNotificationsEnabled(statsData.settings.bot_notifications_enabled !== 'false');

            // Extract message templates from settings
            const loadedTemplates: Record<string, string> = {};
            if (statsData.settings.msg_template_eligibility) {
                loadedTemplates.msg_template_eligibility = statsData.settings.msg_template_eligibility;
            }
            if (statsData.settings.msg_template_welcome) {
                loadedTemplates.msg_template_welcome = statsData.settings.msg_template_welcome;
            }
            if (statsData.settings.msg_template_status) {
                loadedTemplates.msg_template_status = statsData.settings.msg_template_status;
            }
            setTemplates(loadedTemplates);
        } catch (err: any) {
            toast.error(err.message || 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveTemplate = async (key: string) => {
        setTemplateSaving(true);
        try {
            await authFetch(`/api/admin/settings/${key}`, {
                method: 'PUT',
                body: JSON.stringify({ value: templateDraft }),
            });
            setTemplates(prev => ({ ...prev, [key]: templateDraft }));
            setTemplateLocks(prev => ({ ...prev, [key]: true }));
            setEditingTemplate(null);
            toast.success('Template saved');
        } catch (err: any) {
            toast.error(err.message || 'Failed to save template');
        } finally {
            setTemplateSaving(false);
        }
    };

    const handleUnlockTemplate = (key: string) => {
        setTemplateLocks(prev => ({ ...prev, [key]: false }));
        setEditingTemplate(key);
        setTemplateDraft(templates[key] || getDefaultTemplate(key));
    };

    const handleLockTemplate = (key: string) => {
        setTemplateLocks(prev => ({ ...prev, [key]: true }));
        setEditingTemplate(null);
    };

    const getDefaultTemplate = (key: string): string => {
        switch (key) {
            case 'msg_template_eligibility':
                return `🐸 *CHOG Eligibility — {{date}}*

📊 *Summary*
• Eligible: {{eligibleCount}}
• New: {{newCount}}
• Dropped: {{droppedCount}}

{{#if newlyEligible}}
✅ *Newly Eligible*
{{#each newlyEligible}}
• @{{handle}} — {{totalChog}} CHOG
{{/each}}
{{/if}}

{{#if droppedEligible}}
❌ *No Longer Eligible*
{{#each droppedEligible}}
• @{{handle}}
{{/each}}
{{/if}}

{{#if topEligible}}
🏆 *Top 10 Holders*
{{#each topEligible}}
{{medal}} @{{handle}} — {{totalChog}} CHOG
{{/each}}
{{/if}}`;
            case 'msg_template_welcome':
                return '🐸 Welcome @{{username}}! Your CHOG eligibility has been verified.';
            case 'msg_template_status':
                return `🐸 *CHOG Status for @{{username}}*

💰 Total CHOG: {{totalChog}}
{{statusEmoji}} Status: {{statusText}}

_Threshold: {{threshold}} CHOG_`;
            default:
                return '';
        }
    };


    const loadAdmins = async () => {
        try {
            const data = await authFetch('/api/admin/admins');
            setAdmins(data.admins || []);
        } catch (err: any) {
            console.error('Failed to load admins:', err);
        }
    };

    const loadWhaleOwnership = async () => {
        try {
            const data = await authFetch('/api/admin/whale-ownership');
            setWhaleOwnership(data);
        } catch (err: any) {
            console.error('Failed to load whale ownership:', err);
        }
    };

    const loadGroupInfo = async () => {
        try {
            const data = await authFetch('/api/admin/group-info');
            setGroupInfo(data);
        } catch (err: any) {
            console.error('Failed to load group info:', err);
        }
    };

    const loadKickAddLists = async () => {
        try {
            const data = await authFetch('/api/admin/kick-add-lists');
            setKickAddLists(data);
        } catch (err: any) {
            console.error('Failed to load kick/add lists:', err);
        }
    };

    const loadProfileWallets = async (profileId: string) => {
        setWalletsLoading(true);
        try {
            const data = await authFetch(`/api/admin/profiles/${profileId}/wallets`);
            setProfileWallets(data.wallets);
        } catch (err: any) {
            toast.error('Failed to load wallets');
        } finally {
            setWalletsLoading(false);
        }
    };

    const handleExpandProfile = async (profileId: string) => {
        if (expandedProfileId === profileId) {
            setExpandedProfileId(null);
            setProfileWallets([]);
        } else {
            setExpandedProfileId(profileId);
            await loadProfileWallets(profileId);
        }
    };

    const handleAddAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAdminHandle.trim()) return;

        setAdminLoading(true);
        try {
            await authFetch('/api/admin/admins', {
                method: 'POST',
                body: JSON.stringify({ telegram_handle: newAdminHandle }),
            });
            toast.success(`Added admin @${newAdminHandle}`);
            setNewAdminHandle('');
            loadAdmins();
        } catch (err: any) {
            toast.error(err.message || 'Failed to add admin');
        } finally {
            setAdminLoading(false);
        }
    };

    const handleRemoveAdmin = async (adminId: string, handle: string) => {
        if (!confirm(`Remove @${handle} as admin?`)) return;

        try {
            await authFetch(`/api/admin/admins/${adminId}`, { method: 'DELETE' });
            toast.success(`Removed admin @${handle}`);
            loadAdmins();
        } catch (err: any) {
            toast.error(err.message || 'Failed to remove admin');
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setCurrentPage(1);
        loadDashboardData();
    };

    const handleRunScreening = async () => {
        setScreeningLoading(true);
        try {
            const result = await authFetch('/api/admin/screening/run-now', { method: 'POST' });
            toast.success(`Screening complete: ${result.result?.eligibleCount || 0} eligible`);
            loadDashboardData();
            loadWhaleOwnership();
            loadKickAddLists();
        } catch (err: any) {
            toast.error(err.message || 'Screening failed');
        } finally {
            setScreeningLoading(false);
        }
    };

    const handleUpdateInterval = async () => {
        setSettingsLoading(true);
        try {
            await authFetch('/api/admin/settings/screening_interval_hours', {
                method: 'PUT',
                body: JSON.stringify({ value: screeningInterval }),
            });
            toast.success('Screening interval updated');
        } catch (err: any) {
            toast.error(err.message || 'Failed to update setting');
        } finally {
            setSettingsLoading(false);
        }
    };

    const handleToggleBotNotifications = async (enabled: boolean) => {
        try {
            await authFetch('/api/admin/settings/bot_notifications_enabled', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled ? 'true' : 'false' }),
            });
            setBotNotificationsEnabled(enabled);
            toast.success(`Group notifications ${enabled ? 'enabled' : 'disabled'}`);
        } catch (err: any) {
            toast.error(err.message || 'Failed to update setting');
        }
    };

    const handleExportMembers = async () => {
        try {
            const data = await authFetch('/api/admin/group-members/export');
            // Create CSV content
            const headers = ['telegram_user_id', 'username', 'first_name', 'joined_at', 'source'];
            const csvRows = [headers.join(',')];
            for (const member of data.members) {
                const row = [
                    member.telegram_user_id,
                    member.telegram_username || '',
                    (member.first_name || '').replace(/,/g, ' '), // Escape commas in names
                    member.joined_at || '',
                    member.source || ''
                ];
                csvRows.push(row.join(','));
            }
            const csvContent = csvRows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'group_members.csv';
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Members exported as CSV');
        } catch (err: any) {
            toast.error('Failed to export members');
        }
    };

    const handleImportMembers = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const lines = text.trim().split('\n');
                if (lines.length < 2) {
                    toast.error('CSV file is empty or has no data rows');
                    return;
                }

                // Parse header to find column indices
                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                const userIdIdx = headers.findIndex(h => h === 'telegram_user_id' || h === 'user_id' || h === 'id');
                const usernameIdx = headers.findIndex(h => h === 'username' || h === 'telegram_username');
                const firstNameIdx = headers.findIndex(h => h === 'first_name' || h === 'firstname' || h === 'name');

                if (userIdIdx === -1) {
                    toast.error('CSV must have a telegram_user_id column');
                    return;
                }

                const members = [];
                for (let i = 1; i < lines.length; i++) {
                    const cols = lines[i].split(',');
                    const userId = parseInt(cols[userIdIdx], 10);
                    if (isNaN(userId)) continue;

                    members.push({
                        telegram_user_id: userId,
                        username: usernameIdx >= 0 ? cols[usernameIdx]?.trim() : undefined,
                        first_name: firstNameIdx >= 0 ? cols[firstNameIdx]?.trim() : undefined
                    });
                }

                if (members.length === 0) {
                    toast.error('No valid members found in CSV');
                    return;
                }

                const result = await authFetch('/api/admin/group-members/import', {
                    method: 'POST',
                    body: JSON.stringify({ members }),
                });
                toast.success(`Imported ${result.imported} new, updated ${result.updated} existing`);
                loadGroupInfo();
                loadKickAddLists();
                loadDashboardData();
            } catch (err: any) {
                toast.error('Failed to import members: ' + (err.message || 'Unknown error'));
            }
        };
        input.click();
    };

    const formatAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

    // For table rows: #,##0 format (whole numbers with thousand separators)
    const formatChog = (raw: string | null): string => {
        if (!raw) return '—';
        try {
            const value = BigInt(raw);
            const whole = Number(value / BigInt(10 ** 18));
            return whole.toLocaleString();
        } catch {
            return '—';
        }
    };

    // For summary stats: X.XM format
    const formatChogMillions = (raw: string | null): string => {
        if (!raw) return '—';
        try {
            const value = BigInt(raw);
            const inMillions = Number(value / BigInt(10 ** 18)) / 1_000_000;
            return `${inMillions.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M CHOG`;
        } catch {
            return '—';
        }
    };

    const formatTime = (ts: number | null): string => {
        if (!ts) return 'Never';
        return new Date(ts).toLocaleString();
    };

    // For 7d change: whole numbers with +/- prefix
    const formatChange = (change: string | null): React.ReactNode => {
        if (!change) return <span className="text-muted-foreground">—</span>;
        try {
            const value = BigInt(change);
            const whole = Number(value / BigInt(10 ** 18));
            const formatted = Math.abs(whole).toLocaleString();
            if (whole > 0) return <span className="text-green-500">+{formatted}</span>;
            if (whole < 0) return <span className="text-red-500">-{formatted}</span>;
            return <span className="text-muted-foreground">0</span>;
        } catch {
            return '—';
        }
    };

    const getInGroupBadge = (inGroup: number) => {
        if (inGroup === 1) return <Badge variant="success">✓ In Group</Badge>;
        if (inGroup === 0) return <Badge variant="destructive">Left</Badge>;
        return <Badge variant="secondary">Unknown</Badge>;
    };

    // Login screen
    if (!sessionToken) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-background">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
                            <Shield className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle>Admin Dashboard</CardTitle>
                        <CardDescription>
                            {authStep === 'handle'
                                ? 'Enter your Telegram handle to receive an OTP'
                                : 'Enter the OTP sent to your Telegram'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {authStep === 'handle' ? (
                            <form onSubmit={handleRequestOTP} className="space-y-4">
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50">
                                        @
                                    </span>
                                    <Input
                                        className="pl-7"
                                        placeholder="admin_username"
                                        value={handle}
                                        onChange={(e) => setHandle(e.target.value)}
                                        disabled={authLoading}
                                    />
                                </div>
                                <Button type="submit" className="w-full" disabled={authLoading || !handle.trim()}>
                                    {authLoading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Sending OTP...
                                        </>
                                    ) : (
                                        'Request OTP'
                                    )}
                                </Button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerifyOTP} className="space-y-4">
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    placeholder="000000"
                                    className="text-center text-2xl tracking-widest"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                    disabled={authLoading}
                                />
                                <Button type="submit" className="w-full" disabled={authLoading || otp.length !== 6}>
                                    {authLoading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Verifying...
                                        </>
                                    ) : (
                                        'Verify OTP'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="w-full"
                                    onClick={() => {
                                        setAuthStep('handle');
                                        setOtp('');
                                        setSessionId(null);
                                    }}
                                >
                                    Back
                                </Button>
                            </form>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Dashboard
    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Shield className="h-6 w-6 text-primary" />
                        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleLogout}>
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>

                {/* Stats Cards Row 1 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <Users className="h-8 w-8 text-muted-foreground" />
                                <div>
                                    <div className="text-2xl font-bold">
                                        {loading ? <Skeleton className="h-8 w-16" /> : stats?.profile_count || 0}
                                    </div>
                                    <div className="text-sm text-muted-foreground">Profiles</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <Wallet className="h-8 w-8 text-muted-foreground" />
                                <div>
                                    <div className="text-2xl font-bold">
                                        {loading ? <Skeleton className="h-8 w-16" /> : stats?.wallet_count || 0}
                                    </div>
                                    <div className="text-sm text-muted-foreground">Wallets</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <Clock className="h-8 w-8 text-muted-foreground" />
                                <div>
                                    <div className="text-2xl font-bold">
                                        {loading ? <Skeleton className="h-8 w-16" /> : `${screeningInterval}h`}
                                    </div>
                                    <div className="text-sm text-muted-foreground">Screening Interval</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <Button
                                className="w-full h-full min-h-[60px]"
                                onClick={handleRunScreening}
                                disabled={screeningLoading}
                            >
                                {screeningLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Running...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Run Screening
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Group Info & Whale Ownership Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Group Info */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <MessageSquare className="h-5 w-5" />
                                Linked Telegram Group
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {groupInfo ? (
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Name:</span>
                                        <span className="font-medium">{groupInfo.title || 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Chat ID:</span>
                                        <code className="bg-muted px-2 py-0.5 rounded">{groupInfo.chat_id}</code>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Tracked Members:</span>
                                        <span>{groupInfo.tracked_member_count}</span>
                                    </div>
                                    <div className="flex gap-2 mt-4">
                                        <Button variant="outline" size="sm" onClick={handleImportMembers}>
                                            <Upload className="h-4 w-4 mr-1" /> Import
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={handleExportMembers}>
                                            <Download className="h-4 w-4 mr-1" /> Export
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Skeleton className="h-24 w-full" />
                            )}
                        </CardContent>
                    </Card>

                    {/* Whale Ownership */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <PieChart className="h-5 w-5" />
                                Whale Ownership
                            </CardTitle>
                            <CardDescription>% of total CHOG supply held by tracked wallets</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {whaleOwnership ? (
                                <div className="flex items-center gap-6">
                                    {/* Simple pie visualization */}
                                    <div className="relative w-24 h-24">
                                        <svg viewBox="0 0 36 36" className="w-24 h-24 transform -rotate-90">
                                            <circle
                                                cx="18" cy="18" r="16"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="3"
                                                className="text-muted"
                                            />
                                            <circle
                                                cx="18" cy="18" r="16"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="3"
                                                strokeDasharray={`${parseFloat(whaleOwnership.percentage)} 100`}
                                                className="text-primary"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-lg font-bold">{whaleOwnership.percentage}%</span>
                                        </div>
                                    </div>
                                    <div className="space-y-1 text-sm">
                                        <div>
                                            <span className="text-muted-foreground">Whale Total: </span>
                                            <span className="font-medium">{whaleOwnership.whale_total_formatted} CHOG</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">Total Supply: </span>
                                            <span className="font-medium">{whaleOwnership.total_supply_formatted} CHOG</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <Skeleton className="h-24 w-full" />
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5" />
                            Settings
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-6">
                            <div className="flex-1 min-w-[200px] max-w-xs">
                                <label className="text-sm text-muted-foreground">
                                    Screening Interval (hours)
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        min="1"
                                        max="168"
                                        value={screeningInterval}
                                        onChange={(e) => setScreeningInterval(e.target.value)}
                                    />
                                    <Button onClick={handleUpdateInterval} disabled={settingsLoading}>
                                        {settingsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Group Messages */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <MessageSquare className="h-5 w-5" />
                                Group Messages
                            </CardTitle>
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="bot-notifications-header"
                                    checked={botNotificationsEnabled}
                                    onCheckedChange={handleToggleBotNotifications}
                                />
                                <label htmlFor="bot-notifications-header" className="text-sm">
                                    Notifications {botNotificationsEnabled ? 'On' : 'Off'}
                                </label>
                            </div>
                        </div>
                        <CardDescription>
                            Preview and customize automated messages sent to the Telegram group
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Daily Eligibility Summary */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium text-sm">Daily Eligibility Summary</h4>
                                {templateLocks.msg_template_eligibility ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleUnlockTemplate('msg_template_eligibility')}
                                    >
                                        <Lock className="h-4 w-4 mr-1" />
                                        Unlock to Edit
                                    </Button>
                                ) : (
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleLockTemplate('msg_template_eligibility')}
                                        >
                                            <X className="h-4 w-4 mr-1" />
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => handleSaveTemplate('msg_template_eligibility')}
                                            disabled={templateSaving}
                                        >
                                            {templateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Save</>}
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {editingTemplate === 'msg_template_eligibility' ? (
                                <textarea
                                    className="w-full h-64 p-3 text-sm font-mono bg-muted rounded-lg border resize-y"
                                    value={templateDraft}
                                    onChange={(e) => setTemplateDraft(e.target.value)}
                                />
                            ) : (
                                <pre className="p-3 text-sm bg-muted rounded-lg overflow-x-auto whitespace-pre-wrap">
                                    {templates.msg_template_eligibility || getDefaultTemplate('msg_template_eligibility')}
                                </pre>
                            )}
                        </div>

                        {/* Welcome Message */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium text-sm">Welcome Message</h4>
                                {templateLocks.msg_template_welcome ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleUnlockTemplate('msg_template_welcome')}
                                    >
                                        <Lock className="h-4 w-4 mr-1" />
                                        Unlock to Edit
                                    </Button>
                                ) : (
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleLockTemplate('msg_template_welcome')}
                                        >
                                            <X className="h-4 w-4 mr-1" />
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => handleSaveTemplate('msg_template_welcome')}
                                            disabled={templateSaving}
                                        >
                                            {templateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Save</>}
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {editingTemplate === 'msg_template_welcome' ? (
                                <textarea
                                    className="w-full h-20 p-3 text-sm font-mono bg-muted rounded-lg border resize-y"
                                    value={templateDraft}
                                    onChange={(e) => setTemplateDraft(e.target.value)}
                                />
                            ) : (
                                <pre className="p-3 text-sm bg-muted rounded-lg overflow-x-auto whitespace-pre-wrap">
                                    {templates.msg_template_welcome || getDefaultTemplate('msg_template_welcome')}
                                </pre>
                            )}
                        </div>

                        {/* Status Response */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium text-sm">Status Check Response (/status)</h4>
                                {templateLocks.msg_template_status ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleUnlockTemplate('msg_template_status')}
                                    >
                                        <Lock className="h-4 w-4 mr-1" />
                                        Unlock to Edit
                                    </Button>
                                ) : (
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleLockTemplate('msg_template_status')}
                                        >
                                            <X className="h-4 w-4 mr-1" />
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => handleSaveTemplate('msg_template_status')}
                                            disabled={templateSaving}
                                        >
                                            {templateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Save</>}
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {editingTemplate === 'msg_template_status' ? (
                                <textarea
                                    className="w-full h-32 p-3 text-sm font-mono bg-muted rounded-lg border resize-y"
                                    value={templateDraft}
                                    onChange={(e) => setTemplateDraft(e.target.value)}
                                />
                            ) : (
                                <pre className="p-3 text-sm bg-muted rounded-lg overflow-x-auto whitespace-pre-wrap">
                                    {templates.msg_template_status || getDefaultTemplate('msg_template_status')}
                                </pre>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Kick/Add Lists */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* To Kick */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-500">
                                <UserMinus className="h-5 w-5" />
                                To Kick ({kickAddLists?.to_kick.length || 0})
                            </CardTitle>
                            <CardDescription>
                                In group but below threshold ({kickAddLists?.threshold_formatted || '1M'} CHOG)
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {kickAddLists?.to_kick.length === 0 ? (
                                <p className="text-muted-foreground text-sm">No users to kick</p>
                            ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {kickAddLists?.to_kick.map((user, i) => (
                                        <div key={i} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded">
                                            <span>@{user.telegram_username || user.telegram_user_id}</span>
                                            <span className="text-muted-foreground">{formatChog(user.total_chog_raw)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* To Add */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-green-500">
                                <UserCheck className="h-5 w-5" />
                                To Add ({kickAddLists?.to_add.length || 0})
                            </CardTitle>
                            <CardDescription>
                                Eligible but not in group
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {kickAddLists?.to_add.length === 0 ? (
                                <p className="text-muted-foreground text-sm">No users to add</p>
                            ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {kickAddLists?.to_add.map((user, i) => (
                                        <div key={i} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded">
                                            <span>@{user.telegram_handle.replace('@', '')}</span>
                                            <span className="text-primary font-medium">{formatChog(user.total_chog_raw)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Profiles Table */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Users className="h-5 w-5" />
                                    Telegram Handles
                                </CardTitle>
                                {lastUpdated && (
                                    <CardDescription>
                                        Last updated: {formatTime(lastUpdated)}
                                    </CardDescription>
                                )}
                            </div>
                            <form onSubmit={handleSearch} className="flex gap-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search handle..."
                                        className="pl-9 w-64"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                                <Button type="submit" variant="secondary">
                                    Search
                                </Button>
                            </form>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="space-y-2">
                                {[...Array(5)].map((_, i) => (
                                    <Skeleton key={i} className="h-12 w-full" />
                                ))}
                            </div>
                        ) : (
                            <>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-8"></TableHead>
                                            <TableHead>Telegram Handle</TableHead>
                                            <TableHead>Wallets</TableHead>
                                            <TableHead>Total CHOG</TableHead>
                                            <TableHead>7d Change</TableHead>
                                            <TableHead>In Group</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {profiles.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center text-muted-foreground">
                                                    No profiles found
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            profiles.map((profile) => (
                                                <React.Fragment key={profile.id}>
                                                    <TableRow
                                                        className="cursor-pointer hover:bg-muted/50"
                                                        onClick={() => handleExpandProfile(profile.id)}
                                                    >
                                                        <TableCell>
                                                            {expandedProfileId === profile.id
                                                                ? <ChevronUp className="h-4 w-4" />
                                                                : <ChevronDown className="h-4 w-4" />
                                                            }
                                                        </TableCell>
                                                        <TableCell className="font-medium">
                                                            @{profile.telegram_handle.replace('@', '')}
                                                        </TableCell>
                                                        <TableCell>{profile.wallet_count}</TableCell>
                                                        <TableCell className="text-primary font-medium">
                                                            {formatChog(profile.total_chog_raw)}
                                                        </TableCell>
                                                        <TableCell>{formatChange(profile.change_7d)}</TableCell>
                                                        <TableCell>{getInGroupBadge(profile.in_group)}</TableCell>
                                                    </TableRow>
                                                    {expandedProfileId === profile.id && (
                                                        <TableRow>
                                                            <TableCell colSpan={6} className="bg-muted/30 p-4">
                                                                {walletsLoading ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                        Loading wallets...
                                                                    </div>
                                                                ) : (
                                                                    <Table>
                                                                        <TableHeader>
                                                                            <TableRow>
                                                                                <TableHead>Address</TableHead>
                                                                                <TableHead>CHOG Balance</TableHead>
                                                                                <TableHead>Last Checked</TableHead>
                                                                                <TableHead>Connected</TableHead>
                                                                            </TableRow>
                                                                        </TableHeader>
                                                                        <TableBody>
                                                                            {profileWallets.map((wallet) => (
                                                                                <TableRow key={wallet.id}>
                                                                                    <TableCell className="font-mono">
                                                                                        <a
                                                                                            href={`https://monadvision.com/address/${wallet.address}`}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            className="flex items-center gap-1 hover:text-primary"
                                                                                            onClick={(e) => e.stopPropagation()}
                                                                                        >
                                                                                            {formatAddress(wallet.address)}
                                                                                            <ExternalLink className="h-3 w-3" />
                                                                                        </a>
                                                                                    </TableCell>
                                                                                    <TableCell>{formatChog(wallet.last_total_chog_raw)}</TableCell>
                                                                                    <TableCell className="text-muted-foreground text-sm">
                                                                                        {formatTime(wallet.last_checked_at)}
                                                                                    </TableCell>
                                                                                    <TableCell className="text-muted-foreground text-sm">
                                                                                        {formatTime(wallet.created_at)}
                                                                                    </TableCell>
                                                                                </TableRow>
                                                                            ))}
                                                                        </TableBody>
                                                                    </Table>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </React.Fragment>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>

                                {/* Pagination */}
                                {pagination && pagination.pages > 1 && (
                                    <div className="flex items-center justify-between mt-4">
                                        <div className="text-sm text-muted-foreground">
                                            Showing {profiles.length} of {pagination.total} profiles
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={currentPage === 1}
                                                onClick={() => {
                                                    setCurrentPage((p) => p - 1);
                                                    loadDashboardData();
                                                }}
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </Button>
                                            <span className="text-sm">
                                                Page {currentPage} of {pagination.pages}
                                            </span>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={currentPage >= pagination.pages}
                                                onClick={() => {
                                                    setCurrentPage((p) => p + 1);
                                                    loadDashboardData();
                                                }}
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Admin Management */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            Admin Management
                        </CardTitle>
                        <CardDescription>
                            Manage who can access this dashboard
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Add admin form */}
                        <form onSubmit={handleAddAdmin} className="flex items-end gap-2">
                            <div className="flex-1 max-w-xs">
                                <label className="text-sm text-muted-foreground">
                                    Add Admin
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50">
                                        @
                                    </span>
                                    <Input
                                        className="pl-7"
                                        placeholder="username"
                                        value={newAdminHandle}
                                        onChange={(e) => setNewAdminHandle(e.target.value)}
                                        disabled={adminLoading}
                                    />
                                </div>
                            </div>
                            <Button type="submit" disabled={adminLoading || !newAdminHandle.trim()}>
                                {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                            </Button>
                        </form>

                        {/* Admin list */}
                        <div className="space-y-2">
                            {admins.map((admin) => (
                                <div key={admin.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                    <div>
                                        <span className="font-medium">@{admin.telegram_handle}</span>
                                        <span className="text-sm text-muted-foreground ml-2">
                                            Added {new Date(admin.added_at).toLocaleDateString()}
                                        </span>
                                        {admin.last_login_at && (
                                            <span className="text-sm text-muted-foreground ml-2">
                                                • Last login {new Date(admin.last_login_at).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveAdmin(admin.id, admin.telegram_handle)}
                                        className="text-destructive hover:text-destructive"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            {admins.length === 0 && (
                                <div className="text-center text-muted-foreground py-4">
                                    No admins found. You'll be added automatically on first login.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
