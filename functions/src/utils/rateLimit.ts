import * as admin from 'firebase-admin';
import { getRateLimitConfig } from '../config';

type Channel = 'email' | 'sms';

type Bucket = {
  hourStart: number;
  dayStart: number;
  emailHour: number;
  emailDay: number;
  smsHour: number;
  smsDay: number;
  ipCounts: Record<string, { hourStart: number; count: number }>;
};

function hourBucket(now = Date.now()): number {
  return Math.floor(now / (60 * 60 * 1000));
}

function dayBucket(now = Date.now()): number {
  return Math.floor(now / (24 * 60 * 60 * 1000));
}

function emptyBucket(now = Date.now()): Bucket {
  return {
    hourStart: hourBucket(now),
    dayStart: dayBucket(now),
    emailHour: 0,
    emailDay: 0,
    smsHour: 0,
    smsDay: 0,
    ipCounts: {},
  };
}

function normalizeBucket(data: FirebaseFirestore.DocumentData | undefined, now: number): Bucket {
  const currentHour = hourBucket(now);
  const currentDay = dayBucket(now);
  const base = emptyBucket(now);

  if (!data) {
    return base;
  }

  const bucket: Bucket = {
    hourStart: typeof data.hourStart === 'number' ? data.hourStart : currentHour,
    dayStart: typeof data.dayStart === 'number' ? data.dayStart : currentDay,
    emailHour: typeof data.emailHour === 'number' ? data.emailHour : 0,
    emailDay: typeof data.emailDay === 'number' ? data.emailDay : 0,
    smsHour: typeof data.smsHour === 'number' ? data.smsHour : 0,
    smsDay: typeof data.smsDay === 'number' ? data.smsDay : 0,
    ipCounts: typeof data.ipCounts === 'object' && data.ipCounts ? data.ipCounts : {},
  };

  if (bucket.hourStart !== currentHour) {
    bucket.hourStart = currentHour;
    bucket.emailHour = 0;
    bucket.smsHour = 0;
    bucket.ipCounts = {};
  }

  if (bucket.dayStart !== currentDay) {
    bucket.dayStart = currentDay;
    bucket.emailDay = 0;
    bucket.smsDay = 0;
  }

  return bucket;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; status: 429; message: string };

export async function checkRateLimits(
  hostUid: string,
  channel: Channel,
  count: number,
  clientIp: string
): Promise<RateLimitResult> {
  const limits = getRateLimitConfig();
  const ref = admin.firestore().doc(`rateLimits/${hostUid}`);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const bucket = normalizeBucket(snap.data(), now);

    const ipEntry = bucket.ipCounts[clientIp];
    const ipCount =
      ipEntry && ipEntry.hourStart === bucket.hourStart ? ipEntry.count : 0;

    if (ipCount + 1 > limits.ipPerHour) {
      return { allowed: false, status: 429, message: 'ip_rate_limited' };
    }

    if (channel === 'email') {
      if (bucket.emailHour + count > limits.emailPerHour) {
        return { allowed: false, status: 429, message: 'email_hour_rate_limited' };
      }
      if (bucket.emailDay + count > limits.emailPerDay) {
        return { allowed: false, status: 429, message: 'email_day_rate_limited' };
      }
      bucket.emailHour += count;
      bucket.emailDay += count;
    } else {
      if (bucket.smsHour + count > limits.smsPerHour) {
        return { allowed: false, status: 429, message: 'sms_hour_rate_limited' };
      }
      if (bucket.smsDay + count > limits.smsPerDay) {
        return { allowed: false, status: 429, message: 'sms_day_rate_limited' };
      }
      bucket.smsHour += count;
      bucket.smsDay += count;
    }

    bucket.ipCounts[clientIp] = {
      hourStart: bucket.hourStart,
      count: ipCount + 1,
    };

    tx.set(ref, bucket, { merge: true });
    return { allowed: true };
  });
}

export async function resetStaleRateLimitBuckets(): Promise<number> {
  const now = Date.now();
  const currentHour = hourBucket(now);
  const currentDay = dayBucket(now);
  const snapshot = await admin.firestore().collection('rateLimits').get();
  let resetCount = 0;

  const batch = admin.firestore().batch();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const needsHourReset = data.hourStart !== currentHour;
    const needsDayReset = data.dayStart !== currentDay;

    if (!needsHourReset && !needsDayReset) {
      continue;
    }

    const next = normalizeBucket(data, now);
    batch.set(doc.ref, next, { merge: true });
    resetCount += 1;
  }

  if (resetCount > 0) {
    await batch.commit();
  }

  return resetCount;
}
