export const UK_TIME_ZONE = 'Europe/London';
export const UK_LOCALE = 'en-GB';

const getDateTimeParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat(UK_LOCALE, {
    timeZone: UK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === '24' ? '00' : values.hour;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour,
    minute: values.minute,
    second: values.second,
  };
};

const getTimeZoneOffsetMs = (date: Date) => {
  const parts = getDateTimeParts(date);
  const zonedTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return zonedTime - date.getTime();
};

export const parseUkDateTime = (value: unknown): Date | null => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return parseUkDate(raw);

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})(?::\d{2}(?:\.\d{3})?)?$/.exec(raw);

  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const [, year, month, day, hour, minute] = match;
  const utcGuess = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  const firstPass = new Date(utcGuess.getTime() - getTimeZoneOffsetMs(utcGuess));
  return new Date(utcGuess.getTime() - getTimeZoneOffsetMs(firstPass));
};

export const parseUkDate = (value: unknown): Date | null => {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return parseUkDateTime(`${raw}T00:00`);
};

export const getUkDateBounds = (value: Date): { dayStart: Date; dayEnd: Date } => {
  const parts = getDateTimeParts(value);
  const dayStart = parseUkDate(`${parts.year}-${parts.month}-${parts.day}`)!;
  const nextNoon = new Date(dayStart.getTime() + 36 * 60 * 60 * 1000);
  const nextParts = getDateTimeParts(nextNoon);
  const dayEnd = parseUkDate(`${nextParts.year}-${nextParts.month}-${nextParts.day}`)!;
  return { dayStart, dayEnd };
};

export const getUkDateTimeInputValue = (value: Date): string => {
  const parts = getDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const getUkZoomDateTimeValue = (value: Date): string => {
  const parts = getDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
};

export const formatUkTime = (value: Date): string =>
  value.toLocaleTimeString(UK_LOCALE, {
    timeZone: UK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

export const formatUkDateTime = (value: Date): string =>
  value.toLocaleString(UK_LOCALE, {
    timeZone: UK_TIME_ZONE,
    hour12: true,
  });

export const formatUkMeetingRange = (startTime: Date, duration: number): string => {
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
  const date = startTime.toLocaleDateString(UK_LOCALE, {
    timeZone: UK_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${date}, ${formatUkTime(startTime)} - ${formatUkTime(endTime)} (${UK_TIME_ZONE})`;
};
