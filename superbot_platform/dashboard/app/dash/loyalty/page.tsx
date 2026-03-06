'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Crown,
  Users,
  Send,
  Plus,
  Trash2,
  Search,
  Edit2,
  Save,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Calendar,
  Clock,
} from 'lucide-react';

/* ───────── Types ───────── */

interface Club {
  id: string;
  name: string;
  description?: string;
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

interface Campaign {
  id: string;
  name: string;
  type: 'manual' | 'scheduled';
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  template_name?: string;
  ai_prompt?: string;
  scheduled_at?: string;
  created_at?: string;
}

type Tab = 'clubs' | 'members' | 'campaigns';

/* ───────── Helpers ───────── */

const statusBadge: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
};

/* ───────── Component ───────── */

export default function LoyaltyPage() {
  const router = useRouter();

  const [tenantId, setTenantId] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('clubs');

  // Clubs
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubsLoading, setClubsLoading] = useState(true);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [showClubForm, setShowClubForm] = useState(false);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [clubForm, setClubForm] = useState({ name: '', description: '' });
  const [clubSaving, setClubSaving] = useState(false);

  // Members
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberForm, setMemberForm] = useState({ phone: '', name: '', email: '' });
  const [memberSaving, setMemberSaving] = useState(false);

  // Campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    type: 'manual' as 'manual' | 'scheduled',
    template_name: '',
    ai_prompt: '',
    scheduled_at: '',
  });
  const [campaignSaving, setCampaignSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /* ───── Init ───── */

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }
    const user = JSON.parse(userData);
    const tId =
      user.role === 'admin'
        ? localStorage.getItem('active_tenant_id')
        : user.client_id;

    if (!tId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }
    setTenantId(tId);
    loadClubs(tId);
  }, [router]);

  /* ───── Clubs ───── */

  const loadClubs = async (tId: string) => {
    setClubsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/loyalty/clubs/${tId}`);
      setClubs(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load clubs');
    } finally {
      setClubsLoading(false);
    }
  };

  const openCreateClub = () => {
    setEditingClub(null);
    setClubForm({ name: '', description: '' });
    setShowClubForm(true);
  };

  const openEditClub = (club: Club) => {
    setEditingClub(club);
    setClubForm({ name: club.name, description: club.description || '' });
    setShowClubForm(true);
  };

  const saveClub = async () => {
    if (!clubForm.name.trim()) return;
    setClubSaving(true);
    setError(null);
    try {
      if (editingClub) {
        await api.patch(`/api/loyalty/clubs/${tenantId}/${editingClub.id}`, clubForm);
      } else {
        await api.post(`/api/loyalty/clubs/${tenantId}`, clubForm);
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
    setError(null);
    try {
      await api.delete(`/api/loyalty/clubs/${tenantId}/${clubId}`);
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
    setError(null);
    try {
      await api.patch(`/api/loyalty/clubs/${tenantId}/${club.id}`, {
        active: !club.active,
      });
      await loadClubs(tenantId);
      if (selectedClub?.id === club.id) {
        setSelectedClub({ ...club, active: !club.active });
      }
    } catch {
      setError('Failed to toggle club status');
    }
  };

  const selectClub = (club: Club) => {
    setSelectedClub(club);
    loadMembers(club.id);
    loadCampaigns(club.id);
  };

  /* ───── Members ───── */

  const loadMembers = async (clubId: string, search?: string) => {
    setMembersLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      if (search?.trim()) params.set('search', search.trim());
      const res = await api.get(
        `/api/loyalty/members/${tenantId}/${clubId}?${params.toString()}`
      );
      setMembers(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load members');
    } finally {
      setMembersLoading(false);
    }
  };

  const addMember = async () => {
    if (!selectedClub || !memberForm.phone.trim()) return;
    setMemberSaving(true);
    setError(null);
    try {
      await api.post(`/api/loyalty/members/${tenantId}/${selectedClub.id}`, {
        phone: memberForm.phone.trim(),
        name: memberForm.name.trim() || undefined,
        email: memberForm.email.trim() || undefined,
      });
      setMemberForm({ phone: '', name: '', email: '' });
      await loadMembers(selectedClub.id, memberSearch);
      await loadClubs(tenantId);
    } catch {
      setError('Failed to add member');
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!selectedClub || !confirm('Remove this member?')) return;
    setError(null);
    try {
      await api.delete(
        `/api/loyalty/members/${tenantId}/${selectedClub.id}/${memberId}`
      );
      await loadMembers(selectedClub.id, memberSearch);
      await loadClubs(tenantId);
    } catch {
      setError('Failed to remove member');
    }
  };

  const handleMemberSearch = () => {
    if (selectedClub) loadMembers(selectedClub.id, memberSearch);
  };

  /* ───── Campaigns ───── */

  const loadCampaigns = async (clubId: string) => {
    setCampaignsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/loyalty/campaigns/${tenantId}/${clubId}`);
      setCampaigns(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load campaigns');
    } finally {
      setCampaignsLoading(false);
    }
  };

  const openCreateCampaign = () => {
    setCampaignForm({
      name: '',
      type: 'manual',
      template_name: '',
      ai_prompt: '',
      scheduled_at: '',
    });
    setShowCampaignForm(true);
  };

  const saveCampaign = async () => {
    if (!selectedClub || !campaignForm.name.trim()) return;
    setCampaignSaving(true);
    setError(null);
    try {
      await api.post(`/api/loyalty/campaigns/${tenantId}/${selectedClub.id}`, {
        name: campaignForm.name.trim(),
        type: campaignForm.type,
        template_name: campaignForm.template_name.trim() || undefined,
        ai_prompt: campaignForm.ai_prompt.trim() || undefined,
        scheduled_at: campaignForm.scheduled_at || undefined,
      });
      setShowCampaignForm(false);
      await loadCampaigns(selectedClub.id);
    } catch {
      setError('Failed to save campaign');
    } finally {
      setCampaignSaving(false);
    }
  };

  const deleteCampaign = async (campaignId: string) => {
    if (!selectedClub || !confirm('Delete this campaign?')) return;
    setError(null);
    try {
      await api.delete(
        `/api/loyalty/campaigns/${tenantId}/${selectedClub.id}/${campaignId}`
      );
      await loadCampaigns(selectedClub.id);
    } catch {
      setError('Failed to delete campaign');
    }
  };

  /* ───── Render ───── */

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'clubs', label: 'Clubs', icon: <Crown className="w-4 h-4" /> },
    { key: 'members', label: 'Members', icon: <Users className="w-4 h-4" /> },
    { key: 'campaigns', label: 'Campaigns', icon: <Send className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Crown className="w-6 h-6 text-amber-500" />
          Loyalty Clubs
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage loyalty clubs, members and campaigns
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
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

      {/* Selected club indicator */}
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

      {/* ═══════ CLUBS TAB ═══════ */}
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

          {/* Club form modal */}
          {showClubForm && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">
                {editingClub ? 'Edit Club' : 'Create Club'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={clubForm.name}
                    onChange={(e) =>
                      setClubForm({ ...clubForm, name: e.target.value })
                    }
                    placeholder="Club name"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={clubForm.description}
                    onChange={(e) =>
                      setClubForm({ ...clubForm, description: e.target.value })
                    }
                    placeholder="Short description"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={saveClub}
                  disabled={clubSaving || !clubForm.name.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {clubSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
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

          {/* Club list */}
          {clubsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : clubs.length === 0 ? (
            <div className="text-center py-16">
              <Crown className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                No clubs yet
              </h3>
              <p className="text-sm text-gray-500">
                Create your first loyalty club to get started
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clubs.map((club) => (
                <div
                  key={club.id}
                  className={`bg-white rounded-xl shadow-sm border p-5 cursor-pointer transition-all hover:shadow-md ${
                    selectedClub?.id === club.id
                      ? 'border-blue-300 ring-2 ring-blue-100'
                      : 'border-gray-100'
                  }`}
                  onClick={() => selectClub(club)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Crown
                        className={`w-5 h-5 ${
                          club.active ? 'text-amber-500' : 'text-gray-300'
                        }`}
                      />
                      <h3 className="font-semibold text-gray-900">{club.name}</h3>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleClubActive(club);
                      }}
                      title={club.active ? 'Deactivate' : 'Activate'}
                    >
                      {club.active ? (
                        <ToggleRight className="w-6 h-6 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-gray-400" />
                      )}
                    </button>
                  </div>

                  {club.description && (
                    <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                      {club.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <Users className="w-3.5 h-3.5" />
                      {club.member_count ?? 0} members
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditClub(club);
                        }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteClub(club.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        club.active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {club.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ MEMBERS TAB ═══════ */}
      {activeTab === 'members' && (
        <div>
          {!selectedClub ? (
            <div className="text-center py-16">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                Select a club first
              </h3>
              <p className="text-sm text-gray-500">
                Go to the Clubs tab and select a club to manage members
              </p>
            </div>
          ) : (
            <>
              {/* Search + Add member */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">
                  Add Member
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Phone *
                    </label>
                    <input
                      type="text"
                      value={memberForm.phone}
                      onChange={(e) =>
                        setMemberForm({ ...memberForm, phone: e.target.value })
                      }
                      placeholder="5511999999999"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={memberForm.name}
                      onChange={(e) =>
                        setMemberForm({ ...memberForm, name: e.target.value })
                      }
                      placeholder="Contact name"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      value={memberForm.email}
                      onChange={(e) =>
                        setMemberForm({ ...memberForm, email: e.target.value })
                      }
                      placeholder="email@example.com"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={addMember}
                      disabled={memberSaving || !memberForm.phone.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 w-full justify-center"
                    >
                      {memberSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Search bar */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleMemberSearch()}
                    placeholder="Search by name, phone or email..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={handleMemberSearch}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              </div>

              {/* Members list */}
              {membersLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No members found</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-gray-900">
                        {members.length}
                      </span>{' '}
                      members
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Phone
                          </th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Email
                          </th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Joined
                          </th>
                          <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {members.map((m) => (
                          <tr key={m.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 text-sm text-gray-900 font-medium whitespace-nowrap">
                              {m.phone}
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">
                              {m.name || '-'}
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">
                              {m.email || '-'}
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">
                              {m.joined_at
                                ? new Date(m.joined_at).toLocaleDateString()
                                : '-'}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => removeMember(m.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                                title="Remove member"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════ CAMPAIGNS TAB ═══════ */}
      {activeTab === 'campaigns' && (
        <div>
          {!selectedClub ? (
            <div className="text-center py-16">
              <Send className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                Select a club first
              </h3>
              <p className="text-sm text-gray-500">
                Go to the Clubs tab and select a club to manage campaigns
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">Campaigns</h2>
                <button
                  onClick={openCreateCampaign}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  <Plus className="w-4 h-4" />
                  New Campaign
                </button>
              </div>

              {/* Campaign form */}
              {showCampaignForm && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">
                    Create Campaign
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Name *
                      </label>
                      <input
                        type="text"
                        value={campaignForm.name}
                        onChange={(e) =>
                          setCampaignForm({ ...campaignForm, name: e.target.value })
                        }
                        placeholder="Campaign name"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Type
                      </label>
                      <select
                        value={campaignForm.type}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            type: e.target.value as 'manual' | 'scheduled',
                          })
                        }
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="manual">Manual</option>
                        <option value="scheduled">Scheduled</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Template Name
                      </label>
                      <input
                        type="text"
                        value={campaignForm.template_name}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            template_name: e.target.value,
                          })
                        }
                        placeholder="WhatsApp template name"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {campaignForm.type === 'scheduled' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Scheduled At
                        </label>
                        <input
                          type="datetime-local"
                          value={campaignForm.scheduled_at}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              scheduled_at: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        AI Prompt (optional)
                      </label>
                      <textarea
                        value={campaignForm.ai_prompt}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            ai_prompt: e.target.value,
                          })
                        }
                        placeholder="Describe the message to generate with AI..."
                        rows={3}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={saveCampaign}
                      disabled={campaignSaving || !campaignForm.name.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {campaignSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Create
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

              {/* Campaigns list */}
              {campaignsLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : campaigns.length === 0 ? (
                <div className="text-center py-12">
                  <Send className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No campaigns yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((c) => (
                    <div
                      key={c.id}
                      className="bg-white rounded-xl shadow-sm border border-gray-100 p-5"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-gray-900">
                              {c.name}
                            </h3>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                statusBadge[c.status] || 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {c.status}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                              {c.type}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                            {c.template_name && (
                              <span className="flex items-center gap-1">
                                <Send className="w-3 h-3" />
                                {c.template_name}
                              </span>
                            )}
                            {c.scheduled_at && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(c.scheduled_at).toLocaleString()}
                              </span>
                            )}
                            {c.created_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Created{' '}
                                {new Date(c.created_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>

                          {c.ai_prompt && (
                            <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                              AI: {c.ai_prompt}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={() => deleteCampaign(c.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 ml-3"
                          title="Delete campaign"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
