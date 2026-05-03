import { requestUrl } from "obsidian";
import { DateTime } from "luxon";
import { OFCEvent, validateEvent } from "../../../types";

const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type GoogleCalendarListEntry = {
    id: string;
    summary: string;
    primary?: boolean;
    backgroundColor?: string;
    accessRole?: string;
};

type GoogleEventDateTime = {
    date?: string;
    dateTime?: string;
    timeZone?: string;
};

type GoogleEventStatus = "confirmed" | "tentative" | "cancelled";

export type GoogleEvent = {
    id: string;
    status?: GoogleEventStatus;
    summary?: string;
    description?: string;
    start?: GoogleEventDateTime;
    end?: GoogleEventDateTime;
    recurrence?: string[];
    recurringEventId?: string;
    originalStartTime?: GoogleEventDateTime;
    colorId?: string;
};

/**
 * Google Calendar event color palette (colorId "1".."11" — the "event" palette,
 * not the "calendar" palette). Hex values match the vibrant swatches Google's
 * UI shows in its color picker.
 */
export const GOOGLE_EVENT_COLORS: { id: string; hex: string }[] = [
    { id: "11", hex: "#D50000" }, // Tomato
    { id: "4", hex: "#E67C73" }, // Flamingo
    { id: "6", hex: "#F4511E" }, // Tangerine
    { id: "5", hex: "#F6BF26" }, // Banana
    { id: "2", hex: "#33B679" }, // Sage
    { id: "10", hex: "#0B8043" }, // Basil
    { id: "7", hex: "#039BE5" }, // Peacock
    { id: "9", hex: "#3F51B5" }, // Blueberry
    { id: "1", hex: "#7986CB" }, // Lavender
    { id: "3", hex: "#8E24AA" }, // Grape
    { id: "8", hex: "#616161" }, // Graphite
];

const HEX_TO_COLOR_ID = new Map(
    GOOGLE_EVENT_COLORS.map((c) => [c.hex.toLowerCase(), c.id])
);
const COLOR_ID_TO_HEX = new Map(
    GOOGLE_EVENT_COLORS.map((c) => [c.id, c.hex])
);

export function hexToGoogleColorId(hex: string): string | undefined {
    return HEX_TO_COLOR_ID.get(hex.toLowerCase());
}

export function googleColorIdToHex(id: string): string | undefined {
    return COLOR_ID_TO_HEX.get(id);
}

export type ListEventsResult = {
    events: GoogleEvent[];
    nextSyncToken?: string;
};

/* -------------------------------------------------------------------------- */
/* Day-code mapping                                                            */
/* -------------------------------------------------------------------------- */

const OFC_TO_GOOGLE_DAY: Record<string, string> = {
    U: "SU",
    M: "MO",
    T: "TU",
    W: "WE",
    R: "TH",
    F: "FR",
    S: "SA",
};

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                                */
/* -------------------------------------------------------------------------- */

class GoogleApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function googleFetch<T>(
    accessToken: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    query?: Record<string, string | undefined>,
    body?: unknown
): Promise<T | null> {
    const url = new URL(`${GOOGLE_API_BASE}${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined) url.searchParams.set(k, v);
        }
    }
    const resp = await requestUrl({
        url: url.toString(),
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        throw: false,
    });
    if (resp.status === 204) return null;
    if (resp.status < 200 || resp.status >= 300) {
        throw new GoogleApiError(
            resp.status,
            `Google Calendar API ${method} ${path} failed (${resp.status}): ${resp.text}`
        );
    }
    if (!resp.text) return null;
    return resp.json as T;
}

export function isSyncTokenExpired(err: unknown): boolean {
    return err instanceof GoogleApiError && err.status === 410;
}

export function isUnauthorized(err: unknown): boolean {
    return (
        err instanceof GoogleApiError &&
        (err.status === 401 || err.status === 403)
    );
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export async function listCalendars(
    accessToken: string
): Promise<GoogleCalendarListEntry[]> {
    type Resp = {
        items?: GoogleCalendarListEntry[];
        nextPageToken?: string;
    };
    const result: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
        const page = await googleFetch<Resp>(
            accessToken,
            "GET",
            "/users/me/calendarList",
            { pageToken, maxResults: "250" }
        );
        if (page?.items) result.push(...page.items);
        pageToken = page?.nextPageToken;
    } while (pageToken);
    return result;
}

/**
 * List events in a calendar. Pulls master recurring events (singleEvents=false)
 * so a daily-recurring series stays a single OFCEvent rather than thousands of
 * expanded instances. Cancelled-instance exceptions are folded back into the
 * master's skipDates by the caller's converter pipeline below.
 */
export async function listEvents(
    accessToken: string,
    calendarId: string,
    opts?: { syncToken?: string; timeMin?: string; timeMax?: string }
): Promise<ListEventsResult> {
    type Resp = {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
    };
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
        const page = await googleFetch<Resp>(
            accessToken,
            "GET",
            `/calendars/${encodeURIComponent(calendarId)}/events`,
            {
                pageToken,
                maxResults: "2500",
                singleEvents: "false",
                showDeleted: opts?.syncToken ? "true" : undefined,
                syncToken: opts?.syncToken,
                timeMin: opts?.syncToken ? undefined : opts?.timeMin,
                timeMax: opts?.syncToken ? undefined : opts?.timeMax,
            }
        );
        if (page?.items) events.push(...page.items);
        pageToken = page?.nextPageToken;
        if (page?.nextSyncToken) nextSyncToken = page.nextSyncToken;
    } while (pageToken);

    return { events, nextSyncToken };
}

export async function createGoogleEvent(
    accessToken: string,
    calendarId: string,
    body: unknown
): Promise<GoogleEvent> {
    const result = await googleFetch<GoogleEvent>(
        accessToken,
        "POST",
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        undefined,
        body
    );
    if (!result) throw new Error("Google createEvent returned no body.");
    return result;
}

export async function patchGoogleEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    body: unknown
): Promise<GoogleEvent> {
    const result = await googleFetch<GoogleEvent>(
        accessToken,
        "PATCH",
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
            eventId
        )}`,
        undefined,
        body
    );
    if (!result) throw new Error("Google patchEvent returned no body.");
    return result;
}

