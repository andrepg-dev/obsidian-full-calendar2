import { OFCEvent } from "../types";
import RemoteCalendar from "./RemoteCalendar";

/**
 * Calendar whose source of truth is a remote HTTP API (e.g. Google Calendar),
 * but which supports creating, updating and deleting events over the wire.
 *
 * Unlike EditableCalendar (file-based), events here are addressed by a stable
 * remote id string rather than a Vault file + line number.
 */
export default abstract class WritableRemoteCalendar extends RemoteCalendar {
    constructor(color: string) {
        super(color);
    }

    /**
     * Create a remote event.
     * @returns the remote id that should be used to address this event.
     */
    abstract createRemoteEvent(event: OFCEvent): Promise<string>;

    /**
     * Update a remote event identified by its remote id.
     */
    abstract updateRemoteEvent(
        remoteId: string,
        event: OFCEvent
    ): Promise<void>;

    /**
     * Delete a remote event identified by its remote id.
     */
    abstract deleteRemoteEvent(remoteId: string): Promise<void>;

    /**
     * Whether a single occurrence of a recurring series can be edited on its own,
     * leaving the rest of the series untouched.
     */
    get supportsInstanceEdits(): boolean {
        return false;
    }

    /**
     * Detach one occurrence of a recurring series and give it its own details.
     *
     * @param remoteId Remote id of the series (the master event).
     * @param instanceDate ISO date (`yyyy-MM-dd`) of the occurrence being edited,
     *        as it stands *before* the edit.
     * @param event The occurrence's new details, as a one-off event.
     */
    async updateRemoteInstance(
        remoteId: string,
        instanceDate: string,
        event: OFCEvent
    ): Promise<void> {
        throw new Error(
            "This calendar cannot edit a single occurrence of a repeating event."
        );
    }

    /**
     * Remove one occurrence of a recurring series, leaving the rest in place.
     */
    async deleteRemoteInstance(
        remoteId: string,
        instanceDate: string
    ): Promise<void> {
        throw new Error(
            "This calendar cannot delete a single occurrence of a repeating event."
        );
    }
}
