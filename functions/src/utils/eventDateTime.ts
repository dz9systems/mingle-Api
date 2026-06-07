export type EventDateTimeWindow = {
  start: Date;
  end: Date;
  allDay: boolean;
};

function parseTimeOfDay(timeStr: string): { hour: number; minute: number } | null {
  const trimmed = timeStr.trim().toUpperCase();
  const ampmMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  const militaryMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);

  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const meridian = ampmMatch[3];
    if (meridian === 'PM' && hour < 12) hour += 12;
    if (meridian === 'AM' && hour === 12) hour = 0;
    return { hour, minute };
  }

  if (militaryMatch) {
    return {
      hour: parseInt(militaryMatch[1], 10),
      minute: parseInt(militaryMatch[2], 10),
    };
  }

  return null;
}

export function computeEventWindow(params: {
  date?: string;
  time?: string;
  endDate?: string;
  endTime?: string;
}): EventDateTimeWindow {
  const { date: dateStr, time: timeStr, endDate: endDateStr, endTime: endTimeStr } = params;

  if (!dateStr) {
    const now = new Date();
    return {
      start: now,
      end: new Date(now.getTime() + 60 * 60 * 1000),
      allDay: true,
    };
  }

  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) {
    const now = new Date();
    return {
      start: now,
      end: new Date(now.getTime() + 60 * 60 * 1000),
      allDay: true,
    };
  }

  if (!timeStr) {
    const start = new Date(y, m - 1, d);
    return { start, end: start, allDay: true };
  }

  const startTod = parseTimeOfDay(timeStr) || { hour: 19, minute: 0 };
  const start = new Date(y, m - 1, d, startTod.hour, startTod.minute, 0);

  let end: Date | null = null;
  const effectiveEndDate = endDateStr || dateStr;
  const endTod = endTimeStr ? parseTimeOfDay(endTimeStr) : null;

  if (endTod) {
    const [ey, em, ed] = effectiveEndDate.split('-').map((x) => parseInt(x, 10));
    if (ey && em && ed) {
      const candidate = new Date(ey, em - 1, ed, endTod.hour, endTod.minute, 0);
      if (candidate.getTime() > start.getTime()) end = candidate;
    }
  } else if (endDateStr && endDateStr !== dateStr) {
    const [ey, em, ed] = endDateStr.split('-').map((x) => parseInt(x, 10));
    if (ey && em && ed) {
      const candidate = new Date(ey, em - 1, ed, 23, 59, 0);
      if (candidate.getTime() > start.getTime()) end = candidate;
    }
  }

  if (!end) {
    end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  }

  return { start, end, allDay: false };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatLocalDateTime(d: Date): string {
  return `${formatLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function toGoogleCalendarDateTime(window: EventDateTimeWindow): {
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
} {
  if (window.allDay) {
    const nextDay = new Date(window.start);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      start: { date: formatLocalDate(window.start) },
      end: { date: formatLocalDate(nextDay) },
    };
  }

  return {
    start: { dateTime: formatLocalDateTime(window.start), timeZone: 'America/Los_Angeles' },
    end: { dateTime: formatLocalDateTime(window.end), timeZone: 'America/Los_Angeles' },
  };
}
