export type BulkRecipient = {
  name: string;
  email?: string;
  phone?: string;
};

export type BulkSendEvent = {
  slug: string;
  name: string;
  hostName?: string;
  hosts?: Array<{ name: string }>;
  date?: string;
  time?: string;
  location?: string;
  inviteUrl: string;
};

export type BulkSendRequest = {
  channel: 'email' | 'sms';
  recipients: BulkRecipient[];
  event: BulkSendEvent;
  customMessage?: string;
};

export type BulkSendResponse = {
  ok: boolean;
  sent: number;
  failed: number;
  skipped: number;
  message?: string;
};

export type Invitee = {
  name: string;
  email?: string;
  phone?: string;
  lastSentAt?: number;
  sendCount?: number;
  lastSentChannel?: 'email' | 'sms';
};

export type SendOutcome = {
  recipient: BulkRecipient;
  success: boolean;
  error?: string;
};

export type AuthContext = {
  uid: string;
  eventSlug: string;
  email?: string;
};

export type GoogleCalendarIntegration = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  googleEmail?: string;
  connectedAt: number;
  calendarId: string;
};

export type CalendarEventLink = {
  googleEventId: string;
  hostUid: string;
  lastSyncedAt: number;
  attendeeCount: number;
};

export type GoogleCalendarStatusResponse = {
  connected: boolean;
  googleEmail?: string;
  synced?: boolean;
  lastSyncedAt?: number;
  attendeeCount?: number;
};

export type GoogleCalendarSyncResponse = {
  ok: boolean;
  googleEventId?: string;
  attendeeCount: number;
  message?: string;
};
