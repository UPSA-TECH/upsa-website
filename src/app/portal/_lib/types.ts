// Shared portal types. Data itself now comes from the real API (see api.ts
// and PortalDataProvider.tsx) - nothing here is seed/mock data anymore.

export type Member = {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  avatarUrl?: string;
  hasAvatar: boolean;
  headline: string;
  university: string;
  major?: string;
  company?: string;
  role?: string;
  industry?: string;
  location?: string;
  bio: string;
  skills: string[];
  // A verified professional is discoverable by default; this is the one
  // remaining opt-in, for whether "referral" is offered as a request reason.
  referralsAvailable: boolean;
  isProfessional: boolean;
  visible: boolean;
  emailNotifications: boolean;
};

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export type RequestType = 'connect' | 'referral';

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  connect: 'Connect',
  referral: 'Referral request',
};

export type ConnectionRequest = {
  id: string;
  fromId: string;
  toId: string;
  requestType: RequestType;
  message: string;
  status: RequestStatus;
  createdAt: string;
};

export type ConnectionStatus = 'active' | 'completed' | 'cancelled';

export type Connection = {
  id: string;
  requestId: string;
  memberIds: [string, string];
  status: ConnectionStatus;
  since: string;
  // The newest message, so a conversation list needs no per-thread download.
  lastMessage: { text: string; senderId: string; time: string } | null;
};

export type ChatMessage = {
  id: string;
  connectionId: string;
  senderId: string;
  text: string;
  time: string;
  // Set when this message is a resume share instead of plain text - renders
  // as a resume card bubble. resumeId is null if the resume was since replaced.
  attachment: 'resume' | '';
  resumeId: string | null;
  resumeFileName: string | null;
  resumeSizeLabel: string | null;
};

export type Resume = {
  id: string;
  fileName: string;
  sizeLabel: string;
  uploadedAt: string;
} | null;

export const AVATAR_COLORS = ['moss', 'gold', 'teal', 'plum', 'clay', 'slate'] as const;
