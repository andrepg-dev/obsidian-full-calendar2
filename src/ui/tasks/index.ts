import { DateTime } from "luxon";
import { OFCEvent } from "src/types";

export const isTask = (e: OFCEvent) =>
    e.type === "single" && e.completed !== undefined && e.completed !== null;

export const unmakeTask = (event: OFCEvent): OFCEvent => {
    if (event.type !== "single") {
        return event;
    }
    return { ...event, completed: null };
};

export const toggleTask = (event: OFCEvent, isDone: boolean): OFCEvent => {
    if (event.type !== "single") {
        return event;
    }
    if (isDone) {
        return { ...event, completed: DateTime.now().toISO() };
    } else {
        return { ...event, completed: false };
    }
};

export const googleTitleTaskState = (
    title: string
): "completed" | "uncompleted" | "inprogress" | null => {
    const trimmed = title.trimStart();
    if (trimmed.startsWith("✅")) {
        return "completed";
    }
    if (trimmed.startsWith("❌")) {
        return "uncompleted";
    }
    if (trimmed.startsWith("🚧")) {
        return "inprogress";
    }
    return null;
};

const stripGoogleTaskPrefix = (title: string): string =>
    title.trimStart().replace(/^(✅|❌|🚧)\s*/, "");

export const markGoogleTitleTaskState = (
    event: OFCEvent,
    state: "completed" | "uncompleted" | "inprogress"
): OFCEvent => {
    const plainTitle = stripGoogleTaskPrefix(event.title);
    const prefix =
        state === "completed" ? "✅" : state === "uncompleted" ? "❌" : "🚧";
    return { ...event, title: `${prefix} ${plainTitle}`.trim() };
};

export const clearGoogleTitleTaskState = (event: OFCEvent): OFCEvent => ({
    ...event,
    title: stripGoogleTaskPrefix(event.title),
});
