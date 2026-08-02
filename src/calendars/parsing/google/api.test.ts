import { OFCEvent } from "../../../types";
import { foldRecurrenceExceptions, googleToOFC, ofcToGoogle } from "./api";

const ZONE = "America/Tegucigalpa"; // UTC-6, no DST

describe("ofcToGoogle", () => {
    it("clears the schedule when an event stops repeating", () => {
        const single: OFCEvent = {
            title: "Ecuaciones diferenciales",
            type: "single",
            date: "2026-07-21",
            endDate: null,
            allDay: false,
            startTime: "19:30",
            endTime: "21:00",
        };
        // A PATCH that omits `recurrence` leaves the old rule in place.
        expect(ofcToGoogle(single, ZONE).recurrence).toBeNull();
    });

    const weekly: OFCEvent = {
        title: "Ecuaciones diferenciales",
        type: "recurring",
        daysOfWeek: ["T", "R"],
        startRecur: "2026-07-21",
        endRecur: "2026-09-29",
        allDay: false,
        startTime: "19:30",
        endTime: "21:00",
    };

    it("sends UNTIL as a UTC timestamp covering the whole last day", () => {
        expect(ofcToGoogle(weekly, ZONE).recurrence).toEqual([
            "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260930T055959Z",
        ]);
    });

    it("anchors the series on the first selected weekday", () => {
        // Monday start, Tue/Thu schedule: without alignment RFC 5545 would add
        // a stray occurrence on the Monday.
        const body = ofcToGoogle({ ...weekly, startRecur: "2026-07-20" }, ZONE);
        expect(body.start).toEqual({
            dateTime: "2026-07-21T19:30:00-06:00",
            timeZone: ZONE,
        });
    });

    it("keeps UNTIL a plain date for all-day series", () => {
        const allDay: OFCEvent = {
            title: "Standup",
            type: "recurring",
            daysOfWeek: ["T"],
            startRecur: "2026-07-21",
            endRecur: "2026-09-29",
            allDay: true,
        };
        expect(ofcToGoogle(allDay, ZONE).recurrence).toEqual([
            "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20260929",
        ]);
    });

    it("round-trips a weekly series through Google's own representation", () => {
        const body = ofcToGoogle(weekly, ZONE) as Record<string, any>;
        const back = googleToOFC({
            id: "abc",
            summary: body.summary,
            start: body.start,
            end: body.end,
            recurrence: body.recurrence,
        });
        expect(back).toMatchObject({
            type: "rrule",
            startDate: "2026-07-21",
            startTime: "19:30",
            endTime: "21:00",
            rrule: "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260930T055959Z",
        });
    });
});

describe("foldRecurrenceExceptions", () => {
    const master = {
        id: "series",
        summary: "Programación II",
        start: { dateTime: "2026-07-22T19:30:00-06:00", timeZone: ZONE },
        end: { dateTime: "2026-07-22T21:00:00-06:00", timeZone: ZONE },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
    };

    const instanceOn = (date: string, movedTo: string) => ({
        id: `series_${date.replace(/-/g, "")}T013000Z`,
        summary: "Programación II",
        recurringEventId: "series",
        originalStartTime: {
            dateTime: `${date}T19:30:00-06:00`,
            timeZone: ZONE,
        },
        start: { dateTime: `${movedTo}T16:00:00-06:00`, timeZone: ZONE },
        end: { dateTime: `${movedTo}T17:30:00-06:00`, timeZone: ZONE },
    });

    it("keeps a moved occurrence and frees its slot in the series", () => {
        const folded = foldRecurrenceExceptions([
            master,
            instanceOn("2026-07-24", "2026-07-25"),
        ]);
        expect(folded).toHaveLength(2);
        expect(folded[0].recurrence).toEqual([
            "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
            "EXDATE:20260724",
        ]);
        // The detached occurrence stands alone at its new time.
        expect(googleToOFC(folded[1])).toMatchObject({
            type: "single",
            date: "2026-07-25",
            startTime: "16:00",
        });
    });

    it("drops a cancelled occurrence entirely", () => {
        const cancelled = {
            ...instanceOn("2026-07-24", "2026-07-24"),
            status: "cancelled" as const,
        };
        const folded = foldRecurrenceExceptions([master, cancelled]);
        expect(folded).toHaveLength(1);
        expect(folded[0].recurrence).toContain("EXDATE:20260724");
    });
});
