import * as React from "react";
import * as ReactDOM from "react-dom";
import { App, Modal } from "obsidian";

type RenderCallback = (
    close: () => void,
    setCloseRequestHandler: (handler?: () => void) => void
) => Promise<ReturnType<typeof React.createElement>>;
export default class ReactModal<Props, Component> extends Modal {
    onOpenCallback: RenderCallback;
    closeRequestHandler?: () => void;
    forceClosing = false;

    constructor(app: App, onOpenCallback: RenderCallback) {
        super(app);
        this.onOpenCallback = onOpenCallback;
    }

    async onOpen() {
        const { contentEl } = this;
        ReactDOM.render(
            await this.onOpenCallback(
                () => this.closeWithoutRequestHandler(),
                (handler) => {
                    this.closeRequestHandler = handler;
                }
            ),
            contentEl
        );
    }

    closeWithoutRequestHandler() {
        this.forceClosing = true;
        this.close();
    }

    close() {
        if (!this.forceClosing && this.closeRequestHandler) {
            this.closeRequestHandler();
            return;
        }
        super.close();
    }

    onClose() {
        const { contentEl } = this;
        this.closeRequestHandler = undefined;
        this.forceClosing = false;
        ReactDOM.unmountComponentAtNode(contentEl);
    }
}
