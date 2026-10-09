export type ResolvedScheduledUploadTime = Readonly<{
  scheduledLocalTime: string;
  timeZone: string;
  utcOffset: string;
}>;

export class ScheduledUploadTimeError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "timezone"
      | "nonexistent"
      | "ambiguous"
      | "past",
    message: string,
  ) {
    super(message);
    this.name = "ScheduledUploadTimeError";
  }
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function partsAt(instant: number, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const remainder = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${remainder}`;
}

export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function getDefaultScheduledLocalTime(
  now = Date.now(),
  timeZone = getDeviceTimeZone(),
): string {
  const target = new Date(now + 2 * 60 * 60 * 1000);
  const parts = partsAt(target.getTime(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function resolveScheduledUploadTime(
  date: string,
  time: string,
  timeZone: string,
  now = Date.now(),
): ResolvedScheduledUploadTime {
  const dateMatch = LOCAL_DATE_PATTERN.exec(date);
  const timeMatch = LOCAL_TIME_PATTERN.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new ScheduledUploadTimeError(
      "invalid",
      "Enter a valid date and time in YYYY-MM-DD and HH:mm format.",
    );
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const localInstant = Date.UTC(year, month - 1, day, hour, minute);
  const localDate = new Date(localInstant);
  if (
    year < 100 ||
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    throw new ScheduledUploadTimeError(
      "invalid",
      "Enter a valid date and time.",
    );
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new ScheduledUploadTimeError(
      "timezone",
      "The device time zone could not be read. Choose a valid time and retry.",
    );
  }

  const expected = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`;
  const matchingOffsets: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = localInstant - offset * 60_000;
    const parts = partsAt(candidate, timeZone);
    const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (local === expected) matchingOffsets.push(offset);
  }

  if (matchingOffsets.length === 0) {
    throw new ScheduledUploadTimeError(
      "nonexistent",
      "That local time does not exist because the clocks change. Choose another time.",
    );
  }
  if (matchingOffsets.length > 1) {
    throw new ScheduledUploadTimeError(
      "ambiguous",
      "That local time happens twice because the clocks change. Choose another time.",
    );
  }

  const utcOffset = formatOffset(matchingOffsets[0]);
  if (localInstant - matchingOffsets[0] * 60_000 <= now) {
    throw new ScheduledUploadTimeError(
      "past",
      "Choose a schedule time in the future.",
    );
  }

  return {
    scheduledLocalTime: expected,
    timeZone,
    utcOffset,
  };
}
