import { Notice } from "obsidian";
import * as React from "react";
import { EditableCalendar } from "src/calendars/EditableCalendar";
import WritableRemoteCalendar from "src/calendars/WritableRemoteCalendar";
import FullCalendarPlugin from "src/main";
import { OFCEvent } from "src/types";
import { openFileForEvent } from "./actions";
import { EditEvent } from "./components/EditEvent";
import ReactModal from "./ReactModal";

export function launchCreateModal(
    plugin: FullCalendarPlugin,
    partialEvent: Partial<OFCEvent>
) {
    const calendars = [...plugin.cache.calendars.entries()]
        .filter(
            ([_, cal]) =>
                cal instanceof EditableCalendar ||
                cal instanceof WritableRemoteCalendar
        )
        .map(([id, cal]) => {
            return {
                id,
                type: cal.type,
                name: cal.name,
            };
        });
    new ReactModal(plugin.app, async (closeModal, registerCloseRequest) =>
        React.createElement(EditEvent, {
            app: plugin.app,
            initialEvent: partialEvent,
            calendars,
            defaultCalendarIndex: 0,
            cancel: closeModal,
            registerCloseRequest,
            submit: async (data, calendarIndex) => {
                const calendarId = calendars[calendarIndex].id;
                try {
                    await plugin.cache.addEvent(calendarId, data);
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when creating event: " + e.message);
                        console.error(e);
                    }
                }
                closeModal();
            },
        })
    ).open();
}

/**
 * @param instanceDate ISO date of the occurrence that was clicked. Only
 *        meaningful for repeating events, where it lets the modal offer to edit
 *        that one occurrence instead of the whole series.
 */
export function launchEditModal(
    plugin: FullCalendarPlugin,
    eventId: string,
    instanceDate?: string
) {
    const eventToEdit = plugin.cache.getEventById(eventId);
    if (!eventToEdit) {
        throw new Error("Cannot edit event that doesn't exist.");
    }
    const calId = plugin.cache.getInfoForEditableEvent(eventId).calendar.id;
    const instance =
        instanceDate && plugin.cache.supportsInstanceEdit(eventId)
            ? { date: instanceDate }
            : undefined;

    const calendars = [...plugin.cache.calendars.entries()]
        .filter(
            ([_, cal]) =>
                cal instanceof EditableCalendar ||
                cal instanceof WritableRemoteCalendar
        )
        .map(([id, cal]) => {
            return {
                id,
                type: cal.type,
                name: cal.name,
            };
        });

    const calIdx = calendars.findIndex(({ id }) => id === calId);

    new ReactModal(plugin.app, async (closeModal, registerCloseRequest) =>
        React.createElement(EditEvent, {
            app: plugin.app,
            initialEvent: eventToEdit,
            instance,
            calendars,
            defaultCalendarIndex: calIdx,
            cancel: closeModal,
            registerCloseRequest,
            submit: async (data, calendarIndex, scope) => {
                try {
                    if (instance && scope === "single") {
                        await plugin.cache.updateRecurringInstance(
                            eventId,
                            instance.date,
                            data
                        );
                        closeModal();
                        return;
                    }
                    if (calendarIndex !== calIdx) {
                        await plugin.cache.moveEventToCalendar(
                            eventId,
                            calendars[calendarIndex].id
                        );
                    }
                    await plugin.cache.updateEventWithId(eventId, data);
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when updating event: " + e.message);
                        console.error(e);
                    }
                }
                closeModal();
            },
            open: async () => {
                openFileForEvent(plugin.cache, plugin.app, eventId);
            },
            deleteEvent: async (scope) => {
                try {
                    if (instance && scope === "single") {
                        await plugin.cache.deleteRecurringInstance(
                            eventId,
                            instance.date
                        );
                    } else {
                        await plugin.cache.deleteEvent(eventId);
                    }
                    closeModal();
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when deleting event: " + e.message);
                        console.error(e);
                    }
                }
            },
        })
    ).open();
}
