'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Calendar,
  Check,
  Clock,
  Crown,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  Search,
  Send,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';

interface Club {
  id: string;
  name: string;
  description?: string;
  welcome_message?: string;
  active: boolean;
  member_count?: number;
  created_at?: string;
}

interface Member {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  joined_at?: string;
}

interface MediaItem {
  id: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  url: string;
  filename: string;
  description?: string;
}

interface Campaign {
  id: string;
  name: string;
  campaign_type: 'manual' | 'scheduled';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  template_name?: string;
  ai_prompt?: string;
  media_ids: string[];
  scheduled_at?: string;
  sent_at?: string;
  created_at?: string;
  recipients_count?: number;
  failed_count?: number;
}

interface ImportResult {
  created: number;
  updated: number;
  processed: number;
  errors: Array<{ line: number; error: string }>;
}

type Tab = 'clubs' | 'members' | 'campaigns';

const statusBadge: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const emptyCampaignForm = {
  name: '',
  campaign_type: 'manual' as 'manual' | 'scheduled',
  template_name: '',
  ai_prompt: '',
  scheduled_at: '',
  media_ids: [] as string[],
};

function mediaIcon(item: MediaItem) {
  if (item.media_type === 'image') return <ImageIcon className="w-4 h-4" />;
  if (item.media_type === 'video') return <Video className="w-4 h-4" />;
  if (item.media_type === 'audio') return <Music className="w-4 h-4" />;
  return <FileSpreadsheet className="w-4 h-4" />;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const detail = (
      error as { response?: { data?: { detail?: string } } }
    ).response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

export default function LoyaltyPage() {
  const router = useRouter();

  const [tenantId, setTenantId] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('clubs');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubsLoading, setClubsLoading] = useState(true);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [showClubForm, setShowClubForm] = useState(false);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [clubSaving, setClubSaving] = useState(false);
  const [clubForm, setClubForm] = useState({
    name: '',
    description: '',
    welcome_message: '',
  });

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberForm, setMemberForm] = useState({ phone: '', name: '', email: '' });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importingMembers, setImportingMembers] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [campaignSendingId, setCampaignSendingId] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState({ ...emptyCampaignForm });

  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const user = JSON.parse(userData);
    const nextTenantId =
      user.role === 'admin'
        ? localStorage.getItem('active_tenant_id')
        : user.client_id;

    if (!nextTenantId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(nextTenantId);
    void loadClubs(nextTenantId);
  }, [router]);

  useEffect(() => {
    if (!success && !error) return;
    const timer = window.setTimeout(() => {
      setSuccess(null);
      setError(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [success, error]);

  useEffect(() => {
    if (activeTab !== 'campaigns' || !selectedClub) return;
    const timer = window.setInterval(() => {
      void loadCampaigns(selectedClub.id);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeTab, selectedClub?.id]);

  const loadClubs = async (nextTenantId: string) => {
    setClubsLoading(true);
    try {
      const res = await api.get(`/api/loyalty/clubs/${nextTenantId}`);
      setClubs(res.data?.clubs || []);
    } catch {
      setError('Failed to load clubs');
    } finally {
      setClubsLoading(false);
    }
  };

  const loadMembers = async (clubId: string, search?: string) => {
    setMembersLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      if (search?.trim()) params.set('search', search.trim());
      const res = await api.get(
        `/api/loyalty/members/${tenantId}/${clubId}?${params.toString()}`
      );
      setMembers(res.data?.members || []);
    } catch {
      setError('Failed to load members');
    } finally {
      setMembersLoading(false);
    }
  };

  const loadCampaigns = async (clubId: string) => {
    setCampaignsLoading(true);
    try {
      const res = await api.get(`/api/loyalty/campaigns/${tenantId}/${clubId}`);
      setCampaigns(res.data?.campaigns || []);
    } catch {
      setError('Failed to load campaigns');
    } finally {
      setCampaignsLoading(false);
    }
  };

  const loadMediaLibrary = async () => {
    if (!tenantId) return;
    setMediaLoading(true);
    try {
      const res = await api.get(`/api/media/${tenantId}`);
      setMediaLibrary(res.data?.media || []);
    } catch {
      setError('Failed to load media library');
    } finally {
      setMediaLoading(false);
    }
  };

  const selectClub = (club: Club) => {
    setSelectedClub(club);
    setImportResult(null);
    void loadMembers(club.id);
    void loadCampaigns(club.id);
  };

  const openCreateClub = () => {
    setEditingClub(null);
    setClubForm({ name: '', description: '', welcome_message: '' });
    setShowClubForm(true);
  };

  const openEditClub = (club: Club) => {
    setEditingClub(club);
    setClubForm({
      name: club.name,
      description: club.description || '',
      welcome_message: club.welcome_message || '',
    });
    setShowClubForm(true);
  };

  const saveClub = async () => {
    if (!clubForm.name.trim()) return;
    setClubSaving(true);
    try {
      if (editingClub) {
        await api.patch(`/api/loyalty/clubs/${tenantId}/${editingClub.id}`, clubForm);
        setSuccess('Club updated');
      } else {
        await api.post(`/api/loyalty/clubs/${tenantId}`, clubForm);
        setSuccess('Club created');
      }
      setShowClubForm(false);
      await loadClubs(tenantId);
    } catch {
      setError('Failed to save club');
    } finally {
      setClubSaving(false);
    }
  };

  const deleteClub = async (clubId: string) => {
    if (!confirm('Delete this club? This action cannot be undone.')) return;
    try {
      await api.delete(`/api/loyalty/clubs/${tenantId}/${clubId}`);
      setSuccess('Club deleted');
      if (selectedClub?.id === clubId) {
        setSelectedClub(null);
        setMembers([]);
        setCampaigns([]);
      }
      await loadClubs(tenantId);
    } catch {
      setError('Failed to delete club');
    }
  };

  const toggleClubActive = async (club: Club) => {
    try {
      await api.patch(`/api/loyalty/clubs/${tenantId}/${club.id}`, {
        active: !club.active,
      });
      setSuccess(`Club ${club.active ? 'deactivated' : 'activated'}`);
      await loadClubs(tenantId);
      if (selectedClub?.id === club.id) {
        setSelectedClub({ ...club, active: !club.active });
      }
    } catch {
      setError('Failed to update club status');
    }
  };

  const addMember = async () => {
    if (!selectedClub || !memberForm.phone.trim()) return;
    setMemberSaving(true);
    try {
      await api.post(`/api/loyalty/members/${tenantId}/${selectedClub.id}`, {
        phone: memberForm.phone.trim(),
        name: memberForm.name.trim(),
        email: memberForm.email.trim(),
      });
      setMemberForm({ phone: '', name: '', email: '' });
      setSuccess('Member saved');
      await loadMembers(selectedClub.id, memberSearch);
      await loadClubs(tenantId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save member'));
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!selectedClub || !confirm('Remove this member?')) return;
    try {
      await api.delete(
        `/api/loyalty/members/${tenantId}/${selectedClub.id}/${memberId}`
      );
      setSuccess('Member removed');
      await loadMembers(selectedClub.id, memberSearch);
      await loadClubs(tenantId);
    } catch {
      setError('Failed to remove member');
    }
  };

  const importMembers = async () => {
    if (!selectedClub || !importFile) return;
    setImportingMembers(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post(
        `/api/loyalty/members/${tenantId}/${selectedClub.id}/import`,
        formData
      );
      setImportResult(res.data);
      setSuccess('CSV import finished');
      setImportFile(null);
      await loadMembers(selectedClub.id, memberSearch);
      await loadClubs(tenantId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to import members'));
    } finally {
      setImportingMembers(false);
    }
  };

  const openCreateCampaign = async () => {
    setCampaignForm({ ...emptyCampaignForm });
    setShowCampaignForm(true);
    await loadMediaLibrary();
  };

  const saveCampaign = async () => {
    if (!selectedClub || !campaignForm.name.trim()) return;
    setCampaignSaving(true);
    try {
      await api.post(`/api/loyalty/campaigns/${tenantId}/${selectedClub.id}`, {
        name: campaignForm.name.trim(),
        campaign_type: campaignForm.campaign_type,
        template_name: campaignForm.template_name.trim(),
        ai_prompt: campaignForm.ai_prompt.trim(),
        media_ids: campaignForm.media_ids,
        scheduled_at:
          campaignForm.campaign_type === 'scheduled' && campaignForm.scheduled_at
            ? new Date(campaignForm.scheduled_at).toISOString()
            : undefined,
      });
      setSuccess('Campaign created');
      setShowCampaignForm(false);
      await loadCampaigns(selectedClub.id);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save campaign'));
    } finally {
      setCampaignSaving(false);
    }
  };

  const sendCampaign = async (campaignId: string) => {
    if (!selectedClub) return;
    setCampaignSendingId(campaignId);
    try {
      await api.post(
        `/api/loyalty/campaigns/${tenantId}/${selectedClub.id}/${campaignId}/send`,
        {}
      );
      setSuccess('Campaign queued for sending');
      await loadCampaigns(selectedClub.id);
      window.setTimeout(() => {
        void loadCampaigns(selectedClub.id);
      }, 1500);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to queue campaign'));
    } finally {
      setCampaignSendingId(null);
    }
  };

  const deleteCampaign = async (campaignId: string) => {
    if (!selectedClub || !confirm('Delete this campaign?')) return;
    try {
      await api.delete(
        `/api/loyalty/campaigns/${tenantId}/${selectedClub.id}/${campaignId}`
      );
      setSuccess('Campaign deleted');
      await loadCampaigns(selectedClub.id);
    } catch {
      setError('Failed to delete campaign');
    }
  };

  const toggleMediaSelection = (mediaId: string) => {
    setCampaignForm((current) => ({
      ...current,
      media_ids: current.media_ids.includes(mediaId)
        ? current.media_ids.filter((id) => id !== mediaId)
        : [...current.media_ids, mediaId],
    }));
  };

  const selectedMedia = mediaLibrary.filter((item) =>
    campaignForm.media_ids.includes(item.id)
  );

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'clubs', label: 'Clubs', icon: <Crown className="w-4 h-4" /> },
    { key: 'members', label: 'Members', icon: <Users className="w-4 h-4" /> },
    { key: 'campaigns', label: 'Campaigns', icon: <Send className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Crown className="w-6 h-6 text-amber-500" />
          Loyalty Clubs
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage clubs, members and WhatsApp campaigns
        </p>
      </div>

      {(error || success) && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            error
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-green-50 border-green-200 text-green-700'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{error || success}</span>
            <button onClick={() => { setError(null); setSuccess(null); }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {selectedClub && activeTab !== 'clubs' && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
          <Crown className="w-4 h-4 text-amber-500" />
          <span className="font-medium">{selectedClub.name}</span>
          <button
            onClick={() => setActiveTab('clubs')}
            className="text-blue-600 hover:underline ml-2"
          >
            Change club
          </button>
        </div>
      )}

      {activeTab === 'clubs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Your Clubs</h2>
            <button
              onClick={openCreateClub}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
            >
              <Plus className="w-4 h-4" />
              New Club
            </button>
          </div>

          {showClubForm && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">
                {editingClub ? 'Edit Club' : 'Create Club'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  value={clubForm.name}
                  onChange={(e) =>
                    setClubForm((current) => ({ ...current, name: e.target.value }))
                  }
                  placeholder="Club name"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                />
                <input
                  type="text"
                  value={clubForm.description}
                  onChange={(e) =>
                    setClubForm((current) => ({
                      ...current,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Description"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                />
                <textarea
                  value={clubForm.welcome_message}
                  onChange={(e) =>
                    setClubForm((current) => ({
                      ...current,
                      welcome_message: e.target.value,
                    }))
                  }
                  placeholder="Optional welcome message"
                  rows={3}
                  className="md:col-span-2 w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm resize-none"
                />
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={saveClub}
                  disabled={clubSaving || !clubForm.name.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {clubSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingClub ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={() => setShowClubForm(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {clubsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : clubs.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-500">No clubs yet</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clubs.map((club) => (
                <div
                  key={club.id}
                  onClick={() => selectClub(club)}
                  className={`bg-white rounded-xl shadow-sm border p-5 cursor-pointer transition-all hover:shadow-md ${
                    selectedClub?.id === club.id
                      ? 'border-blue-300 ring-2 ring-blue-100'
                      : 'border-gray-100'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Crown className={`w-5 h-5 ${club.active ? 'text-amber-500' : 'text-gray-300'}`} />
                      <h3 className="font-semibold text-gray-900">{club.name}</h3>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleClubActive(club);
                      }}
                    >
                      {club.active ? (
                        <ToggleRight className="w-6 h-6 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-gray-400" />
                      )}
                    </button>
                  </div>
                  {club.description && (
                    <p className="text-sm text-gray-500 mb-3 line-clamp-2">{club.description}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{club.member_count ?? 0} members</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditClub(club);
                        }}
                        className="p-1.5 rounded-md hover:bg-gray-100"
                      >
                        <Check className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteClub(club.id);
                        }}
                        className="p-1.5 rounded-md hover:bg-red-50 text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div>
          {!selectedClub ? (
            <div className="text-center py-16 text-sm text-gray-500">Select a club first</div>
          ) : (
            <>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    value={memberForm.phone}
                    onChange={(e) =>
                      setMemberForm((current) => ({ ...current, phone: e.target.value }))
                    }
                    placeholder="Phone"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                  />
                  <input
                    type="text"
                    value={memberForm.name}
                    onChange={(e) =>
                      setMemberForm((current) => ({ ...current, name: e.target.value }))
                    }
                    placeholder="Name"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                  />
                  <input
                    type="email"
                    value={memberForm.email}
                    onChange={(e) =>
                      setMemberForm((current) => ({ ...current, email: e.target.value }))
                    }
                    placeholder="Email"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                  />
                  <button
                    onClick={() => void addMember()}
                    disabled={memberSaving || !memberForm.phone.trim()}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {memberSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Save member
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-600"
                  />
                  <button
                    onClick={() => void importMembers()}
                    disabled={!importFile || importingMembers}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {importingMembers ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Import CSV
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Expected columns: <code>phone</code>, <code>name</code>, <code>email</code>.
                </p>
                {importResult && (
                  <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
                    <p>
                      Processed {importResult.processed}. Created {importResult.created}. Updated {importResult.updated}.
                    </p>
                    {importResult.errors.length > 0 && (
                      <div className="mt-2 text-xs text-red-600 space-y-1">
                        {importResult.errors.slice(0, 5).map((item, index) => (
                          <p key={`${item.line}-${index}`}>Line {item.line}: {item.error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && selectedClub && void loadMembers(selectedClub.id, memberSearch)}
                    placeholder="Search by name, phone or email..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <button
                  onClick={() => selectedClub && void loadMembers(selectedClub.id, memberSearch)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              </div>

              {membersLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">No members found</div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Phone</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Joined</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {members.map((member) => (
                        <tr key={member.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-sm font-medium text-gray-900">{member.phone}</td>
                          <td className="px-5 py-3 text-sm text-gray-700">{member.name || '-'}</td>
                          <td className="px-5 py-3 text-sm text-gray-700">{member.email || '-'}</td>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => void removeMember(member.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'campaigns' && (
        <div>
          {!selectedClub ? (
            <div className="text-center py-16 text-sm text-gray-500">Select a club first</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">Campaigns</h2>
                <button
                  onClick={() => void openCreateCampaign()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  <Plus className="w-4 h-4" />
                  New Campaign
                </button>
              </div>

              {showCampaignForm && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Create Campaign</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                      type="text"
                      value={campaignForm.name}
                      onChange={(e) =>
                        setCampaignForm((current) => ({ ...current, name: e.target.value }))
                      }
                      placeholder="Campaign name"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                    />
                    <select
                      value={campaignForm.campaign_type}
                      onChange={(e) =>
                        setCampaignForm((current) => ({
                          ...current,
                          campaign_type: e.target.value as 'manual' | 'scheduled',
                          scheduled_at: e.target.value === 'manual' ? '' : current.scheduled_at,
                        }))
                      }
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="manual">Manual</option>
                      <option value="scheduled">Scheduled</option>
                    </select>
                    <input
                      type="text"
                      value={campaignForm.template_name}
                      onChange={(e) =>
                        setCampaignForm((current) => ({
                          ...current,
                          template_name: e.target.value,
                        }))
                      }
                      placeholder="Approved WhatsApp template"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                    />
                    {campaignForm.campaign_type === 'scheduled' && (
                      <input
                        type="datetime-local"
                        value={campaignForm.scheduled_at}
                        onChange={(e) =>
                          setCampaignForm((current) => ({
                            ...current,
                            scheduled_at: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                      />
                    )}
                    <textarea
                      value={campaignForm.ai_prompt}
                      onChange={(e) =>
                        setCampaignForm((current) => ({
                          ...current,
                          ai_prompt: e.target.value,
                        }))
                      }
                      placeholder="Describe the personalized message"
                      rows={3}
                      className="md:col-span-2 w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm resize-none"
                    />
                  </div>

                  <div className="mt-4 rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">Attached media</p>
                        <p className="text-xs text-gray-500">Select files from the media library</p>
                      </div>
                      <button
                        onClick={() => {
                          void loadMediaLibrary();
                          setShowMediaPicker(true);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                      >
                        <ImageIcon className="w-4 h-4" />
                        Choose media
                      </button>
                    </div>
                    {selectedMedia.length === 0 ? (
                      <p className="text-sm text-gray-500">No media selected</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {selectedMedia.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => toggleMediaSelection(item.id)}
                            className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700 border border-gray-200"
                          >
                            {mediaIcon(item)}
                            {item.filename}
                            <X className="w-3.5 h-3.5" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={() => void saveCampaign()}
                      disabled={campaignSaving || !campaignForm.name.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {campaignSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save Campaign
                    </button>
                    <button
                      onClick={() => setShowCampaignForm(false)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {campaignsLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : campaigns.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">No campaigns yet</div>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className="bg-white rounded-xl shadow-sm border border-gray-100 p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-3 mb-2">
                            <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                statusBadge[campaign.status] || 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {campaign.status}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                              {campaign.campaign_type}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                            {campaign.template_name && (
                              <span className="flex items-center gap-1">
                                <Send className="w-3 h-3" />
                                {campaign.template_name}
                              </span>
                            )}
                            {campaign.scheduled_at && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(campaign.scheduled_at).toLocaleString()}
                              </span>
                            )}
                            {campaign.sent_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Sent {new Date(campaign.sent_at).toLocaleString()}
                              </span>
                            )}
                            {campaign.recipients_count !== undefined && (
                              <span>{campaign.recipients_count} delivered</span>
                            )}
                            {campaign.failed_count ? (
                              <span className="text-red-600">{campaign.failed_count} failed</span>
                            ) : null}
                            {campaign.media_ids?.length ? (
                              <span>{campaign.media_ids.length} media</span>
                            ) : null}
                          </div>
                          {campaign.ai_prompt && (
                            <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                              AI: {campaign.ai_prompt}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void sendCampaign(campaign.id)}
                            disabled={campaignSendingId === campaign.id || campaign.status === 'sending'}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {campaignSendingId === campaign.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            Send
                          </button>
                          <button
                            onClick={() => void deleteCampaign(campaign.id)}
                            className="p-2 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showMediaPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Media Library</h3>
                <p className="text-sm text-gray-500">
                  Select one or more items to attach to the campaign
                </p>
              </div>
              <button
                onClick={() => setShowMediaPicker(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5">
              {mediaLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : mediaLibrary.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">No media available yet</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto">
                  {mediaLibrary.map((item) => {
                    const selected = campaignForm.media_ids.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleMediaSelection(item.id)}
                        className={`rounded-xl border p-4 text-left transition ${
                          selected
                            ? 'border-blue-400 ring-2 ring-blue-100 bg-blue-50/60'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-900 min-w-0">
                            {mediaIcon(item)}
                            <span className="truncate">{item.filename}</span>
                          </div>
                          {selected && <Check className="w-4 h-4 text-blue-600" />}
                        </div>
                        {item.media_type === 'image' ? (
                          <img
                            src={item.url}
                            alt={item.filename}
                            className="h-28 w-full rounded-lg object-cover border border-gray-200"
                          />
                        ) : item.media_type === 'video' ? (
                          <video
                            src={item.url}
                            className="h-28 w-full rounded-lg object-cover border border-gray-200"
                          />
                        ) : item.media_type === 'audio' ? (
                          <div className="h-28 w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500">
                            <Music className="w-6 h-6" />
                          </div>
                        ) : (
                          <div className="h-28 w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500">
                            <FileSpreadsheet className="w-6 h-6" />
                          </div>
                        )}
                        {item.description && (
                          <p className="mt-2 text-xs text-gray-500 line-clamp-2">{item.description}</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4">
              <p className="text-sm text-gray-500">{campaignForm.media_ids.length} selected</p>
              <button
                onClick={() => setShowMediaPicker(false)}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
