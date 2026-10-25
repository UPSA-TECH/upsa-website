'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { API_BASE, apiDownload, apiRequest } from './api';
import { useToast } from '../_components/Toast';
import {
  AVATAR_COLORS,
  type Certification,
  type ChatMessage,
  type Connection,
  type ConnectionRequest,
  type Education,
  type Member,
  type RequestType,
  type WorkExperience,
} from './types';

// Same public/guest routes middleware.ts leaves unauthenticated - these
// never need real portal data, so the provider shouldn't block on them.
function isPublicPortalRoute(pathname: string | null) {
  if (pathname === null) return true;
  return pathname === '/portal' || pathname.startsWith('/portal/sign-in') || pathname.startsWith('/portal/sign-up');
}

// --- raw API response shapes ---------------------------------------------

type ApiEducation = {
  id: number;
  school: string;
  degree: string;
  fieldOfStudy: string;
  startYear: number | null;
  endYear: number | null;
  currentlyStudying: boolean;
};

type ApiWorkExperience = {
  id: number;
  jobTitle: string;
  company: string;
  employmentType: string;
  startDate: string | null;
  endDate: string | null;
  currentlyWorking: boolean;
  description: string;
};

type ApiCertification = {
  id: number;
  name: string;
  issuingOrganization: string;
  issueDate: string | null;
  expirationDate: string | null;
  credentialUrl: string;
};

type ApiProfile = {
  id: number;
  name: string;
  headline: string;
  university: string;
  major: string;
  company: string;
  role: string;
  industry: string;
  location: string;
  bio: string;
  skills: string[];
  referralsAvailable: boolean;
  isProfessional: boolean;
  deactivated: boolean;
  emailNotifications?: boolean;
  avatarUrl: string | null;
  hasAvatar: boolean;
  onboardingComplete: boolean;
  termsAccepted: boolean;
  education: ApiEducation[];
  experience: ApiWorkExperience[];
  certifications: ApiCertification[];
};

type ApiRequest = {
  id: number;
  fromId: number;
  toId: number;
  requestType: RequestType;
  message: string;
  status: ConnectionRequest['status'];
  createdAt: string;
};

type ApiConnection = {
  id: number;
  requestId: number;
  memberIds: number[];
  status: Connection['status'];
  since: string;
  lastMessage?: { text: string; senderId: number; createdAt: string } | null;
};

type ApiMessage = {
  id: number;
  connectionId: number;
  senderId: number;
  text: string;
  createdAt: string;
  attachment: 'resume' | '';
  resumeId: number | null;
  resumeFileName: string | null;
  resumeSizeLabel: string | null;
};

type Paginated<T> = { results: T[]; next?: string | null } | T[];

function resultsOf<T>(data: Paginated<T>): T[] {
  return Array.isArray(data) ? data : data.results;
}

// --- mapping helpers: API shape -> frontend shape --------------------------

export function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || 'U';
}

// The backend doesn't store a color, so pick one deterministically from the
// id - same person always lands on the same color without needing a column.
function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function timeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = diffSec / 60;
  if (diffMin < 60) return `${Math.round(diffMin)} minute${Math.round(diffMin) === 1 ? '' : 's'} ago`;
  const diffHr = diffMin / 60;
  if (diffHr < 24) return `${Math.round(diffHr)} hour${Math.round(diffHr) === 1 ? '' : 's'} ago`;
  const diffDay = diffHr / 24;
  if (diffDay < 7) return `${Math.round(diffDay)} day${Math.round(diffDay) === 1 ? '' : 's'} ago`;
  const diffWeek = diffDay / 7;
  if (diffWeek < 5) return `${Math.round(diffWeek)} week${Math.round(diffWeek) === 1 ? '' : 's'} ago`;
  const diffMonth = diffDay / 30;
  if (diffMonth < 12) return `${Math.round(diffMonth)} month${Math.round(diffMonth) === 1 ? '' : 's'} ago`;
  const diffYear = diffDay / 365;
  return `${Math.round(diffYear)} year${Math.round(diffYear) === 1 ? '' : 's'} ago`;
}

function toEducation(e: ApiEducation): Education {
  return {
    id: String(e.id),
    school: e.school,
    degree: e.degree || undefined,
    fieldOfStudy: e.fieldOfStudy || undefined,
    startYear: e.startYear ?? undefined,
    endYear: e.endYear ?? undefined,
    currentlyStudying: e.currentlyStudying,
  };
}

