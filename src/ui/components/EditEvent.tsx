import { DateTime } from "luxon";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarInfo, OFCEvent } from "../../types";
import { EVENT_COLOR_PALETTE } from "../calendar";

function makeChangeListener<T>(
    setState: React.Dispatch<React.SetStateAction<T>>,
    fromString: (val: string) => T
): React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> {
    return (e) => setState(fromString(e.target.value));
}

const DAY_MAP: Record<string, string> = {
    U: "Sun",
    M: "Mon",
    T: "Tue",
    W: "Wed",
    R: "Thu",
    F: "Fri",
    S: "Sat",
};

const DaySelect = ({
    value: days,
    onChange,
}: {
    value: string[];
    onChange: (days: string[]) => void;
}) => (
    <div className="ofc-dayrow">
        {Object.entries(DAY_MAP).map(([code, label]) => {
            const isSelected = days.includes(code);
            return (
                <button
                    key={code}
                    type="button"
                    className={
                        "ofc-daychip" + (isSelected ? " is-active" : "")
                    }
                    onClick={() =>
                        isSelected
                            ? onChange(days.filter((c) => c !== code))
                            : onChange([code, ...days])
                    }
                >
                    {label}
                </button>
            );
        })}
    </div>
);

interface EditEventProps {
    submit: (frontmatter: OFCEvent, calendarIndex: number) => Promise<void>;
    readonly calendars: {
        id: string;
        name: string;
        type: CalendarInfo["type"];
    }[];
    defaultCalendarIndex: number;
    initialEvent?: Partial<OFCEvent>;
    open?: () => Promise<void>;
    deleteEvent?: () => Promise<void>;
    cancel?: () => void;
}

function computeDurationMins(start: string, end: string): number | null {
    if (!start || !end) return null;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    if (Number.isNaN(mins) || mins <= 0) return null;
    return mins;
}

function formatDuration(mins: number | null): string {
    if (mins === null) return "";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
}

function parseDuration(input: string): number | null {
    const s = input.trim().toLowerCase();
    if (!s) return null;
    // "1:30" => h:m
    const colon = s.match(/^(\d+):(\d{1,2})$/);
    if (colon) {
        const mins = parseInt(colon[1]) * 60 + parseInt(colon[2]);
        return mins > 0 ? mins : null;
    }
    // "1h 30m", "1h", "30m", "1.5h"
    const hm = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
    if (hm && (hm[1] || hm[2])) {
        const mins =
            Math.round((parseFloat(hm[1] || "0") || 0) * 60) +
            (parseInt(hm[2] || "0") || 0);
        return mins > 0 ? mins : null;
    }
    // bare number => minutes
    const num = s.match(/^(\d+(?:\.\d+)?)$/);
    if (num) {
        const mins = Math.round(parseFloat(num[1]));
        return mins > 0 ? mins : null;
    }
    return null;
}

