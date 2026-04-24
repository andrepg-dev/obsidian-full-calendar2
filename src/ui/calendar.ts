/**
 * Handles rendering the calendar given a container element, eventSources, and interaction callbacks.
 */
import {
    Calendar,
    EventApi,
    EventClickArg,
    EventHoveringArg,
    EventSourceInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import rrulePlugin from "@fullcalendar/rrule";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import googleCalendarPlugin from "@fullcalendar/google-calendar";
import iCalendarPlugin from "@fullcalendar/icalendar";

// There is an issue with FullCalendar RRule support around DST boundaries which is fixed by this monkeypatch:
// https://github.com/fullcalendar/fullcalendar/issues/5273#issuecomment-1360459342
rrulePlugin.recurringTypes[0].expand = function (errd, fr, de) {
    const hours = errd.rruleSet._dtstart.getHours();
    return errd.rruleSet
        .between(de.toDate(fr.start), de.toDate(fr.end), true)
        .map((d: Date) => {
            return new Date(
                Date.UTC(
                    d.getFullYear(),
                    d.getMonth(),
                    d.getDate(),
                    hours,
                    d.getMinutes()
                )
            );
        });
};

interface ExtraRenderProps {
    eventClick?: (info: EventClickArg) => void;
    select?: (
        startDate: Date,
        endDate: Date,
        allDay: boolean,
        viewType: string
    ) => Promise<void>;
    modifyEvent?: (event: EventApi, oldEvent: EventApi) => Promise<boolean>;
    eventMouseEnter?: (info: EventHoveringArg) => void;
    firstDay?: number;
    initialView?: { desktop: string; mobile: string };
    timeFormat24h?: boolean;
    slotMinutes?: number;
    snapMinutes?: number;
    openContextMenuForEvent?: (
        event: EventApi,
        mouseEvent: MouseEvent
    ) => Promise<void>;
    toggleTask?: (event: EventApi, isComplete: boolean) => Promise<boolean>;
    forceNarrow?: boolean;
    selectedEventIds?: Set<string>;
}

// Event color groups — warm = productive/focus, cool = rest/calm, neutral = misc.
export const EVENT_COLOR_GROUPS: {
    label: string;
    colors: { hex: string; name: string }[];
}[] = [
    {
        label: "PRODUCTIVO",
        colors: [
            { hex: "#D50000", name: "Tomato" },
            { hex: "#F4511E", name: "Tangerine" },
            { hex: "#F6BF26", name: "Banana" },
            { hex: "#E67C73", name: "Flamingo" },
        ],
    },
    {
        label: "DESCANSO",
        colors: [
            { hex: "#33B679", name: "Sage" },
            { hex: "#039BE5", name: "Peacock" },
            { hex: "#7986CB", name: "Lavender" },
            { hex: "#8E24AA", name: "Grape" },
        ],
    },
    {
        label: "NEUTRO",
        colors: [{ hex: "#616161", name: "Graphite" }],
    },
];

export const EVENT_COLOR_PALETTE: string[] = EVENT_COLOR_GROUPS.flatMap((g) =>
    g.colors.map((c) => c.hex)
);

export function getColorMeta(
    hex: string
): { name: string; group: string } | null {
    const target = hex.toLowerCase();
    for (const g of EVENT_COLOR_GROUPS) {
        const found = g.colors.find((c) => c.hex.toLowerCase() === target);
        if (found) return { name: found.name, group: g.label };
    }
    return null;
}

export function openColorPalette(opts: {
    anchor: HTMLElement | { x: number; y: number };
    currentColor: string | null;
    onPick: (color: string | null) => void;
}) {
    document
        .querySelectorAll(".ofc-color-popover")
        .forEach((el) => el.remove());
    let top: number;
    let left: number;
    if ("getBoundingClientRect" in opts.anchor) {
        const rect = opts.anchor.getBoundingClientRect();
        top = rect.bottom + 4;
        left = rect.left;
    } else {
        top = opts.anchor.y;
        left = opts.anchor.x;
    }
    const pop = document.createElement("div");
    pop.className = "ofc-color-popover";
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    for (const hex of EVENT_COLOR_PALETTE) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "ofc-color-swatch";
        dot.style.background = hex;
        dot.setAttribute("aria-label", hex);
        if (
            opts.currentColor &&
            opts.currentColor.toLowerCase() === hex.toLowerCase()
        ) {
            dot.classList.add("is-selected");
        }
        dot.onclick = (e) => {
            e.stopPropagation();
            pop.remove();
            opts.onPick(hex);
        };
        pop.appendChild(dot);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ofc-color-clear";
    clear.textContent = "Default";
    clear.onclick = (e) => {
        e.stopPropagation();
        pop.remove();
        opts.onPick(null);
    };
    pop.appendChild(clear);

    document.body.appendChild(pop);

    const closer = (e: MouseEvent) => {
        if (!pop.contains(e.target as Node)) {
            pop.remove();
            document.removeEventListener("mousedown", closer, true);
        }
    };
    setTimeout(
        () => document.addEventListener("mousedown", closer, true),
        0
    );
}

export function renderCalendar(
    containerEl: HTMLElement,
    eventSources: EventSourceInput[],
    settings?: ExtraRenderProps
): Calendar {
    const isMobile = window.innerWidth < 500;
    const isNarrow = settings?.forceNarrow || isMobile;
    const {
        eventClick,
        select,
        modifyEvent,
        eventMouseEnter,
        openContextMenuForEvent,
        toggleTask,
        selectedEventIds,
    } = settings || {};
    const modifyEventCallback =
        modifyEvent &&
        (async ({
            event,
            oldEvent,
            revert,
        }: {
            event: EventApi;
            oldEvent: EventApi;
            revert: () => void;
        }) => {
            const success = await modifyEvent(event, oldEvent);
            if (!success) {
                revert();
            }
        });

    const cal = new Calendar(containerEl, {
        plugins: [
            // View plugins
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            // Drag + drop and editing
            interactionPlugin,
            // Remote sources
            googleCalendarPlugin,
            iCalendarPlugin,
            rrulePlugin,
        ],
        googleCalendarApiKey: "AIzaSyDIiklFwJXaLWuT_4y6I9ZRVVsPuf4xGrk",
        initialView:
            settings?.initialView?.[isNarrow ? "mobile" : "desktop"] ||
            (isNarrow ? "timeGrid3Days" : "timeGridWeek"),
        nowIndicator: true,
        scrollTimeReset: false,
        dayMaxEvents: true,

        dayHeaderContent: (arg) => {
            if (arg.view.type.startsWith("timeGrid")) {
                const weekday = arg.date
                    .toLocaleDateString(undefined, { weekday: "short" })
                    .toUpperCase();
                const day = arg.date.getDate();
                return {
                    html: `<div class="ofc-dayhead"><span class="ofc-dayhead-weekday">${weekday}</span><span class="ofc-dayhead-date">${day}</span></div>`,
                };
            }
            return undefined;
        },

        headerToolbar: !isNarrow
            ? {
                  left: "prev,next today",
                  center: "title",
                  right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
              }
            : !isMobile
            ? {
                  right: "today,prev,next",
                  left: "timeGrid3Days,timeGridDay,listWeek",
              }
            : false,
        footerToolbar: isMobile
            ? {
                  right: "today,prev,next",
                  left: "timeGrid3Days,timeGridDay,listWeek",
              }
            : false,

        views: {
            timeGridDay: {
                type: "timeGrid",
                duration: { days: 1 },
                buttonText: isNarrow ? "1" : "day",
            },
            timeGrid3Days: {
                type: "timeGrid",
                duration: { days: 3 },
                buttonText: "3",
            },
        },
        firstDay: settings?.firstDay,
        ...(() => {
            const toDuration = (raw: number | undefined) => {
                if (!raw || raw <= 0) return undefined;
                const m = Math.max(1, Math.min(60, Math.floor(raw)));
                const hh = String(Math.floor(m / 60)).padStart(2, "0");
                const mm = String(m % 60).padStart(2, "0");
                return `${hh}:${mm}:00`;
            };
            const slot = toDuration(settings?.slotMinutes);
            // Fall back to slotDuration if snap isn't configured so that
            // existing setups keep their previous behavior.
            const snap =
                toDuration(settings?.snapMinutes) ?? slot;
            const out: Record<string, string> = {};
            if (slot) out.slotDuration = slot;
            if (snap) out.snapDuration = snap;
            return out;
        })(),
        ...(settings?.timeFormat24h && {
            eventTimeFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
            slotLabelFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
        }),
        eventSources,
        eventClick,

        selectable: select && true,
        selectMirror: select && true,
        select:
            select &&
            (async (info) => {
                await select(info.start, info.end, info.allDay, info.view.type);
                info.view.calendar.unselect();
            }),

        editable: modifyEvent && true,
        eventDrop: modifyEventCallback,
        eventResize: modifyEventCallback,

        eventMouseEnter,

        eventDidMount: ({ event, el, textColor }) => {
            if (selectedEventIds?.has(event.id)) {
                el.classList.add("ofc-selected");
            }
            el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                openContextMenuForEvent && openContextMenuForEvent(event, e);
            });

            // Per-event color: expose as a CSS variable so overrides.css can
            // paint both the left border and the translucent ::before overlay
            // with the picked hex (the theme forces `background: transparent`
            // on event chips, so FullCalendar's inline background-color alone
            // is not enough).
            const perEventColor = event.extendedProps.color as
                | string
                | undefined;
            if (perEventColor) {
                el.style.setProperty("--ofc-event-color", perEventColor);
                el.classList.add("ofc-event-colored");
            }
            if (toggleTask) {
                if (event.extendedProps.isTask) {
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked =
                        event.extendedProps.taskCompleted !== false;
                    checkbox.onclick = async (e) => {
                        e.stopPropagation();
                        if (e.target) {
                            let ret = await toggleTask(
                                event,
                                (e.target as HTMLInputElement).checked
                            );
                            if (!ret) {
                                (e.target as HTMLInputElement).checked = !(
                                    e.target as HTMLInputElement
                                ).checked;
                            }
                        }
                    };
                    // Make the checkbox more visible against different color events.
                    if (textColor == "black") {
                        checkbox.addClass("ofc-checkbox-black");
                    } else {
                        checkbox.addClass("ofc-checkbox-white");
                    }

                    if (checkbox.checked) {
                        el.addClass("ofc-task-completed");
                    }

                    // Depending on the view, we should put the checkbox in a different spot.
                    const container =
                        el.querySelector(".fc-event-time") ||
                        el.querySelector(".fc-event-title") ||
                        el.querySelector(".fc-list-event-title");

                    container?.addClass("ofc-has-checkbox");
                    container?.prepend(checkbox);
                }
            }
        },

        longPressDelay: 250,
    });
    cal.render();
    return cal;
}
