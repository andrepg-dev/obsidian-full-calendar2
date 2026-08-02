import { EventApi, EventInput } from "@fullcalendar/core";
import { OFCEvent } from "../types";

import { DateTime, Duration } from "luxon";

/*
 * Functions for converting between the types used by the FullCalendar view plugin and types used internally by Obsidian Full Calendar.
 */

const parseTime = (time: string): Duration | null => {
    let parsed = DateTime.fromFormat(time, "h:mm a");
    if (parsed.invalidReason) {
        parsed = DateTime.fromFormat(time, "HH:mm");
    }
    if (parsed.invalidReason) {
        parsed = DateTime.fromFormat(time, "HH:mm:ss");
    }

    if (parsed.invalidReason) {
        console.error(
            `FC: Error parsing time string '${time}': ${parsed.invalidReason}'`
        );
        return null;
    }

    return Duration.fromISOTime(
        parsed.toISOTime({
            includeOffset: false,
            includePrefix: false,
        })
    );
};

const normalizeTimeString = (time: string): string | null => {
    const parsed = parseTime(time);
    if (!parsed) {
        return null;
    }
    return parsed.toISOTime({
        suppressMilliseconds: true,
        includePrefix: false,
        suppressSeconds: true,
    });
};

const add = (date: DateTime, time: Duration): DateTime => {
    let hours = time.hours;
    let minutes = time.minutes;
    return date.set({ hour: hours, minute: minutes });
};

const getTime = (date: Date): string =>
    DateTime.fromJSDate(date).toISOTime({
        suppressMilliseconds: true,
        includeOffset: false,
        suppressSeconds: true,
    });

const getDate = (date: Date): string => DateTime.fromJSDate(date).toISODate();

const combineDateTimeStrings = (date: string, time: string): string | null => {
    const parsedDate = DateTime.fromISO(date);
    if (parsedDate.invalidReason) {
        console.error(
            `FC: Error parsing time string '${date}': ${parsedDate.invalidReason}`
        );
        return null;
    }

    const parsedTime = parseTime(time);
    if (!parsedTime) {
        return null;
    }

    return add(parsedDate, parsedTime).toISO({
        includeOffset: false,
        suppressMilliseconds: true,
    });
};

const DAYS = "UMTWRFS";

/*
 * The rrule library expands BYDAY/BYMONTHDAY against the *UTC* fields of its
 * dtstart, and FullCalendar's DateMarkers are UTC-encoded wall clock times.
 * So the whole rule has to stay in floating wall-clock time: hand rrule a real
 * instant and an evening event west of Greenwich rolls into the next UTC day,
 * pushing every occurrence's weekday forward by one.
 *
 * Keeping DTSTART/UNTIL free of a `Z` suffix also keeps FullCalendar on its
 * "no timezone specified" expansion path, where rrule's output already lines up
 * with DateMarkers and needs no further conversion.
 */

const floatingStamp = (dt: DateTime): string =>
    dt.toFormat("yyyyMMdd'T'HHmmss");

const UTC_STAMP = /\d{8}T\d{6}Z/g;

/** Rewrite any UTC timestamp in a rule line (UNTIL, EXDATE, ...) as local wall clock. */
const floatUtcStamps = (line: string): string =>
    line.replace(UTC_STAMP, (stamp) => {
        const parsed = DateTime.fromFormat(stamp, "yyyyMMdd'T'HHmmss'Z'", {
            zone: "utc",
        });
        return parsed.isValid ? floatingStamp(parsed.toLocal()) : stamp;
    });

const normalizeRRuleLines = (rrule: string): string[] =>
    rrule
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^DTSTART/i.test(l))
        .map((l) =>
            /^(RRULE|EXRULE|RDATE|EXDATE)[;:]/i.test(l) ? l : `RRULE:${l}`
        )
        .map(floatUtcStamps);

export function dateEndpointsToFrontmatter(
    start: Date,
    end: Date,
    allDay: boolean
): Partial<OFCEvent> {
    const date = getDate(start);
    // FullCalendar uses an exclusive `end` for all-day selections.
    // Convert to an inclusive endDate for our frontmatter model.
    const endDate = allDay
        ? DateTime.fromJSDate(end).minus({ days: 1 }).toISODate()
        : getDate(end);
    return {
        type: "single",
        date,
        endDate: date !== endDate ? endDate : undefined,
        allDay,
        ...(allDay
            ? {}
            : {
                  startTime: getTime(start),
                  endTime: getTime(end),
              }),
    };
}

