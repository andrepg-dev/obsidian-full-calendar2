import { App, TFile } from "obsidian";

/**
 * Embeds Obsidian's own markdown editor (the same CodeMirror-based Live
 * Preview surface used inside notes) into an arbitrary container, so the
 * event description is written and rendered in a single surface exactly like
 * Obsidian — no separate preview pane.
 *
 * Obsidian exposes no public API for this, so we resolve the internal editor
 * class through the embed registry. This is the community-standard technique
 * (originally by Fevol) used by many plugins. It touches undocumented
 * internals, so every access is guarded and callers should treat creation as
 * best-effort and fall back to a plain textarea if it throws.
 */

export interface MarkdownEditorProps {
    value: string;
    cls?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
}

export interface EmbeddedMarkdownEditor {
    getValue: () => string;
    setValue: (value: string) => void;
    focus: () => void;
    destroy: () => void;
}

let cachedEditorClass: any = null;

function resolveEditorClass(app: App): any {
    if (cachedEditorClass) return cachedEditorClass;
    const registry = (app as any).embedRegistry;
    const mdEmbedFactory = registry?.embedByExtension?.md;
    if (typeof mdEmbedFactory !== "function") {
        throw new Error("Obsidian markdown embed registry unavailable");
    }
    const widget = mdEmbedFactory(
        { app, containerEl: createDiv() },
        null as unknown as TFile,
        ""
    );
    widget.editable = true;
    widget.showEditor();
    cachedEditorClass = Object.getPrototypeOf(
        Object.getPrototypeOf(widget.editMode)
    ).constructor;
    widget.unload();
    if (!cachedEditorClass) {
        throw new Error("Could not resolve Obsidian markdown editor class");
    }
    return cachedEditorClass;
}

export function createEmbeddableMarkdownEditor(
    app: App,
    container: HTMLElement,
    props: MarkdownEditorProps
): EmbeddedMarkdownEditor {
    const BaseEditor = resolveEditorClass(app);

    class Embeddable extends BaseEditor {
        props: MarkdownEditorProps;

        constructor() {
            super(app, container, {
                app,
                onMarkdownScroll: () => {},
                getMode: () => "source",
            });
            this.props = props;

            // Seed initial content without stealing focus from the title.
            this.set(props.value || "", false);

            if (props.cls && this.editorEl) {
                this.editorEl.classList.add(props.cls);
            }
            if (props.placeholder && this.editorEl) {
                this.editorEl.setAttribute(
                    "data-placeholder",
                    props.placeholder
                );
            }
        }

        // Internal hook fired on every editor transaction.
        onUpdate(update: any, changed: boolean) {
            super.onUpdate?.(update, changed);
            if (changed) {
                this.props.onChange?.(this.getEditorValue());
            }
        }

        getEditorValue(): string {
            return this.editor?.getValue?.() ?? "";
        }
    }

    const instance = new Embeddable();

    return {
        getValue: () => instance.getEditorValue(),
        setValue: (value: string) => instance.set(value, false),
        focus: () => instance.editor?.focus?.(),
        destroy: () => instance.destroy?.(),
    };
}
