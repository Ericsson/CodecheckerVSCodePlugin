import { ConfigurationChangeEvent, ExtensionContext, window, workspace } from 'vscode';
import { SidebarContainer } from '../sidebar';

export enum NotificationType {
    information,
    warning,
    error
}

export interface NotificationOptions {
    showOnTray?: boolean | 'always' // always bypasses the 'Show notifications' setting
    choices?: string[]
    showOnSidebar?: boolean,
    sidebarMessage?: string, // Same as popup message if not defined
}

export class NotificationHandler {
    private defaultOptions: NotificationOptions = {
        showOnTray: true,
        choices: [],
        showOnSidebar: true,
    };

    private showTrayNotifications: boolean;

    constructor(_ctx: ExtensionContext) {
        this.showTrayNotifications = workspace.getConfiguration('codechecker.editor')
            .get('enableNotifications') ?? true;
    }

    public async showNotification(
        type: NotificationType, message: string, options?: NotificationOptions
    ): Promise<string | undefined> {
        options = {
            ...this.defaultOptions,
            ...(options ?? {})
        };

        if (options.showOnSidebar) {
            SidebarContainer.notificationView.addNotification(type, options.sidebarMessage ?? message);
        }

        if (options.showOnTray === 'always' || (options.showOnTray && this.showTrayNotifications)) {
            switch (type) {
            case NotificationType.information:
                return await window.showInformationMessage(message, ...options.choices!);
            case NotificationType.warning:
                return await window.showWarningMessage(message, ...options.choices!);
            case NotificationType.error:
                return await window.showErrorMessage(message, ...options.choices!);
            }
        }

        return;
    }

    onConfigChanged(event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('codechecker.editor')) {
            this.showTrayNotifications = workspace.getConfiguration('codechecker.editor')
                .get('enableNotifications') ?? true;
        }
    }
}