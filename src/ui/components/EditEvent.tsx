import { DateTime } from "luxon";
import { Component, MarkdownRenderer } from "obsidian";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarInfo, OFCEvent } from "../../types";
import { EVENT_COLOR_GROUPS, getColorMeta } from "../calendar";

/**
 * Live Obsidian-style markdown preview. Renders `markdown` with Obsidian's
 * own renderer so the description reads exactly like it would in a note.
 * Renders into a detached node and swaps it in on completion so that fast
 * typing never leaves a stale, half-rendered result behind.
 */
const MarkdownPreview = ({
    markdown,
    sourcePath,
}: {
    markdown: string;
    sourcePath: string;
}) => {
    const elRef = useRef<HTMLDivElement>(null);
    const componentRef = useRef<Component | null>(null);
    if (componentRef.current === null) {
        componentRef.current = new Component();
    }

    useEffect(() => {
        const component = componentRef.current!;
        component.load();
        return () => component.unload();
    }, []);

    useEffect(() => {
        const el = elRef.current;
        const component = componentRef.current;
        if (!el || !component) return;
        let cancelled = false;
        const staging = document.createElement("div");
        MarkdownRenderer.renderMarkdown(
            markdown,
            staging,
            sourcePath,
            component
        ).then(() => {
            if (cancelled || !elRef.current) return;
            elRef.current.empty();
            elRef.current.append(...Array.from(staging.childNodes));
        });
        return () => {
            cancelled = true;
        };
    }, [markdown, sourcePath]);

    return (
        <div
            ref={elRef}
            className="ofc-md-preview markdown-rendered markdown-preview-view"
        />
    );
};

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
    registerCloseRequest?: (handler?: () => void) => void;
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
    registerCloseRequest,
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
    const [description, setDescription] = useState(initialEvent?.description || "");
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
    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const formRef = useRef<HTMLFormElement>(null);

    const autoResizeDescription = () => {
        const el = descriptionRef.current;
        if (!el) return;
        el.style.height = "auto";
        const maxHeightPx = 200;
        const nextHeight = Math.min(el.scrollHeight, maxHeightPx);
        el.style.height = `${nextHeight}px`;
        el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
    };

    useEffect(() => {
        titleRef.current?.focus();
    }, []);
    useEffect(() => {
        autoResizeDescription();
    }, [description]);

    const [colorOpen, setColorOpen] = useState(false);
    const colorRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!colorOpen) return;
        const onDown = (e: MouseEvent) => {
            if (
                colorRef.current &&
                !colorRef.current.contains(e.target as Node)
            ) {
                setColorOpen(false);
            }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [colorOpen]);
    const colorMeta = color ? getColorMeta(color) : null;

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

    const buildEvent = (): OFCEvent =>
        ({
            ...{ title },
            description: description.trim(),
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
        }) as OFCEvent;

    const formSnapshot = JSON.stringify({ event: buildEvent(), calendarIndex });
    const initialFormSnapshot = useRef(formSnapshot);
    const isDirty = initialFormSnapshot.current !== formSnapshot;
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const isDirtyRef = useRef(isDirty);
    const showCloseConfirmRef = useRef(showCloseConfirm);
    isDirtyRef.current = isDirty;
    showCloseConfirmRef.current = showCloseConfirm;

    const requestClose = useCallback(() => {
        if (!cancel) return;
        if (showCloseConfirmRef.current) {
            setShowCloseConfirm(false);
            return;
        }
        if (isDirtyRef.current) {
            setShowCloseConfirm(true);
            return;
        }
        cancel();
    }, [cancel]);

    useEffect(() => {
        registerCloseRequest?.(requestClose);
        return () => registerCloseRequest?.(undefined);
    }, [registerCloseRequest, requestClose]);

    const saveAndClose = () => {
        setShowCloseConfirm(false);
        formRef.current?.requestSubmit();
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setShowCloseConfirm(false);
        await submit(buildEvent(), calendarIndex);
    };

    // Cmd/Ctrl+Enter closes the modal immediately and fires the save in the
    // background. Errors from `submit` are surfaced by the caller via a Notice.
    const fastSubmit = (form: HTMLFormElement) => {
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }
        if (durationDraft !== null) commitDuration();
        const data = buildEvent();
        if (cancel) cancel();
        void submit(data, calendarIndex);
    };

    const onKey = (e: React.KeyboardEvent<HTMLFormElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            fastSubmit(e.currentTarget as HTMLFormElement);
        } else if (
            e.key === "Enter" &&
            (e.target as HTMLElement).classList?.contains("ofc-dialog-swatch")
        ) {
            e.preventDefault();
            (e.currentTarget as HTMLFormElement).requestSubmit();
        } else if (e.key === "Escape" && cancel) {
            e.preventDefault();
            e.stopPropagation();
            if (showCloseConfirm) {
                setShowCloseConfirm(false);
                return;
            }
            requestClose();
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
            ref={formRef}
            className="ofc-dialog"
            onSubmit={handleSubmit}
            onKeyDown={onKey}
        >
            {showCloseConfirm && (
                <div
                    className="ofc-close-confirm"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="ofc-close-confirm-title"
                >
                    <div className="ofc-close-confirm-panel">
                        <span
                            className="ofc-close-confirm-title"
                            id="ofc-close-confirm-title"
                        >
                            Save changes?
                        </span>
                        <span className="ofc-close-confirm-copy">
                            This event has unsaved changes.
                        </span>
                        <div className="ofc-close-confirm-actions">
                            <button
                                type="button"
                                className="ofc-btn ofc-btn-ghost"
                                onClick={() => setShowCloseConfirm(false)}
                            >
                                Keep editing
                            </button>
                            <button
                                type="button"
                                className="ofc-btn ofc-btn-ghost"
                                onClick={cancel}
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                className="ofc-btn ofc-btn-primary"
                                onClick={saveAndClose}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
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

                <div className="ofc-field ofc-md-field">
                    <span className="ofc-field-label">DESCRIPTION</span>
                    <textarea
                        ref={descriptionRef}
                        className="ofc-input ofc-md-input"
                        value={description}
                        placeholder="Add description… (markdown supported)"
                        rows={1}
                        style={{
                            resize: "none",
                            maxHeight: "200px",
                            overflowY: "hidden",
                        }}
                        onChange={(e) => {
                            setDescription(e.target.value);
                            autoResizeDescription();
                        }}
                    />
                    {description.trim() !== "" && (
                        <div className="ofc-md-preview-wrap">
                            <span className="ofc-md-preview-badge">PREVIEW</span>
                            <MarkdownPreview
                                markdown={description}
                                sourcePath=""
                            />
                        </div>
                    )}
                </div>

                <label className="ofc-field">
                    <span className="ofc-field-label">COLOR</span>
                    <div
                        className="ofc-color-dropdown"
                        ref={colorRef}
                        onMouseEnter={() => setColorOpen(true)}
                        onMouseLeave={() => setColorOpen(false)}
                    >
                        <button
                            type="button"
                            className="ofc-input ofc-color-dropdown-trigger"
                            onClick={() => setColorOpen((v) => !v)}
                            aria-haspopup="listbox"
                            aria-expanded={colorOpen}
                        >
                            <span
                                className={
                                    "ofc-dialog-swatch" +
                                    (!color
                                        ? " ofc-dialog-swatch-default"
                                        : "")
                                }
                                style={
                                    color ? { background: color } : undefined
                                }
                                aria-hidden
                            />
                            <span className="ofc-color-dropdown-text">
                                {color
                                    ? colorMeta
                                        ? `${colorMeta.group} · ${colorMeta.name}`
                                        : color
                                    : "Default (calendar color)"}
                            </span>
                            <span className="ofc-color-dropdown-caret">▾</span>
                        </button>
                        {colorOpen && (
                            <div
                                className="ofc-color-dropdown-popover"
                                role="listbox"
                            >
                                {EVENT_COLOR_GROUPS.map((group) => (
                                    <div
                                        key={group.label}
                                        className="ofc-dialog-color-group"
                                    >
                                        <span className="ofc-dialog-color-group-label">
                                            {group.label}
                                        </span>
                                        <div className="ofc-dialog-color-row">
                                            {group.colors.map((c) => {
                                                const isSelected =
                                                    !!color &&
                                                    color.toLowerCase() ===
                                                        c.hex.toLowerCase();
                                                return (
                                                    <button
                                                        key={c.hex}
                                                        type="button"
                                                        className={
                                                            "ofc-dialog-swatch" +
                                                            (isSelected
                                                                ? " is-selected"
                                                                : "")
                                                        }
                                                        style={{
                                                            background: c.hex,
                                                        }}
                                                        title={c.name}
                                                        aria-label={c.name}
                                                        onClick={() => {
                                                            setColor(c.hex);
                                                            setColorOpen(false);
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                                <div className="ofc-dialog-color-group">
                                    <span className="ofc-dialog-color-group-label">
                                        DEFAULT
                                    </span>
                                    <div className="ofc-dialog-color-row">
                                        <button
                                            type="button"
                                            className={
                                                "ofc-dialog-swatch ofc-dialog-swatch-default" +
                                                (!color ? " is-selected" : "")
                                            }
                                            aria-label="Default color"
                                            title="Default (calendar color)"
                                            onClick={() => {
                                                setColor(undefined);
                                                setColorOpen(false);
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </label>

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
                            onClick={requestClose}
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
