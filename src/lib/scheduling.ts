type ZonedDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function getZonedParts(date: Date, timeZone: string): ZonedDateTime {
  const parts = getFormatter(timeZone).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getOffsetMsForTimeZone(date: Date, timeZone: string): number {
  const zoned = getZonedParts(date, timeZone);
  const asUtcMs = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return asUtcMs - date.getTime();
}

function zonedToUtc(zoned: ZonedDateTime, timeZone: string): Date {
  let utcGuess = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);

  for (let i = 0; i < 3; i += 1) {
    const offset = getOffsetMsForTimeZone(new Date(utcGuess), timeZone);
    utcGuess = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second) - offset;
  }

  return new Date(utcGuess);
}

function addUtcDays(year: number, month: number, day: number, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate()
  };
}

function isWeekend(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function computeNextBusinessDayRunAt(now: Date, timeZone: string): Date {
  const zonedNow = getZonedParts(now, timeZone);
  let cursor = { year: zonedNow.year, month: zonedNow.month, day: zonedNow.day };

  do {
    cursor = addUtcDays(cursor.year, cursor.month, cursor.day, 1);
  } while (isWeekend(cursor.year, cursor.month, cursor.day));

  const runAt = zonedToUtc(
    {
      year: cursor.year,
      month: cursor.month,
      day: cursor.day,
      hour: 9,
      minute: 30,
      second: 0
    },
    timeZone
  );

  return runAt;
}

export function computeMissedCallFollowUpRunTimes(now: Date, timeZone: string): Date[] {
  const plusTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const nextBusiness = computeNextBusinessDayRunAt(now, timeZone);
  return [plusTwoHours, nextBusiness];
}
