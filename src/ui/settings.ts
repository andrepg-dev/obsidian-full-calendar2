import FullCalendarPlugin from "../main";
import {
    App,
    DropdownComponent,
    Notice,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
} from "obsidian";
import { makeDefaultPartialCalendarSource, CalendarInfo } from "../types";
import { CalendarSettings } from "./components/CalendarSetting";
import { AddCalendarSource } from "./components/AddCalendarSource";
import * as ReactDOM from "react-dom";
import { createElement } from "react";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import ReactModal from "./ReactModal";
import { importCalendars } from "src/calendars/parsing/caldav/import";

export interface FullCalendarSettings {
    calendarSources: CalendarInfo[];
    defaultCalendar: number;
    firstDay: number;
    initialView: {
        desktop: string;
        mobile: string;
    };
    timeFormat24h: boolean;
    slotMinutes: number;
    snapMinutes: number;
    clickToCreateEventFromMonthView: boolean;
    googleClientId: string;
    googleClientSecret: string;
    googleOverrideReminder: boolean;
    googleReminderMinutes: number;
}

export const DEFAULT_SETTINGS: FullCalendarSettings = {
    calendarSources: [],
    defaultCalendar: 0,
    firstDay: 0,
    initialView: {
        desktop: "timeGridWeek",
        mobile: "timeGrid3Days",
    },
    timeFormat24h: false,
    slotMinutes: 30,
    snapMinutes: 15,
    clickToCreateEventFromMonthView: true,
    googleClientId: "",
    googleClientSecret: "",
    googleOverrideReminder: true,
    googleReminderMinutes: 5,
};

const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const INITIAL_VIEW_OPTIONS = {
    DESKTOP: {
        timeGridDay: "Day",
        timeGridWeek: "Week",
        dayGridMonth: "Month",
        listWeek: "List",
    },
    MOBILE: {
        timeGrid3Days: "3 Days",
        timeGridDay: "Day",
        listWeek: "List",
    },
};

export function addCalendarButton(
    app: App,
    plugin: FullCalendarPlugin,
    containerEl: HTMLElement,
    submitCallback: (setting: CalendarInfo) => void,
    listUsedDirectories?: () => string[]
) {
    let dropdown: DropdownComponent;
    const directories = app.vault
        .getAllLoadedFiles()
        .filter((f) => f instanceof TFolder)
        .map((f) => f.path);

    return new Setting(containerEl)
        .setName("Calendars")
        .setDesc("Add calendar")
        .addDropdown(
            (d) =>
                (dropdown = d.addOptions({
                    local: "Full note",
                    dailynote: "Daily Note",
                    google: "Google Calendar",
                    icloud: "iCloud",
                    caldav: "CalDAV",
                    ical: "Remote (.ics format)",
                }))
        )
        .addExtraButton((button) => {
            button.setTooltip("Add Calendar");
            button.setIcon("plus-with-circle");
            button.onClick(() => {
                let modal = new ReactModal(app, async () => {
                    await plugin.loadSettings();
                    const usedDirectories = (
                        listUsedDirectories
                            ? listUsedDirectories
                            : () =>
                                  plugin.settings.calendarSources
                                      .map(
                                          (s) =>
                                              s.type === "local" && s.directory
                                      )
                                      .filter((s): s is string => !!s)
                    )();
                    let headings: string[] = [];
                    let { template } = getDailyNoteSettings();

                    if (template) {
                        if (!template.endsWith(".md")) {
                            template += ".md";
                        }
                        const file = app.vault.getAbstractFileByPath(template);
                        if (file instanceof TFile) {
                            headings =
                                app.metadataCache
                                    .getFileCache(file)
                                    ?.headings?.map((h) => h.heading) || [];
                        }
                    }

                    return createElement(AddCalendarSource, {
                        source: makeDefaultPartialCalendarSource(
                            dropdown.getValue() as CalendarInfo["type"]
                        ),
                        directories: directories.filter(
                            (dir) => usedDirectories.indexOf(dir) === -1
                        ),
                        headings,
                        googleOAuthClient: {
                            clientId: plugin.settings.googleClientId,
                            clientSecret: plugin.settings.googleClientSecret,
                        },
                        submit: async (source: CalendarInfo) => {
                            if (source.type === "caldav") {
                                try {
                                    let sources = await importCalendars(
                                        {
                                            type: "basic",
                                            username: source.username,
                                            password: source.password,
                                        },
                                        source.url
                                    );
                                    sources.forEach((source) =>
                                        submitCallback(source)
                                    );
                                } catch (e) {
                                    if (e instanceof Error) {
                                        new Notice(e.message);
                                    }
                                }
                            } else {
                                submitCallback(source);
                            }
                            modal.close();
                        },
                    });
                });
                modal.open();
            });
        });
}

