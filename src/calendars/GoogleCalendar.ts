import { DateTime } from "luxon";
import { CalendarInfo, OFCEvent } from "../types";
import { EventResponse } from "./Calendar";
import WritableRemoteCalendar from "./WritableRemoteCalendar";
import {
    accessTokenIsFresh,
    GoogleOAuthClient,
    refreshGoogleAccessToken,
} from "./parsing/google/auth";
import {
    createGoogleEvent,
    deleteGoogleEvent,
    foldRecurrenceExceptions,
    GoogleReminderOverride,
    googleToOFC,
    listEvents,
    listInstances,
    ofcToGoogle,
    patchGoogleEvent,
} from "./parsing/google/api";

export type GoogleCalendarTokens = {
    refreshToken: string;
    accessToken?: string;
    expiresAt?: number;
};

/**
 * Pushed back to plugin settings whenever Google issues a new access token.
 * `refreshToken` is included only if Google rotated it.
 */
export type GoogleTokenPersistPayload = {
    accessToken: string;
    expiresAt: number;
    refreshToken?: string;
};

export type GoogleCalendarConfig = {
    color: string;
    accountEmail: string;
    calendarId: string;
    calendarSummary: string;
    initialTokens: GoogleCalendarTokens;
    /** Lazy getter — re-read from plugin settings each call so the user
     *  can update the credentials without restarting Obsidian. */
    getOAuthClient: () => GoogleOAuthClient;
    /** Lazy getter for the reminder override preference; re-read on each
     *  create/update so settings changes take effect immediately. */
    getReminderOverride: () => GoogleReminderOverride;
    persistTokens: (payload: GoogleTokenPersistPayload) => void;
};

export default class GoogleCalendar extends WritableRemoteCalendar {
    private accountEmail: string;
    private calendarId: string;
    private calendarSummary: string;

    private refreshToken: string;
    private accessToken: string | undefined;
    private expiresAt: number | undefined;

    private getOAuthClient: () => GoogleOAuthClient;
    private getReminderOverride: () => GoogleReminderOverride;
    private persistTokens: (payload: GoogleTokenPersistPayload) => void;

    private events: OFCEvent[] = [];
    private inFlightRefresh: Promise<string> | null = null;

    constructor(config: GoogleCalendarConfig) {
        super(config.color);
        this.accountEmail = config.accountEmail;
        this.calendarId = config.calendarId;
        this.calendarSummary = config.calendarSummary;
        this.refreshToken = config.initialTokens.refreshToken;
        this.accessToken = config.initialTokens.accessToken;
        this.expiresAt = config.initialTokens.expiresAt;
        this.getOAuthClient = config.getOAuthClient;
        this.getReminderOverride = config.getReminderOverride;
        this.persistTokens = config.persistTokens;
    }

    get type(): CalendarInfo["type"] {
        return "google";
    }

    get identifier(): string {
        return `${this.accountEmail}::${this.calendarId}`;
    }

