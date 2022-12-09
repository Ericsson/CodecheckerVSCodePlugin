import { Command, ConfigurationChangeEvent, ExtensionContext, commands, window, workspace } from 'vscode';
import { SidebarContainer } from '../sidebar';

export enum NotificationType {
    information,
    warning,
    error
}

export interface NotificationOptions {
    showOnTray?: boolean | 'always' // always bypasses the 'Show notifications' setting
    choices?: Command[]
    showOnSidebar?: boolean,
    sidebarMessage?: string, // Same as popup message if not defined
}

export class NotificationHandler {
    private defaultOptions: NotificationOptions = {
        showOnTray: true,
        showOnSidebar: true,
    };

    private showTrayNotifications: boolean;

    constructor(_ctx: ExtensionContext) {
        this.showTrayNotifications = workspace.getConfiguration('codechecker.editor')
            .get('enableNotifications') ?? true;
    }

    // When a command option is clicked, the provided command in `options.choices` gets executed.
    // If the tray notification was clicked, the choice is returned as well.
    public async showNotification(
        type: NotificationType, message: string, options?: NotificationOptions
    ): Promise<string | undefined> {
        options = {
            ...this.defaultOptions,
            ...(options ?? {})
        };

        if (options.showOnSidebar) {
            SidebarContainer.notificationView.addNotification(type, options.sidebarMessage ?? message, options.choices);
        }

        if (options.showOnTray === 'always' || (options.showOnTray && this.showTrayNotifications)) {
            const choiceTitles = options.choices?.map((command) => command.title) ?? [];
            let choice: string | undefined;

            switch (type) {
            case NotificationType.information:
                choice = await window.showInformationMessage(message, ...choiceTitles);
                break;
            case NotificationType.warning:
                choice = await window.showWarningMessage(message, ...choiceTitles);
                break;
            case NotificationType.error:
                choice = await window.showErrorMessage(message, ...choiceTitles);
                break;
            }

            const choiceCommand = options.choices!.find((command) => command.title === choice);
            if (choiceCommand !== undefined && choiceCommand.command !== '') {
                await commands.executeCommand(choiceCommand.command, ...(choiceCommand.arguments ?? []));
            }
            return choice;
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