function toWorkExperience(e: ApiWorkExperience): WorkExperience {
  return {
    id: String(e.id),
    jobTitle: e.jobTitle,
    company: e.company,
    employmentType: e.employmentType || undefined,
    startDate: e.startDate ?? undefined,
    endDate: e.endDate ?? undefined,
    currentlyWorking: e.currentlyWorking,
    description: e.description || undefined,
  };
}

function toCertification(c: ApiCertification): Certification {
  return {
    id: String(c.id),
    name: c.name,
    issuingOrganization: c.issuingOrganization || undefined,
    issueDate: c.issueDate ?? undefined,
    expirationDate: c.expirationDate ?? undefined,
    credentialUrl: c.credentialUrl || undefined,
  };
}

function toMember(p: ApiProfile): Member {
  const name = p.name || PLACEHOLDER_NAME;
  return {
    id: String(p.id),
    name,
    initials: initialsFromName(name),
    avatarColor: colorForId(String(p.id)),
    // Local dev serves photos from the backend (relative path); R2 gives a full URL.
    avatarUrl: p.avatarUrl ? (/^https?:\/\//.test(p.avatarUrl) ? p.avatarUrl : `${API_BASE}${p.avatarUrl}`) : undefined,
    hasAvatar: p.hasAvatar,
    headline: p.headline || '',
    university: p.university || '',
    major: p.major || undefined,
    company: p.company || undefined,
    role: p.role || undefined,
    industry: p.industry || undefined,
    location: p.location || undefined,
    bio: p.bio || '',
    skills: p.skills ?? [],
    referralsAvailable: p.referralsAvailable,
    isProfessional: p.isProfessional,
    visible: !p.deactivated,
    emailNotifications: p.emailNotifications ?? true,
    onboardingComplete: p.onboardingComplete,
    termsAccepted: p.termsAccepted,
    education: (p.education ?? []).map(toEducation),
    experience: (p.experience ?? []).map(toWorkExperience),
    certifications: (p.certifications ?? []).map(toCertification),
  };
}

function toRequest(r: ApiRequest): ConnectionRequest {
  return {
    id: String(r.id),
    fromId: String(r.fromId),
    toId: String(r.toId),
    requestType: r.requestType,
    message: r.message,
    status: r.status,
    createdAt: timeAgo(r.createdAt),
  };
}

function toConnection(c: ApiConnection): Connection {
  return {
    id: String(c.id),
    requestId: String(c.requestId),
    memberIds: [String(c.memberIds[0]), String(c.memberIds[1])],
    status: c.status,
    since: timeAgo(c.since),
    lastMessage: c.lastMessage
      ? {
          text: c.lastMessage.text,
          senderId: String(c.lastMessage.senderId),
          time: timeAgo(c.lastMessage.createdAt),
          createdAtIso: c.lastMessage.createdAt,
        }
      : null,
  };
}

function toChatMessage(m: ApiMessage): ChatMessage {
  return {
    id: String(m.id),
    connectionId: String(m.connectionId),
    senderId: String(m.senderId),
    text: m.text,
    time: timeAgo(m.createdAt),
    attachment: m.attachment,
    resumeId: m.resumeId !== null ? String(m.resumeId) : null,
    resumeFileName: m.resumeFileName,
    resumeSizeLabel: m.resumeSizeLabel,
  };
}

// Shown for a profile whose owner hasn't entered a name yet.
export const PLACEHOLDER_NAME = 'New member';

// How often an idle tab asks the server "has anything changed?" (a tiny request).
// Real data is only downloaded when the answer is yes. Each tab is jittered by
// up to 20% so thousands of tabs never all ask at the same instant.
const SYNC_INTERVAL_MS = 30_000;
// An open conversation refreshes faster, but only that one conversation.
export const OPEN_THREAD_INTERVAL_MS = 5_000;

const EMPTY_MEMBER: Member = {
  id: '',
  name: '',
  initials: '',
  avatarColor: 'moss',
  hasAvatar: false,
  headline: '',
  university: '',
  bio: '',
  skills: [],
  referralsAvailable: false,
  isProfessional: false,
  visible: false,
  emailNotifications: true,
  onboardingComplete: false,
  termsAccepted: false,
  education: [],
  experience: [],
  certifications: [],
};

type PortalState = {
  members: Record<string, Member>;
  requests: ConnectionRequest[];
  connections: Connection[];
  messages: ChatMessage[];
};

const EMPTY_STATE: PortalState = {
  members: {},
  requests: [],
  connections: [],
  messages: [],
};

export type ProfessionalFilters = {
  search?: string;
  company?: string;
  industry?: string;
  university?: string;
  referralsAvailable?: boolean;
};

export type ProfessionalPage = { members: Member[]; hasMore: boolean };

// isProfessional is self-serve now - the backend still enforces that company
// and role are filled in before it'll accept isProfessional: true.
type ProfileUpdate = Partial<{
  name: string;
  headline: string;
  university: string;
  major: string;
  company: string;
  role: string;
  industry: string;
  location: string;
  bio: string;
  skills: string[];
  referralsAvailable: boolean;
  isProfessional: boolean;
  deactivated: boolean;
  emailNotifications: boolean;
  acceptTerms: boolean;
}>;

type PortalContextValue = {
  state: PortalState;
  currentUser: Member;
  currentUserId: string;
  sendRequest: (toId: string, requestType: RequestType, message: string) => Promise<void>;
  respondToRequest: (requestId: string, decision: 'accepted' | 'declined') => Promise<void>;
  cancelRequest: (requestId: string) => Promise<void>;
  cancelConnection: (connectionId: string) => Promise<void>;
  sendMessage: (connectionId: string, text: string) => Promise<void>;
  updateProfile: (fields: ProfileUpdate) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  downloadResumeById: (resumeId: string, fileName: string) => Promise<void>;
  shareResumeWithConnection: (connectionId: string, file: File) => Promise<void>;
  reportMember: (memberId: string, reason?: string) => Promise<void>;
  setDeactivated: (value: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
  loadMember: (id: string) => Promise<Member | null>;
  loadProfessionals: (filters: ProfessionalFilters, page?: number) => Promise<ProfessionalPage>;
  loadMessages: (connectionId: string) => Promise<void>;
  isConnectionUnread: (connectionId: string) => boolean;
  unreadMessageCount: number;
  addEducation: (fields: Omit<Education, 'id'>) => Promise<void>;
  updateEducation: (id: string, fields: Partial<Omit<Education, 'id'>>) => Promise<void>;
  removeEducation: (id: string) => Promise<void>;
  addExperience: (fields: Omit<WorkExperience, 'id'>) => Promise<void>;
  updateExperience: (id: string, fields: Partial<Omit<WorkExperience, 'id'>>) => Promise<void>;
  removeExperience: (id: string) => Promise<void>;
  addCertification: (fields: Omit<Certification, 'id'>) => Promise<void>;
  updateCertification: (id: string, fields: Partial<Omit<Certification, 'id'>>) => Promise<void>;
  removeCertification: (id: string) => Promise<void>;
};

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalDataProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<PortalState>(EMPTY_STATE);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const loadStartedRef = useRef(false);
  // connectionId -> ISO timestamp of the last message that connection's
  // thread was actually viewed through (see markConnectionRead). Drives the
  // unread badge/toast logic purely by comparing against each connection's
  // lastMessage.createdAtIso - no separate "unread" flag to keep in sync.
  const [lastReadAt, setLastReadAt] = useState<Record<string, string>>({});

  // PortalDataProvider lives at the portal layout, so it never unmounts
  // across a sign-out -> sign-in in the same tab. Without this, whoever logs
  // in next would inherit the previous account's profile/connections/requests
  // until something else happened to trigger a refetch. Reset during render
  // (React's documented pattern for state that must change the instant a
  // prop does, https://react.dev/learn/you-might-not-need-an-effect) rather
  // than in an effect, so there's no extra commit where the old account's
  // data is still live.
  const [prevSignedIn, setPrevSignedIn] = useState(isSignedIn);
  if (authLoaded && prevSignedIn && !isSignedIn) {
    setPrevSignedIn(isSignedIn);
    setState(EMPTY_STATE);
    setCurrentUserId(null);
    setReady(false);
    setLoadFailed(false);
    setLastReadAt({});
  } else if (prevSignedIn !== isSignedIn) {
    setPrevSignedIn(isSignedIn);
  }

  const publicRoute = isPublicPortalRoute(pathname);

  // Bumped at the start and end of every write. A background refresh that
  // overlaps a write is thrown away, so it can never clobber a fresh change
  // with data fetched just before it.
  const writeVersion = useRef(0);
  const knownMembers = useRef<Record<string, Member>>({});
  const syncVersion = useRef<string | null>(null);

  // Kept in a ref so `call` (and everything built on it) has a permanently
  // stable identity. Timers and effects that depend on it then never restart
  // just because Clerk handed back a fresh getToken function.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const call = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const isWrite = Boolean(init?.method) && init?.method !== 'GET';
    if (isWrite) writeVersion.current++;
    try {
      const token = await getTokenRef.current();
      return await apiRequest<T>(path, token, init);
    } finally {
      if (isWrite) writeVersion.current++;
    }
  }, []);

  // Everything the portal shows about "me": profile, requests, and
  // connections. Profiles of other people are only fetched when they aren't
  // already known. Messages are NOT part of this: a conversation loads its
  // own when it is opened (and connections already carry a preview of the
  // latest message), so the cost of a refresh doesn't grow with how many
  // conversations you have.
  const fetchSnapshot = useCallback(
    async (known: Record<string, Member> = {}, knownVersion?: string) => {
      // Asked first: if something changes while the rest downloads, the version
      // we keep is older than the data, so the next check simply refreshes again.
      const version = knownVersion ?? (await call<{ version: string }>('/api/sync/')).version;

      const [me, incomingRaw, outgoingRaw, connectionsRaw] = await Promise.all([
        call<ApiProfile>('/api/members/me/'),
        call<ApiRequest[]>('/api/requests/?direction=incoming'),
        call<ApiRequest[]>('/api/requests/?direction=outgoing'),
        call<ApiConnection[]>('/api/connections/'),
      ]);

      const members: Record<string, Member> = { [String(me.id)]: toMember(me) };

      const otherIds = new Set<number>();
      incomingRaw.forEach(r => otherIds.add(r.fromId));
      outgoingRaw.forEach(r => otherIds.add(r.toId));
      connectionsRaw.forEach(c => c.memberIds.forEach(id => otherIds.add(id)));
      otherIds.delete(me.id);

      const missing = Array.from(otherIds).filter(id => !known[String(id)]);
      const others = await Promise.all(missing.map(id => call<ApiProfile>(`/api/members/${id}/`).catch(() => null)));
      others.forEach(p => {
        if (p) members[String(p.id)] = toMember(p);
      });

      const snapshot: PortalState = {
        members,
        requests: [...incomingRaw, ...outgoingRaw].map(toRequest),
        connections: connectionsRaw.map(toConnection),
        messages: [],
      };
      return { userId: String(me.id), snapshot, version };
    },
    [call]
  );

  useEffect(() => {
    knownMembers.current = state.members;
  }, [state.members]);

  // Lets the background sync check (below) diff against what the portal
  // already had before a refresh, to know what's actually *new* - a plain
  // closure over `state` would just see whatever it was when the effect was
  // set up, not the latest render.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Lets the next real sign-in's effect below fetch fresh data instead of
  // being skipped as "already loaded" from the account that just signed out.
  useEffect(() => {
    if (!authLoaded || isSignedIn) return;
    loadStartedRef.current = false;
  }, [authLoaded, isSignedIn]);

  useEffect(() => {
    if (publicRoute || !authLoaded || !isSignedIn || loadStartedRef.current) return;
    loadStartedRef.current = true;

    fetchSnapshot()
      .then(({ userId, snapshot, version }) => {
        syncVersion.current = version;
        setState(snapshot);
        setCurrentUserId(userId);
        setLoadFailed(false);
        setReady(true);
      })
      .catch(err => {
        console.error('Failed to load portal data', err);
        // Deliberately NOT marking ready with no currentUserId set - that would
        // fall through to EMPTY_MEMBER downstream, which reads as "deactivated"
        // to anything gating on currentUser.visible. A failed load is a load
        // error, not a deactivated account; show that honestly instead.
        setLoadFailed(true);
        setReady(true);
      });
  }, [publicRoute, authLoaded, isSignedIn, fetchSnapshot, retryTick]);

  function retryLoad() {
    loadStartedRef.current = false;
    setReady(false);
    setLoadFailed(false);
    setRetryTick(t => t + 1);
  }

  // Declared ahead of the background sync effect below, which depends on it
  // (for the Accept/Decline buttons on a new-request toast) - a useEffect's
  // dependency array is evaluated during render, so this has to already be
  // initialized by the time that effect is set up, not just by the time its
  // callback actually runs.
  const respondToRequest = useCallback(
    async (requestId: string, decision: 'accepted' | 'declined') => {
      if (decision === 'accepted') {
        const connection = await call<ApiConnection>(`/api/requests/${requestId}/accept/`, { method: 'POST' });
        const mapped = toConnection(connection);
        setState(prev => ({
          ...prev,
          requests: prev.requests.map(r => (r.id === requestId ? { ...r, status: 'accepted' } : r)),
          connections: [...prev.connections, mapped],
        }));
      } else {
        const updated = await call<ApiRequest>(`/api/requests/${requestId}/decline/`, { method: 'POST' });
        setState(prev => ({
          ...prev,
          requests: prev.requests.map(r => (r.id === requestId ? toRequest(updated) : r)),
        }));
      }
    },
    [call]
  );

  // Quiet background refresh so new requests and accepted connections show up
  // without reloading. Every SYNC_INTERVAL_MS an idle tab makes ONE tiny request
  // ("what's the version of my data?") and downloads nothing unless it changed.
  useEffect(() => {
    if (!ready || publicRoute) return;
    let running = false;
    let timer: number | undefined;

    async function check() {
      if (document.hidden || running) return;
      running = true;
      const versionAtStart = writeVersion.current;
      try {
        const { version } = await call<{ version: string }>('/api/sync/');
        if (version === syncVersion.current) return;
        const fresh = await fetchSnapshot(knownMembers.current, version);
        if (versionAtStart !== writeVersion.current) return; // a save overlapped; try again next time
        syncVersion.current = fresh.version;

        const prev = stateRef.current;
        const allMembers = { ...prev.members, ...fresh.snapshot.members };

        // A pending request that wasn't there before - pop it, with Accept/Decline right on the toast.
        const prevPendingIds = new Set(
          prev.requests.filter(r => r.toId === currentUserId && r.status === 'pending').map(r => r.id)
        );
        for (const r of fresh.snapshot.requests) {
          if (r.toId !== currentUserId || r.status !== 'pending' || prevPendingIds.has(r.id)) continue;
          const from = allMembers[r.fromId];
          toast(`${from?.name ?? 'Someone'} wants to connect.`, 'info', [
            { label: 'Accept', onClick: () => respondToRequest(r.id, 'accepted').catch(() => router.push('/portal/requests')) },
            { label: 'Decline', onClick: () => respondToRequest(r.id, 'declined').catch(() => router.push('/portal/requests')) },
          ]);
        }

        // A connection whose last message changed, sent by the other person - new message, not mine.
        const prevById = new Map(prev.connections.map(c => [c.id, c]));
        for (const c of fresh.snapshot.connections) {
          const last = c.lastMessage;
          if (!last || last.senderId === currentUserId) continue;
          const before = prevById.get(c.id)?.lastMessage;
          if (before && before.createdAtIso >= last.createdAtIso) continue;
          const otherId = c.memberIds.find(id => id !== currentUserId);
          const from = otherId ? allMembers[otherId] : undefined;
          toast(`${from?.name ?? 'New message'}: ${last.text}`, 'info');
        }

        setState(p => ({
          ...fresh.snapshot,
          messages: p.messages,
          members: { ...p.members, ...fresh.snapshot.members },
        }));
      } catch {
        // transient (offline, sleeping laptop); the next check simply tries again
      } finally {
        running = false;
      }
    }

    function schedule() {
      timer = window.setTimeout(async () => {
        await check();
        schedule();
      }, SYNC_INTERVAL_MS * (0.8 + Math.random() * 0.4));
    }
    schedule();

    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, publicRoute, call, fetchSnapshot, currentUserId, toast, router, respondToRequest]);

  const loadMember = useCallback(
    async (id: string): Promise<Member | null> => {
      const cached = state.members[id];
      if (cached) return cached;
      try {
        const profile = await call<ApiProfile>(`/api/members/${id}/`);
        const member = toMember(profile);
        setState(prev => ({ ...prev, members: { ...prev.members, [id]: member } }));
        return member;
      } catch {
        return null;
      }
    },
    [state.members, call]
  );

  const loadProfessionals = useCallback(
    async (filters: ProfessionalFilters, page = 1): Promise<ProfessionalPage> => {
      const params = new URLSearchParams();
      if (page > 1) params.set('page', String(page));
      if (filters.search) params.set('search', filters.search);
      if (filters.company) params.set('company', filters.company);
      if (filters.industry) params.set('industry', filters.industry);
      if (filters.university) params.set('university', filters.university);
      if (filters.referralsAvailable) params.set('referralsAvailable', 'true');

      const data = await call<Paginated<ApiProfile>>(`/api/professionals/?${params.toString()}`);
      const list = resultsOf(data).map(toMember);
      setState(prev => {
        const members = { ...prev.members };
        list.forEach(m => {
          members[m.id] = m;
        });
        return { ...prev, members };
      });
      return { members: list, hasMore: !Array.isArray(data) && Boolean(data.next) };
    },
    [call]
  );

  const sendRequest = useCallback(
    async (toId: string, requestType: RequestType, message: string) => {
      const created = await call<ApiRequest>('/api/requests/', {
        method: 'POST',
        body: JSON.stringify({ toId: Number(toId), requestType, message }),
      });
      setState(prev => ({ ...prev, requests: [...prev.requests, toRequest(created)] }));
    },
    [call]
  );

  const cancelRequest = useCallback(
    async (requestId: string) => {
      const updated = await call<ApiRequest>(`/api/requests/${requestId}/cancel/`, { method: 'POST' });
      setState(prev => ({ ...prev, requests: prev.requests.map(r => (r.id === requestId ? toRequest(updated) : r)) }));
    },
    [call]
  );

  const cancelConnection = useCallback(
    async (connectionId: string) => {
      const updated = await call<ApiConnection>(`/api/connections/${connectionId}/cancel/`, { method: 'POST' });
      setState(prev => ({
        ...prev,
        connections: prev.connections.map(c => (c.id === connectionId ? toConnection(updated) : c)),
      }));
    },
    [call]
  );

  const markConnectionRead = useCallback((connectionId: string, atIso: string) => {
    setLastReadAt(prev =>
      !prev[connectionId] || atIso > prev[connectionId] ? { ...prev, [connectionId]: atIso } : prev
    );
  }, []);

  // Loads one conversation's messages (the latest 200). Called when a
  // conversation is opened and every few seconds while it stays open.
  const loadMessages = useCallback(
    async (connectionId: string) => {
      const versionAtStart = writeVersion.current;
      const raw = await call<ApiMessage[]>(`/api/connections/${connectionId}/messages/`);
      if (versionAtStart !== writeVersion.current) return; // a send overlapped; the next call catches up
      const list = raw.map(toChatMessage);
      const last = raw[raw.length - 1];
      setState(prev => ({
        ...prev,
        messages: [...prev.messages.filter(m => m.connectionId !== connectionId), ...list],
        connections: last
          ? prev.connections.map(c =>
              c.id === connectionId
                ? {
                    ...c,
                    lastMessage: {
                      text: last.text.slice(0, 140),
                      senderId: String(last.senderId),
                      time: timeAgo(last.createdAt),
                      createdAtIso: last.createdAt,
                    },
                  }
                : c
            )
          : prev.connections,
      }));
      // Viewing a thread is what clears its unread state, regardless of who sent the latest message.
      if (last) markConnectionRead(connectionId, last.createdAt);
    },
    [call, markConnectionRead]
  );

  const sendMessage = useCallback(
    async (connectionId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const created = await call<ApiMessage>(`/api/connections/${connectionId}/messages/`, {
        method: 'POST',
        body: JSON.stringify({ text: trimmed }),
      });
      setState(prev => ({
        ...prev,
        messages: [...prev.messages, toChatMessage(created)],
        connections: prev.connections.map(c =>
          c.id === connectionId
            ? {
                ...c,
                lastMessage: {
                  text: created.text.slice(0, 140),
                  senderId: String(created.senderId),
                  time: 'Just now',
                  createdAtIso: created.createdAt,
                },
              }
            : c
        ),
      }));
    },
    [call]
  );

  const updateProfile = useCallback(
    async (fields: ProfileUpdate) => {
      const updated = await call<ApiProfile>('/api/members/me/', { method: 'PATCH', body: JSON.stringify(fields) });
      const member = toMember(updated);
      setState(prev => ({ ...prev, members: { ...prev.members, [member.id]: member } }));
    },
    [call]
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const updated = await call<ApiProfile>('/api/members/me/avatar/', { method: 'POST', body: form });
      const member = toMember(updated);
      setState(prev => ({ ...prev, members: { ...prev.members, [member.id]: member } }));
    },
    [call]
  );

  const removeAvatar = useCallback(async () => {
    const updated = await call<ApiProfile>('/api/members/me/avatar/', { method: 'DELETE' });
    const member = toMember(updated);
    setState(prev => ({ ...prev, members: { ...prev.members, [member.id]: member } }));
  }, [call]);

  // Education/experience/certifications all follow the same add/update/remove
  // shape against their own /members/me/<kind>/ endpoints - this just patches
  // the matching list on the signed-in member's own cached profile afterward.
  function patchMyList<K extends 'education' | 'experience' | 'certifications'>(
    key: K,
    userId: string | null,
    updater: (list: Member[K]) => Member[K]
  ) {
    setState(prev => {
      if (!userId || !prev.members[userId]) return prev;
      const me = prev.members[userId];
      return { ...prev, members: { ...prev.members, [userId]: { ...me, [key]: updater(me[key]) } } };
    });
  }

  const addEducation = useCallback(
    async (fields: Omit<Education, 'id'>) => {
      const created = await call<ApiEducation>('/api/members/me/education/', { method: 'POST', body: JSON.stringify(fields) });
      patchMyList('education', currentUserId, list => [...list, toEducation(created)]);
    },
    [call, currentUserId]
  );
  const updateEducation = useCallback(
    async (id: string, fields: Partial<Omit<Education, 'id'>>) => {
      const updated = await call<ApiEducation>(`/api/members/me/education/${id}/`, { method: 'PATCH', body: JSON.stringify(fields) });
      patchMyList('education', currentUserId, list => list.map(e => (e.id === id ? toEducation(updated) : e)));
    },
    [call, currentUserId]
  );
  const removeEducation = useCallback(
    async (id: string) => {
      await call<void>(`/api/members/me/education/${id}/`, { method: 'DELETE' });
      patchMyList('education', currentUserId, list => list.filter(e => e.id !== id));
    },
    [call, currentUserId]
  );

  const addExperience = useCallback(
    async (fields: Omit<WorkExperience, 'id'>) => {
      const created = await call<ApiWorkExperience>('/api/members/me/experience/', { method: 'POST', body: JSON.stringify(fields) });
      patchMyList('experience', currentUserId, list => [...list, toWorkExperience(created)]);
    },
    [call, currentUserId]
  );
  const updateExperience = useCallback(
    async (id: string, fields: Partial<Omit<WorkExperience, 'id'>>) => {
      const updated = await call<ApiWorkExperience>(`/api/members/me/experience/${id}/`, { method: 'PATCH', body: JSON.stringify(fields) });
      patchMyList('experience', currentUserId, list => list.map(e => (e.id === id ? toWorkExperience(updated) : e)));
    },
    [call, currentUserId]
  );
  const removeExperience = useCallback(
    async (id: string) => {
      await call<void>(`/api/members/me/experience/${id}/`, { method: 'DELETE' });
      patchMyList('experience', currentUserId, list => list.filter(e => e.id !== id));
    },
    [call, currentUserId]
  );

  const addCertification = useCallback(
    async (fields: Omit<Certification, 'id'>) => {
      const created = await call<ApiCertification>('/api/members/me/certifications/', { method: 'POST', body: JSON.stringify(fields) });
      patchMyList('certifications', currentUserId, list => [...list, toCertification(created)]);
    },
    [call, currentUserId]
  );
  const updateCertification = useCallback(
    async (id: string, fields: Partial<Omit<Certification, 'id'>>) => {
      const updated = await call<ApiCertification>(`/api/members/me/certifications/${id}/`, { method: 'PATCH', body: JSON.stringify(fields) });
      patchMyList('certifications', currentUserId, list => list.map(c => (c.id === id ? toCertification(updated) : c)));
    },
    [call, currentUserId]
  );
  const removeCertification = useCallback(
    async (id: string) => {
      await call<void>(`/api/members/me/certifications/${id}/`, { method: 'DELETE' });
      patchMyList('certifications', currentUserId, list => list.filter(c => c.id !== id));
    },
    [call, currentUserId]
  );

  const downloadResumeById = useCallback(
    async (resumeId: string, fileName: string) => {
      const token = await getToken();
      const blob = await apiDownload(`/api/resume/${resumeId}/download/`, token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    },
    [getToken]
  );

  const shareResumeWithConnection = useCallback(
    async (connectionId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      const created = await call<ApiMessage>(`/api/connections/${connectionId}/share-resume/`, { method: 'POST', body: form });
      const message = toChatMessage(created);
      setState(prev => ({
        ...prev,
        // Only keep it if that thread's messages are already loaded - avoids
        // showing one message floating alone in a conversation that hasn't
        // been opened/fetched yet (loadMessages will bring the full history).
        messages: prev.messages.some(m => m.connectionId === connectionId) ? [...prev.messages, message] : prev.messages,
        connections: prev.connections.map(c =>
          c.id === connectionId
            ? { ...c, lastMessage: { text: message.text, senderId: message.senderId, time: message.time, createdAtIso: created.createdAt } }
            : c
        ),
      }));
    },
    [call]
  );

  const reportMember = useCallback(
    async (memberId: string, reason?: string) => {
      await call<void>(`/api/members/${memberId}/report/`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? '' }),
      });
    },
    [call]
  );

  const setDeactivated = useCallback(
    async (value: boolean) => {
      const updated = await call<ApiProfile>('/api/members/me/', {
        method: 'PATCH',
        body: JSON.stringify({ deactivated: value }),
      });
      const member = toMember(updated);
      setState(prev => ({ ...prev, members: { ...prev.members, [member.id]: member } }));
    },
    [call]
  );

  // Backend side only - cascades to everything (education, experience,
  // certifications, connections, requests, messages, files on R2). The
  // caller is also responsible for deleting the Clerk account itself
  // (Clerk's own self-serve user.delete()), since this never touches Clerk.
  const deleteAccount = useCallback(async () => {
    await call<void>('/api/members/me/', { method: 'DELETE' });
  }, [call]);

  const isConnectionUnread = useCallback(
    (connectionId: string) => {
      const c = state.connections.find(con => con.id === connectionId);
      const last = c?.lastMessage;
      if (!last || last.senderId === currentUserId) return false;
      const readAt = lastReadAt[connectionId];
      return !readAt || last.createdAtIso > readAt;
    },
    [state.connections, currentUserId, lastReadAt]
  );

  const unreadMessageCount = state.connections.filter(c => isConnectionUnread(c.id)).length;

  if (!publicRoute && !ready) {
    return (
      <div className="portal-loading-screen">
        <div className="portal-loading-mark">
          <div className="portal-spinner" />
          <span>Loading your portal…</span>
        </div>
      </div>
    );
  }

  if (!publicRoute && loadFailed) {
    return (
      <div className="portal-loading-screen">
        <div className="portal-loading-mark">
          <span>Couldn&apos;t load your account. This isn&apos;t a deactivation - just a connection hiccup.</span>
          <button className="btn-primary btn-sm" style={{ marginTop: 14 }} onClick={retryLoad}>Try again</button>
        </div>
      </div>
    );
  }

  const currentUser = (currentUserId && state.members[currentUserId]) || EMPTY_MEMBER;

  const value: PortalContextValue = {
    state,
    currentUser,
    currentUserId: currentUserId ?? '',
    sendRequest,
    respondToRequest,
    cancelRequest,
    cancelConnection,
    sendMessage,
    updateProfile,
    downloadResumeById,
    uploadAvatar,
    removeAvatar,
    shareResumeWithConnection,
    reportMember,
    setDeactivated,
    deleteAccount,
    loadMember,
    loadProfessionals,
    loadMessages,
    isConnectionUnread,
    unreadMessageCount,
    addEducation,
    updateEducation,
    removeEducation,
    addExperience,
    updateExperience,
    removeExperience,
    addCertification,
    updateCertification,
    removeCertification,
  };

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalData() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortalData must be used within PortalDataProvider');
  return ctx;
}