export class FullCalendarSettingTab extends PluginSettingTab {
    plugin: FullCalendarPlugin;

    constructor(app: App, plugin: FullCalendarPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Calendar Preferences" });
        new Setting(containerEl)
            .setName("Desktop Initial View")
            .setDesc("Choose the initial view range on desktop devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS.DESKTOP).forEach(
                    ([value, display]) => {
                        dropdown.addOption(value, display);
                    }
                );
                dropdown.setValue(this.plugin.settings.initialView.desktop);
                dropdown.onChange(async (initialView) => {
                    this.plugin.settings.initialView.desktop = initialView;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Mobile Initial View")
            .setDesc("Choose the initial view range on mobile devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS.MOBILE).forEach(
                    ([value, display]) => {
                        dropdown.addOption(value, display);
                    }
                );
                dropdown.setValue(this.plugin.settings.initialView.mobile);
                dropdown.onChange(async (initialView) => {
                    this.plugin.settings.initialView.mobile = initialView;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Starting Day of the Week")
            .setDesc("Choose what day of the week to start.")
            .addDropdown((dropdown) => {
                WEEKDAYS.forEach((day, code) => {
                    dropdown.addOption(code.toString(), day);
                });
                dropdown.setValue(this.plugin.settings.firstDay.toString());
                dropdown.onChange(async (codeAsString) => {
                    this.plugin.settings.firstDay = Number(codeAsString);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("24-hour format")
            .setDesc("Display the time in a 24-hour format.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.timeFormat24h);
                toggle.onChange(async (val) => {
                    this.plugin.settings.timeFormat24h = val;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Row height (visual slot)")
            .setDesc(
                "Controls how tall each time row is in week/day views. Use larger values (e.g. 30 or 60) to keep the calendar compact."
            )
            .addDropdown((dropdown) => {
                const options: Record<string, string> = {
                    "5": "5 minutes",
                    "10": "10 minutes",
                    "15": "15 minutes",
                    "20": "20 minutes",
                    "30": "30 minutes",
                    "60": "1 hour",
                };
                Object.entries(options).forEach(([value, display]) => {
                    dropdown.addOption(value, display);
                });
                dropdown.setValue(
                    String(this.plugin.settings.slotMinutes ?? 30)
                );
                dropdown.onChange(async (value) => {
                    const parsed = Number.parseInt(value, 10);
                    this.plugin.settings.slotMinutes = Number.isFinite(parsed)
                        ? parsed
                        : 30;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Snap interval (drag & resize)")
            .setDesc(
                "Minimum increment when dragging or resizing events. Can be finer than the row height — e.g. 30-minute rows with 15-minute snap."
            )
            .addDropdown((dropdown) => {
                const options: Record<string, string> = {
                    "1": "1 minute",
                    "5": "5 minutes",
                    "10": "10 minutes",
                    "15": "15 minutes",
                    "20": "20 minutes",
                    "30": "30 minutes",
                    "60": "1 hour",
                };
                Object.entries(options).forEach(([value, display]) => {
                    dropdown.addOption(value, display);
                });
                dropdown.setValue(
                    String(this.plugin.settings.snapMinutes ?? 15)
                );
                dropdown.onChange(async (value) => {
                    const parsed = Number.parseInt(value, 10);
                    this.plugin.settings.snapMinutes = Number.isFinite(parsed)
                        ? parsed
                        : 15;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Click on a day in month view to create event")
            .setDesc("Switch off to open day view on click instead.")
            .addToggle((toggle) => {
                toggle.setValue(
                    this.plugin.settings.clickToCreateEventFromMonthView
                );
                toggle.onChange(async (val) => {
                    this.plugin.settings.clickToCreateEventFromMonthView = val;
                    await this.plugin.saveSettings();
                });
            });

        this.renderGoogleCredentialsSection(containerEl);

        containerEl.createEl("h2", { text: "Manage Calendars" });
        addCalendarButton(
            this.app,
            this.plugin,
            containerEl,
            async (source: CalendarInfo) => {
                sourceList.addSource(source);
            },
            () =>
                sourceList.state.sources
                    .map((s) => s.type === "local" && s.directory)
                    .filter((s): s is string => !!s)
        );

        const sourcesDiv = containerEl.createDiv();
        sourcesDiv.style.display = "block";
        let sourceList = ReactDOM.render(
            createElement(CalendarSettings, {
                sources: this.plugin.settings.calendarSources,
                submit: async (settings: CalendarInfo[]) => {
                    this.plugin.settings.calendarSources = settings;
                    await this.plugin.saveSettings();
                },
            }),
            sourcesDiv
        );
    }

    private renderGoogleCredentialsSection(containerEl: HTMLElement): void {
        containerEl.createEl("h2", { text: "Google Calendar" });

        const description = containerEl.createDiv({
            cls: "setting-item-description",
        });
        description.style.marginBottom = "0.75rem";
        description.createEl("p", {
            text: "Google Calendar sync requires your own OAuth credentials because Google classifies calendar access as a restricted scope. Each user must create a personal Google Cloud project — this takes about 5 minutes and is free.",
        });

        const details = containerEl.createEl("details");
        details.createEl("summary", {
            text: "Step-by-step setup (click to expand)",
        });
        const steps = details.createEl("ol");
        steps.style.paddingLeft = "1.5rem";
        steps.style.lineHeight = "1.6";

        const step = (html: string) => {
            const li = steps.createEl("li");
            li.innerHTML = html;
        };

        step(
            'Go to <a href="https://console.cloud.google.com/projectcreate" target="_blank">console.cloud.google.com</a> and create a new project (any name).'
        );
        step(
            'Open <b>APIs &amp; Services → Library</b>, search for <b>Google Calendar API</b>, and click <b>Enable</b>.'
        );
        step(
            'Open <b>APIs &amp; Services → OAuth consent screen</b>. Pick <b>External</b>, then fill in the required fields (app name, your email, developer email). You can leave everything else blank.'
        );
        step(
            'In the <b>Scopes</b> step, click <b>Add or remove scopes</b> and add <code>.../auth/calendar</code>. Save.'
        );
        step(
            'In the <b>Test users</b> step, add the Gmail account you want to sync. Save.'
        );
        step(
            'Open <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>. Choose <b>Desktop app</b> as the application type. Click Create.'
        );
        step(
            'Copy the <b>Client ID</b> and <b>Client secret</b> from the dialog into the two fields below.'
        );
        step(
            'Scroll down to <b>Manage Calendars</b>, pick <b>Google Calendar</b> from the dropdown and click <b>+</b>, then click <b>Connect</b>.'
        );

        const notes = details.createEl("div");
        notes.style.marginTop = "0.5rem";
        notes.createEl("p", {
            text: "Notes: while the project stays in Testing mode, Google refresh tokens expire every 7 days — you'll need to reconnect. Publishing to Production lets refresh tokens last indefinitely but requires Google's verification review.",
        });

        new Setting(containerEl)
            .setName("OAuth Client ID")
            .setDesc("Ends in .apps.googleusercontent.com")
            .addText((t) =>
                t
                    .setPlaceholder("123456789-xxxxxxx.apps.googleusercontent.com")
                    .setValue(this.plugin.settings.googleClientId)
                    .onChange(async (value) => {
                        this.plugin.settings.googleClientId = value.trim();
                        await this.plugin.saveData(this.plugin.settings);
                    })
            );

        new Setting(containerEl)
            .setName("OAuth Client Secret")
            .setDesc(
                "Stored in this vault's data.json. If you sync your vault to another device, the secret travels with it."
            )
            .addText((t) => {
                t.setPlaceholder("GOCSPX-…")
                    .setValue(this.plugin.settings.googleClientSecret)
                    .onChange(async (value) => {
                        this.plugin.settings.googleClientSecret = value.trim();
                        await this.plugin.saveData(this.plugin.settings);
                    });
                t.inputEl.type = "password";
            });

        new Setting(containerEl)
            .setName("Override default reminder")
            .setDesc(
                "When enabled, events created from this plugin ignore the Google Calendar default reminder and use the custom value below instead."
            )
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.googleOverrideReminder);
                toggle.onChange(async (val) => {
                    this.plugin.settings.googleOverrideReminder = val;
                    await this.plugin.saveData(this.plugin.settings);
                });
            });

        new Setting(containerEl)
            .setName("Reminder minutes before event")
            .setDesc(
                "How many minutes before the event a popup notification should fire. Only applies to events created or updated from this plugin; existing events in Google are not modified."
            )
            .addText((t) => {
                t.setPlaceholder("5")
                    .setValue(
                        String(this.plugin.settings.googleReminderMinutes)
                    )
                    .onChange(async (value) => {
                        const parsed = Number.parseInt(value, 10);
                        if (Number.isFinite(parsed) && parsed >= 0) {
                            this.plugin.settings.googleReminderMinutes = parsed;
                            await this.plugin.saveData(this.plugin.settings);
                        }
                    });
                t.inputEl.type = "number";
                t.inputEl.min = "0";
                t.inputEl.max = "40320";
            });
    }
}