    get name(): string {
        return `${this.calendarSummary} (${this.accountEmail})`;
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && accessTokenIsFresh(this.expiresAt)) {
            return this.accessToken;
        }
        if (this.inFlightRefresh) {
            return this.inFlightRefresh;
        }
        this.inFlightRefresh = (async () => {
            const refreshed = await refreshGoogleAccessToken(
                this.getOAuthClient(),
                this.refreshToken
            );
            this.accessToken = refreshed.accessToken;
            this.expiresAt = refreshed.expiresAt;
            this.persistTokens({
                accessToken: refreshed.accessToken,
                expiresAt: refreshed.expiresAt,
            });
            return refreshed.accessToken;
        })();
        try {
            return await this.inFlightRefresh;
        } finally {
            this.inFlightRefresh = null;
        }
    }

    async revalidate(): Promise<void> {
        const token = await this.getAccessToken();
        // Pull a generous window: a year back through two years forward. Good
        // enough for a calendar view; users can extend later via incremental
        // sync tokens.
        const now = DateTime.local();
        const { events: rawEvents } = await listEvents(token, this.calendarId, {
            timeMin: now.minus({ months: 12 }).toISO(),
            timeMax: now.plus({ years: 2 }).toISO(),
        });
        const folded = foldRecurrenceExceptions(rawEvents);
        const converted: OFCEvent[] = [];
        for (const g of folded) {
            const ofc = googleToOFC(g);
            if (ofc) converted.push(ofc);
        }
        this.events = converted;
    }

    async getEvents(): Promise<EventResponse[]> {
        return this.events.map((e) => [e, null]);
    }

    async createRemoteEvent(event: OFCEvent): Promise<string> {
        const token = await this.getAccessToken();
        const tz = DateTime.local().zoneName;
        const body = ofcToGoogle(event, tz, this.getReminderOverride());
        const created = await createGoogleEvent(token, this.calendarId, body);
        const ofc = googleToOFC(created);
        if (ofc) {
            this.events = [...this.events, ofc];
        }
        return created.id;
    }

    async updateRemoteEvent(remoteId: string, event: OFCEvent): Promise<void> {
        const token = await this.getAccessToken();
        const tz = DateTime.local().zoneName;
        const body = ofcToGoogle(event, tz, this.getReminderOverride());
        const updated = await patchGoogleEvent(
            token,
            this.calendarId,
            remoteId,
            body
        );
        const ofc = googleToOFC(updated);
        this.events = this.events
            .filter((e) => e.id !== remoteId)
            .concat(ofc ? [ofc] : []);
    }

    async deleteRemoteEvent(remoteId: string): Promise<void> {
        const token = await this.getAccessToken();
        await deleteGoogleEvent(token, this.calendarId, remoteId);
        this.events = this.events.filter((e) => e.id !== remoteId);
    }

    get supportsInstanceEdits(): boolean {
        return true;
    }

    /**
     * Resolve the Google event id of one occurrence of a series. Patching or
     * deleting that id is what turns the occurrence into an exception; the
     * master's own rule is left alone.
     */
    private async instanceIdFor(
        masterId: string,
        instanceDate: string
    ): Promise<string> {
        const token = await this.getAccessToken();
        const day = DateTime.fromISO(instanceDate);
        if (!day.isValid) {
            throw new Error(`Invalid occurrence date '${instanceDate}'.`);
        }
        // Widen by a day on each side: `instances` filters on the occurrence's
        // instant, which can land in the neighbouring day in another timezone.
        const instances = await listInstances(
            token,
            this.calendarId,
            masterId,
            {
                timeMin: day.minus({ days: 1 }).startOf("day").toISO(),
                timeMax: day.plus({ days: 2 }).startOf("day").toISO(),
            }
        );
        const match = instances.find((inst) => {
            const ofc = googleToOFC(inst);
            return ofc?.type === "single" && ofc.date === instanceDate;
        });
        if (!match) {
            throw new Error(
                `No occurrence of this event on ${instanceDate} was found on Google.`
            );
        }
        return match.id;
    }

    async updateRemoteInstance(
        masterId: string,
        instanceDate: string,
        event: OFCEvent
    ): Promise<void> {
        const instanceId = await this.instanceIdFor(masterId, instanceDate);
        const token = await this.getAccessToken();
        const tz = DateTime.local().zoneName;
        const body = ofcToGoogle(event, tz, this.getReminderOverride());
        // An instance inherits its schedule from the master and rejects a
        // `recurrence` of its own — including the explicit null that a one-off
        // event would otherwise send to clear one.
        delete body.recurrence;
        await patchGoogleEvent(token, this.calendarId, instanceId, body);
    }

    async deleteRemoteInstance(
        masterId: string,
        instanceDate: string
    ): Promise<void> {
        const instanceId = await this.instanceIdFor(masterId, instanceDate);
        const token = await this.getAccessToken();
        await deleteGoogleEvent(token, this.calendarId, instanceId);
    }
}
