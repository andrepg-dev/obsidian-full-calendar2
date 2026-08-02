import { DateTime, Settings } from "luxon";
import { rrulestr } from "rrule";
import { OFCEvent } from "../types";
import { toEventInput } from "./interop";

// A zone west of Greenwich with no DST, so an evening event falls on the next
// day in UTC. That is what used to push recurring events forward by a day.
const ZONE = "America/Tegucigalpa";

const withZone = (fn: () => void) => () => {
    const original = Settings.defaultZone;
    Settings.defaultZone = ZONE;
    try {
        fn();
    } finally {
        Settings.defaultZone = original;
    }
};

const weeklyEvent: OFCEvent = {
    title: "Ecuaciones diferenciales",
    type: "rrule",
    startDate: "2026-07-21",
    rrule: "FREQ=WEEKLY;UNTIL=20260930T055959Z;BYDAY=TU,TH",
    skipDates: [],
    allDay: false,
    startTime: "19:30",
    endTime: "21:00",
};

/**
 * FullCalendar hands rrule DateMarkers — Dates whose UTC fields hold the local
 * wall clock — whenever the rule carries no timezone. Mirror that here so the
 * expansion under test is the one the view actually performs.
 */
const expand = (rrule: string, from: string, to: string): string[] =>
    rrulestr(rrule, { forceset: true })
        .between(
            new Date(`${from}T00:00:00Z`),
            new Date(`${to}T00:00:00Z`),
            true
        )
        .map((d) =>
            DateTime.fromJSDate(d)
                .setZone("utc")
                .toFormat("ccc yyyy-MM-dd HH:mm")
        );

describe("toEventInput rrule expansion", () => {
    it(
        "anchors the rule to local wall clock, not UTC",
        withZone(() => {
            const event = toEventInput("id", weeklyEvent);
            expect(event?.rrule).toBe(
                "DTSTART:20260721T193000\n" +
                    "RRULE:FREQ=WEEKLY;UNTIL=20260929T235959;BYDAY=TU,TH"
            );
        })
    );

    it(
        "expands onto the requested weekdays",
        withZone(() => {
            const event = toEventInput("id", weeklyEvent);
            expect(
                expand(event?.rrule as string, "2026-07-19", "2026-07-26")
            ).toEqual(["Tue 2026-07-21 19:30", "Thu 2026-07-23 19:30"]);
        })
    );

    it(
        "stops on the last day covered by UNTIL",
        withZone(() => {
            const event = toEventInput("id", weeklyEvent);
            expect(
                expand(event?.rrule as string, "2026-09-27", "2026-10-04")
            ).toEqual(["Tue 2026-09-29 19:30"]);
        })
    );

    it(
        "writes skipped dates in the same floating wall clock",
        withZone(() => {
            const event = toEventInput("id", {
                ...weeklyEvent,
                skipDates: ["2026-08-04"],
            });
            expect(event?.exdate).toEqual(["20260804T193000"]);
            expect(
                expand(
                    `${event?.rrule}\nEXDATE:20260804T193000`,
                    "2026-08-02",
                    "2026-08-09"
                )
            ).toEqual(["Thu 2026-08-06 19:30"]);
        })
    );

    it(
        "drops a DTSTART already present in the stored rule",
        withZone(() => {
            const event = toEventInput("id", {
                ...weeklyEvent,
                rrule: "DTSTART:20260101T000000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU",
            });
            expect(event?.rrule).toBe(
                "DTSTART:20260721T193000\nRRULE:FREQ=WEEKLY;BYDAY=TU"
            );
        })
    );

    it(
        "keeps all-day rules on midnight",
        withZone(() => {
            const event = toEventInput("id", {
                title: "Standup",
                type: "rrule",
                startDate: "2026-07-21",
                rrule: "FREQ=WEEKLY;BYDAY=TU",
                skipDates: [],
                allDay: true,
            });
            expect(event?.rrule).toBe(
                "DTSTART:20260721T000000\nRRULE:FREQ=WEEKLY;BYDAY=TU"
            );
        })
    );
});