export function toEventInput(
    id: string,
    frontmatter: OFCEvent
): EventInput | null {
    const colorOverride = frontmatter.color
        ? {
              backgroundColor: frontmatter.color,
              borderColor: frontmatter.color,
          }
        : {};
    let event: EventInput = {
        id,
        title: frontmatter.title,
        allDay: frontmatter.allDay,
        ...colorOverride,
    };
    const baseExtendedProps = {
        color: frontmatter.color,
        description: frontmatter.description,
    };
    if (frontmatter.type === "recurring") {
        event = {
            ...event,
            daysOfWeek: frontmatter.daysOfWeek.map((c) => DAYS.indexOf(c)),
            startRecur: frontmatter.startRecur,
            endRecur: frontmatter.endRecur,
            extendedProps: { isTask: false, ...baseExtendedProps },
        };
        if (!frontmatter.allDay) {
            event = {
                ...event,
                startTime: normalizeTimeString(frontmatter.startTime || ""),
                endTime: frontmatter.endTime
                    ? normalizeTimeString(frontmatter.endTime)
                    : undefined,
            };
        }
    } else if (frontmatter.type === "rrule") {
        const dtstart = (() => {
            if (frontmatter.allDay) {
                return DateTime.fromISO(frontmatter.startDate);
            } else {
                const dtstartStr = combineDateTimeStrings(
                    frontmatter.startDate,
                    frontmatter.startTime
                );

                if (!dtstartStr) {
                    return null;
                }
                return DateTime.fromISO(dtstartStr);
            }
        })();
        if (dtstart === null || !dtstart.isValid) {
            return null;
        }
        // NOTE: how exdates are handled does not support events which recur more than once per day.
        const exdate = frontmatter.skipDates.flatMap((d) => {
            // Can't do date arithmetic because timezone might change for different exdates due to DST.
            // RRule only has one dtstart that doesn't know about DST/timezone changes.
            // Therefore, just pair the date for this exdate with the start time for the event.
            const date = DateTime.fromISO(d);
            if (!date.isValid) {
                return [];
            }
            return [
                floatingStamp(
                    date.set({
                        hour: dtstart.hour,
                        minute: dtstart.minute,
                        second: dtstart.second,
                    })
                ),
            ];
        });

        event = {
            id,
            title: frontmatter.title,
            allDay: frontmatter.allDay,
            ...colorOverride,
            rrule: [
                `DTSTART:${floatingStamp(dtstart)}`,
                ...normalizeRRuleLines(frontmatter.rrule),
            ].join("\n"),
            exdate,
            extendedProps: { isTask: false, ...baseExtendedProps },
        };

        if (!frontmatter.allDay) {
            const startTime = parseTime(frontmatter.startTime);
            if (startTime && frontmatter.endTime) {
                const endTime = parseTime(frontmatter.endTime);
                const duration = endTime?.minus(startTime);
                if (duration) {
                    event.duration = duration.toISOTime({
                        includePrefix: false,
                        suppressMilliseconds: true,
                        suppressSeconds: true,
                    });
                }
            }
        }
    } else if (frontmatter.type === "single") {
        if (!frontmatter.allDay) {
            const start = combineDateTimeStrings(
                frontmatter.date,
                frontmatter.startTime
            );
            if (!start) {
                return null;
            }
            let end = undefined;
            if (frontmatter.endTime) {
                end = combineDateTimeStrings(
                    frontmatter.endDate || frontmatter.date,
                    frontmatter.endTime
                );
                if (!end) {
                    return null;
                }
            }

            event = {
                ...event,
                start,
                end,
                extendedProps: {
                    isTask:
                        frontmatter.completed !== undefined &&
                        frontmatter.completed !== null,
                    taskCompleted: frontmatter.completed,
                    ...baseExtendedProps,
                },
            };
        } else {
            event = {
                ...event,
                start: frontmatter.date,
                // FullCalendar expects `end` to be exclusive for all-day events.
                end: frontmatter.endDate
                    ? DateTime.fromISO(frontmatter.endDate, { zone: "utc" })
                          .plus({ days: 1 })
                          .toISODate()
                    : undefined,
                extendedProps: {
                    isTask:
                        frontmatter.completed !== undefined &&
                        frontmatter.completed !== null,
                    taskCompleted: frontmatter.completed,
                    ...baseExtendedProps,
                },
            };
        }
    }

    return event;
}

/**
 * @param asSingleInstance Read the event as the one occurrence FullCalendar is
 *        showing rather than as the series it belongs to. Used when a drag
 *        should detach that occurrence instead of moving every one of them.
 */
export function fromEventApi(
    event: EventApi,
    asSingleInstance = false
): OFCEvent {
    const isRecurring: boolean =
        !asSingleInstance && event.extendedProps.daysOfWeek !== undefined;
    const startDate = getDate(event.start as Date);
    // FullCalendar stores all-day `end` as exclusive; normalize to inclusive endDate.
    const endDate = event.allDay
        ? DateTime.fromJSDate(event.end as Date)
              .minus({ days: 1 })
              .toISODate()
        : getDate(event.end as Date);
    const color: string | undefined = event.extendedProps.color;
    return {
        title: event.title,
        description: event.extendedProps.description || "",
        ...(color ? { color } : {}),
        ...(event.allDay
            ? { allDay: true }
            : {
                  allDay: false,
                  startTime: getTime(event.start as Date),
                  endTime: getTime(event.end as Date),
              }),

        ...(isRecurring
            ? {
                  type: "recurring",
                  daysOfWeek: event.extendedProps.daysOfWeek.map(
                      (i: number) => DAYS[i]
                  ),
                  startRecur:
                      event.extendedProps.startRecur &&
                      getDate(event.extendedProps.startRecur),
                  endRecur:
                      event.extendedProps.endRecur &&
                      getDate(event.extendedProps.endRecur),
              }
            : {
                  type: "single",
                  date: startDate,
                  ...(startDate !== endDate ? { endDate } : { endDate: null }),
                  completed: event.extendedProps.taskCompleted,
              }),
    };
}