function addMinutesToTime(start: string, mins: number): string {
    const [sh, sm] = start.split(":").map(Number);
    if (Number.isNaN(sh) || Number.isNaN(sm)) return "";
    let total = sh * 60 + sm + mins;
    total = ((total % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const EditEvent = ({
    initialEvent,
    submit,
    open,
    deleteEvent,
    cancel,
    calendars,
    defaultCalendarIndex,
}: EditEventProps) => {
    const isEdit = Boolean(open);

    const [date, setDate] = useState(
        initialEvent
            ? initialEvent.type === "single"
                ? initialEvent.date
                : initialEvent.type === "recurring"
                ? initialEvent.startRecur
                : initialEvent.type === "rrule"
                ? initialEvent.startDate
                : ""
            : ""
    );
    const [endDate, setEndDate] = useState(
        initialEvent && initialEvent.type === "single"
            ? initialEvent.endDate
            : undefined
    );

    let initialStartTime = "";
    let initialEndTime = "";
    if (initialEvent) {
        // @ts-ignore
        const { startTime, endTime } = initialEvent;
        initialStartTime = startTime || "";
        initialEndTime = endTime || "";
    }

    const [startTime, setStartTime] = useState(initialStartTime);
    const [endTime, setEndTime] = useState(initialEndTime);
    const [title, setTitle] = useState(initialEvent?.title || "");
    const [isRecurring, setIsRecurring] = useState(
        initialEvent?.type === "recurring" || false
    );
    const [endRecur, setEndRecur] = useState("");
    const [daysOfWeek, setDaysOfWeek] = useState<string[]>(
        (initialEvent?.type === "recurring" ? initialEvent.daysOfWeek : []) ||
            []
    );
    const [allDay, setAllDay] = useState(initialEvent?.allDay || false);
    const [calendarIndex, setCalendarIndex] = useState(defaultCalendarIndex);
    const [complete, setComplete] = useState<string | false | null | undefined>(
        initialEvent?.type === "single" &&
            initialEvent.completed !== null &&
            initialEvent.completed !== undefined
            ? initialEvent.completed
            : false
    );
    const [isTask, setIsTask] = useState(
        initialEvent?.type === "single" &&
            initialEvent.completed !== undefined &&
            initialEvent.completed !== null
    );
    const [color, setColor] = useState<string | undefined>(
        initialEvent?.color
    );

    const titleRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    const computedMins = useMemo(
        () => computeDurationMins(startTime, endTime),
        [startTime, endTime]
    );
    const [durationDraft, setDurationDraft] = useState<string | null>(null);
    const durationValue =
        durationDraft !== null ? durationDraft : formatDuration(computedMins);
    const durationInvalid =
        durationDraft !== null &&
        durationDraft.trim() !== "" &&
        parseDuration(durationDraft) === null;

    const commitDuration = () => {
        if (durationDraft === null) return;
        const mins = parseDuration(durationDraft);
        if (mins !== null && startTime) {
            setEndTime(addMinutesToTime(startTime, mins));
        }
        setDurationDraft(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        await submit(
            {
                ...{ title },
                ...(color ? { color } : {}),
                ...(allDay
                    ? { allDay: true }
                    : { allDay: false, startTime: startTime || "", endTime }),
                ...(isRecurring
                    ? {
                          type: "recurring",
                          daysOfWeek: daysOfWeek as (
                              | "U"
                              | "M"
                              | "T"
                              | "W"
                              | "R"
                              | "F"
                              | "S"
                          )[],
                          startRecur: date || undefined,
                          endRecur: endRecur || undefined,
                      }
                    : {
                          type: "single",
                          date: date || "",
                          endDate: endDate || null,
                          completed: isTask ? complete : null,
                      }),
            },
            calendarIndex
        );
    };

    const onKey = (e: React.KeyboardEvent<HTMLFormElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLFormElement).requestSubmit();
        } else if (
            e.key === "Enter" &&
            (e.target as HTMLElement).classList?.contains("ofc-dialog-swatch")
        ) {
            e.preventDefault();
            (e.currentTarget as HTMLFormElement).requestSubmit();
        } else if (e.key === "Escape" && cancel) {
            e.preventDefault();
            cancel();
        }
    };

    const editableCalendars = calendars.flatMap((cal) =>
        cal.type === "local" ||
        cal.type === "dailynote" ||
        cal.type === "google"
            ? [cal]
            : []
    );

    return (
        <form
            className="ofc-dialog"
            onSubmit={handleSubmit}
            onKeyDown={onKey}
        >
            <header className="ofc-dialog-header">
                <span className="ofc-dialog-title">
                    {isEdit ? "Edit event" : "New event"}
                </span>
                <span className="ofc-dialog-hint">esc to close</span>
            </header>

            <div className="ofc-pillrow">
                <button
                    type="button"
                    className={
                        "ofc-pill" + (isRecurring ? " is-active" : "")
                    }
                    onClick={() => setIsRecurring((v) => !v)}
                >
                    ▪ REPEAT
                </button>
            </div>

            <div className="ofc-dialog-body">
                <label className="ofc-field">
                    <span className="ofc-field-label">TITLE</span>
                    <input
                        ref={titleRef}
                        type="text"
                        className="ofc-input"
                        value={title}
                        placeholder="Add title…"
                        required
                        onChange={makeChangeListener(setTitle, (x) => x)}
                    />
                </label>

                <div className="ofc-field">
                    <span className="ofc-field-label">COLOR</span>
                    <div className="ofc-dialog-color-row">
                        {EVENT_COLOR_PALETTE.map((hex) => {
                            const isSelected =
                                !!color &&
                                color.toLowerCase() === hex.toLowerCase();
                            return (
                                <button
                                    key={hex}
                                    type="button"
                                    className={
                                        "ofc-dialog-swatch" +
                                        (isSelected ? " is-selected" : "")
                                    }
                                    style={{ background: hex }}
                                    aria-label={hex}
                                    onClick={() => setColor(hex)}
                                />
                            );
                        })}
                        <button
                            type="button"
                            className={
                                "ofc-dialog-swatch ofc-dialog-swatch-default" +
                                (!color ? " is-selected" : "")
                            }
                            aria-label="Default color"
                            title="Default (calendar color)"
                            onClick={() => setColor(undefined)}
                        />
                    </div>
                </div>

                <div className="ofc-grid-2">
                    <label className="ofc-field">
                        <span className="ofc-field-label">
                            {isRecurring ? "STARTS" : "DATE"}
                        </span>
                        <input
                            type="date"
                            className="ofc-input ofc-input-mono"
                            value={date || ""}
                            required={!isRecurring || !!date}
                            onChange={makeChangeListener(
                                setDate,
                                (x) => x as any
                            )}
                        />
                    </label>
                    <label className="ofc-field">
                        <span className="ofc-field-label">
                            {isRecurring ? "ENDS (OPTIONAL)" : "END DATE"}
                        </span>
                        <input
                            type="date"
                            className="ofc-input ofc-input-mono"
                            value={
                                (isRecurring ? endRecur : endDate || "") || ""
                            }
                            onChange={
                                isRecurring
                                    ? makeChangeListener(setEndRecur, (x) => x)
                                    : makeChangeListener(
                                          setEndDate,
                                          (x) => x as any
                                      )
                            }
                        />
                    </label>
                </div>

                {!allDay && (
                    <div className="ofc-grid-3">
                        <label className="ofc-field">
                            <span className="ofc-field-label">START</span>
                            <input
                                type="time"
                                className="ofc-input ofc-input-mono"
                                value={startTime}
                                required
                                onChange={makeChangeListener(
                                    setStartTime,
                                    (x) => x
                                )}
                            />
                        </label>
                        <label className="ofc-field">
                            <span className="ofc-field-label">END</span>
                            <input
                                type="time"
                                className="ofc-input ofc-input-mono"
                                value={endTime}
                                required
                                onChange={makeChangeListener(
                                    setEndTime,
                                    (x) => x
                                )}
                            />
                        </label>
                        <label className="ofc-field">
                            <span className="ofc-field-label">DURATION</span>
                            <input
                                type="text"
                                className={
                                    "ofc-input ofc-input-mono" +
                                    (durationInvalid ? " is-invalid" : "")
                                }
                                value={durationValue}
                                placeholder="1h 30m"
                                disabled={!startTime}
                                onChange={(e) =>
                                    setDurationDraft(e.target.value)
                                }
                                onBlur={commitDuration}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitDuration();
                                        e.currentTarget.form?.requestSubmit();
                                    }
                                }}
                            />
                        </label>
                    </div>
                )}

                {isRecurring && (
                    <div className="ofc-field">
                        <span className="ofc-field-label">REPEAT ON</span>
                        <DaySelect
                            value={daysOfWeek}
                            onChange={setDaysOfWeek}
                        />
                    </div>
                )}

                {editableCalendars.length > 1 && (
                    <label className="ofc-field">
                        <span className="ofc-field-label">CALENDAR</span>
                        <select
                            className="ofc-input"
                            value={calendarIndex}
                            onChange={makeChangeListener(
                                setCalendarIndex,
                                parseInt
                            )}
                        >
                            {editableCalendars.map((cal, idx) => (
                                <option
                                    key={idx}
                                    value={idx}
                                    disabled={
                                        !(
                                            initialEvent?.title === undefined ||
                                            calendars[calendarIndex].type ===
                                                cal.type
                                        )
                                    }
                                >
                                    {cal.type === "local"
                                        ? cal.name
                                        : cal.type === "google"
                                          ? cal.name
                                          : "Daily Note"}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {isTask && (
                    <label className="ofc-checkbox-row">
                        <input
                            type="checkbox"
                            checked={
                                !(complete === false || complete === undefined)
                            }
                            onChange={(e) =>
                                setComplete(
                                    e.target.checked
                                        ? DateTime.now().toISO()
                                        : false
                                )
                            }
                        />
                        <span>Mark as completed</span>
                    </label>
                )}
            </div>

            <footer className="ofc-dialog-footer">
                <span className="ofc-dialog-hint">⌘↵ to save</span>
                <div className="ofc-dialog-actions">
                    {deleteEvent && (
                        <button
                            type="button"
                            className="ofc-btn ofc-btn-danger"
                            onClick={deleteEvent}
                        >
                            Delete
                        </button>
                    )}
                    {open && (
                        <button
                            type="button"
                            className="ofc-btn ofc-btn-ghost"
                            onClick={open}
                        >
                            Open note
                        </button>
                    )}
                    {cancel && (
                        <button
                            type="button"
                            className="ofc-btn ofc-btn-ghost"
                            onClick={cancel}
                        >
                            Cancel
                        </button>
                    )}
                    <button type="submit" className="ofc-btn ofc-btn-primary">
                        {isEdit ? "Save" : "Create event"}
                    </button>
                </div>
            </footer>
        </form>
    );
};