export async function deleteGoogleEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
): Promise<void> {
    await googleFetch<null>(
        accessToken,
        "DELETE",
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
            eventId
        )}`
    );
}

/* -------------------------------------------------------------------------- */
/* Conversion: Google ↔ OFCEvent                                              */
/* -------------------------------------------------------------------------- */

function parseGoogleDateTime(
    g: GoogleEventDateTime | undefined
): { date: string; time: string | null } | null {
    if (!g) return null;
    if (g.date) {
        return { date: g.date, time: null };
    }
    if (g.dateTime) {
        const dt = g.timeZone
            ? DateTime.fromISO(g.dateTime, { setZone: true }).setZone(
                  g.timeZone
              )
            : DateTime.fromISO(g.dateTime, { setZone: true }).toLocal();
        if (!dt.isValid) return null;
        return {
            date: dt.toISODate(),
            time: dt.toFormat("HH:mm"),
        };
    }
    return null;
}

function inclusiveAllDayEnd(start: string, exclusiveEnd: string): string | null {
    const s = DateTime.fromISO(start, { zone: "utc" });
    const e = DateTime.fromISO(exclusiveEnd, { zone: "utc" });
    if (!s.isValid || !e.isValid) return null;
    const diffDays = e.diff(s, "days").days;
    if (diffDays <= 1) return null;
    return e.minus({ days: 1 }).toISODate();
}

function extractRRule(recurrence: string[]): {
    rrule: string;
    skipDates: string[];
} | null {
    const rrules: string[] = [];
    const skipDates: string[] = [];
    for (const line of recurrence) {
        if (line.startsWith("RRULE:")) {
            rrules.push(line.slice("RRULE:".length));
        } else if (line.startsWith("EXDATE")) {
            // EXDATE can be "EXDATE;TZID=...:20240115T100000" or
            // "EXDATE:20240115" or comma-separated values.
            const colon = line.indexOf(":");
            if (colon < 0) continue;
            const values = line.slice(colon + 1).split(",");
            for (const v of values) {
                const date = v.slice(0, 8);
                if (date.length === 8) {
                    skipDates.push(
                        `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(
                            6,
                            8
                        )}`
                    );
                }
            }
        }
    }
    if (rrules.length === 0) return null;
    return { rrule: rrules.join("\n"), skipDates };
}

/**
 * Convert a Google event into an OFCEvent. Returns null for events that should
 * not be displayed (cancelled, missing fields, or recurrence-instance overrides
 * we don't render directly).
 */
export function googleToOFC(g: GoogleEvent): OFCEvent | null {
    if (g.status === "cancelled") return null;

    const start = parseGoogleDateTime(g.start);
    const end = parseGoogleDateTime(g.end);
    if (!start || !end) return null;

    const allDay = start.time === null;
    const title = g.summary || "(untitled)";
    const descriptionPart = g.description ? { description: g.description } : {};
    const id = g.id;
    const color = g.colorId ? googleColorIdToHex(g.colorId) : undefined;
    const colorPart = color ? { color } : {};

    const timePart = allDay
        ? { allDay: true as const }
        : {
              allDay: false as const,
              startTime: start.time as string,
              endTime: end.time as string,
          };

    if (g.recurrence && g.recurrence.length > 0) {
        const parsed = extractRRule(g.recurrence);
        if (parsed) {
            const candidate = {
                id,
                title,
                ...descriptionPart,
                type: "rrule" as const,
                startDate: start.date,
                rrule: parsed.rrule,
                skipDates: parsed.skipDates,
                ...timePart,
                ...colorPart,
            };
            return validateEvent(candidate);
        }
    }

    const endDate = allDay
        ? inclusiveAllDayEnd(start.date, end.date)
        : end.time !== null && end.date !== start.date
          ? end.date
          : null;

    const candidate = {
        id,
        title,
        ...descriptionPart,
        type: "single" as const,
        date: start.date,
        endDate,
        ...timePart,
        ...colorPart,
    };
    return validateEvent(candidate);
}

/**
 * Apply cancelled-instance exceptions to their master events as EXDATEs.
 * Modified instances (recurringEventId set, status=confirmed) are dropped —
 * v1 limitation; users see the master at the original time/date.
 */
export function foldRecurrenceExceptions(events: GoogleEvent[]): GoogleEvent[] {
    const masters = new Map<string, GoogleEvent>();
    for (const e of events) {
        if (!e.recurringEventId) masters.set(e.id, e);
    }
    const exdatesByMaster: Map<string, string[]> = new Map();
    for (const e of events) {
        if (
            e.recurringEventId &&
            e.status === "cancelled" &&
            e.originalStartTime
        ) {
            const orig = parseGoogleDateTime(e.originalStartTime);
            if (!orig) continue;
            const list = exdatesByMaster.get(e.recurringEventId) || [];
            const compact = orig.date.replace(/-/g, "");
            list.push(compact);
            exdatesByMaster.set(e.recurringEventId, list);
        }
    }
    const out: GoogleEvent[] = [];
    for (const e of events) {
        if (e.recurringEventId) continue;
        if (exdatesByMaster.has(e.id)) {
            const exs = exdatesByMaster.get(e.id) || [];
            const recurrence = [
                ...(e.recurrence || []),
                `EXDATE:${exs.join(",")}`,
            ];
            out.push({ ...e, recurrence });
        } else {
            out.push(e);
        }
    }
    return out;
}

/* ----- OFC → Google -------------------------------------------------------- */

function toGoogleAllDay(date: string): GoogleEventDateTime {
    return { date };
}

function toGoogleDateTime(
    date: string,
    time: string,
    timeZone: string
): GoogleEventDateTime {
    const dt = DateTime.fromISO(`${date}T${time}`, { zone: timeZone });
    return { dateTime: dt.toISO({ suppressMilliseconds: true }), timeZone };
}

function ofcRecurringToRRule(daysOfWeek: string[], endRecur?: string): string {
    const byDay = daysOfWeek
        .map((d) => OFC_TO_GOOGLE_DAY[d])
        .filter((d): d is string => !!d);
    const parts = ["FREQ=WEEKLY"];
    if (byDay.length > 0) parts.push(`BYDAY=${byDay.join(",")}`);
    if (endRecur) {
        const until = DateTime.fromISO(endRecur, { zone: "utc" });
        if (until.isValid) {
            parts.push(`UNTIL=${until.toFormat("yyyyMMdd")}`);
        }
    }
    return `RRULE:${parts.join(";")}`;
}

function ensureRRulePrefix(rrule: string): string[] {
    return rrule
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) =>
            /^(RRULE|EXRULE|RDATE|EXDATE):/i.test(l) ? l : `RRULE:${l}`
        );
}

export type GoogleReminderOverride = {
    /** When true, the plugin sends a custom popup reminder. When false, Google's
     *  calendar-level default reminders are left untouched. */
    enabled: boolean;
    minutes: number;
};

function buildReminders(
    override?: GoogleReminderOverride
): Record<string, unknown> | undefined {
    if (!override || !override.enabled) return undefined;
    const minutes = Math.max(
        0,
        Math.min(40320, Math.floor(override.minutes))
    );
    return {
        useDefault: false,
        overrides: [{ method: "popup", minutes }],
    };
}

/**
 * Convert an OFCEvent into a Google event request body suitable for POST/PATCH.
 */
export function ofcToGoogle(
    event: OFCEvent,
    timeZone: string,
    reminderOverride?: GoogleReminderOverride
): Record<string, unknown> {
    const body: Record<string, unknown> = {
        summary: event.title,
        // Send null when absent so PATCH clears previous Google description.
        description: event.description || null,
    };
    if (event.color) {
        const colorId = hexToGoogleColorId(event.color);
        // Send null to clear a previously-set color when the hex is unknown
        // (falls back to the calendar default).
        body.colorId = colorId ?? null;
    } else {
        body.colorId = null;
    }
    const reminders = buildReminders(reminderOverride);
    if (reminders) body.reminders = reminders;

    if (event.type === "single") {
        if (event.allDay) {
            const startDate = event.date;
            const endDateInclusive = event.endDate || event.date;
            const endExclusive = DateTime.fromISO(endDateInclusive, {
                zone: "utc",
            })
                .plus({ days: 1 })
                .toISODate();
            body.start = toGoogleAllDay(startDate);
            body.end = toGoogleAllDay(endExclusive);
        } else {
            const endDate = event.endDate || event.date;
            body.start = toGoogleDateTime(
                event.date,
                event.startTime,
                timeZone
            );
            body.end = toGoogleDateTime(
                endDate,
                event.endTime || event.startTime,
                timeZone
            );
        }
        return body;
    }

    if (event.type === "recurring") {
        const startDate = event.startRecur || DateTime.local().toISODate();
        if (event.allDay) {
            body.start = toGoogleAllDay(startDate);
            body.end = toGoogleAllDay(
                DateTime.fromISO(startDate, { zone: "utc" })
                    .plus({ days: 1 })
                    .toISODate()
            );
        } else {
            body.start = toGoogleDateTime(
                startDate,
                event.startTime,
                timeZone
            );
            body.end = toGoogleDateTime(
                startDate,
                event.endTime || event.startTime,
                timeZone
            );
        }
        body.recurrence = [
            ofcRecurringToRRule(event.daysOfWeek, event.endRecur),
        ];
        return body;
    }

    // type === "rrule"
    if (event.allDay) {
        body.start = toGoogleAllDay(event.startDate);
        body.end = toGoogleAllDay(
            DateTime.fromISO(event.startDate, { zone: "utc" })
                .plus({ days: 1 })
                .toISODate()
        );
    } else {
        body.start = toGoogleDateTime(
            event.startDate,
            event.startTime,
            timeZone
        );
        body.end = toGoogleDateTime(
            event.startDate,
            event.endTime || event.startTime,
            timeZone
        );
    }
    const lines = ensureRRulePrefix(event.rrule);
    if (event.skipDates.length > 0) {
        const compact = event.skipDates
            .map((d) => d.replace(/-/g, ""))
            .join(",");
        lines.push(`EXDATE:${compact}`);
    }
    body.recurrence = lines;
    return body;
}
