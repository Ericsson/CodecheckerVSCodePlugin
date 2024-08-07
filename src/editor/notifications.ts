import { Command, ConfigurationChangeEvent, ExtensionContext, commands, window, workspace } from 'vscode';
import { ExtensionApi } from '../backend';
import { ProcessStatus, ProcessStatusType, ProcessType, ScheduledProcess } from '../backend/executor';
import { SidebarContainer } from '../sidebar';
import { NotificationItem } from '../sidebar/views';

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

    constructor(ctx: ExtensionContext) {
        this.showTrayNotifications = workspace.getConfiguration('codechecker.editor')
            .get('enableNotifications') ?? true;

        ExtensionApi.executorManager.processStatusChange(this.onProcessStatusChange, this, ctx.subscriptions);
    }

    private activeNotifications = new Map<string, NotificationItem>();

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
            // When the constructor calls this function, the sidebar is not yet initialized
            SidebarContainer.notificationView?.addNotification(
                type, options.sidebarMessage ?? message, options.choices
            );
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

            const choiceCommand = options.choices?.find((command) => command.title === choice);
            if (choiceCommand !== undefined && choiceCommand.command !== '') {
                await commands.executeCommand(choiceCommand.command, ...(choiceCommand.arguments ?? []));
            }
            return choice;
        }

        return;
    }

    onProcessStatusChange([status, process]: [ProcessStatus, ScheduledProcess]) {
        // Only display sidebar entries for longer-running processes
        const processType = process.processParameters.processType ?? 'Other';
        const allowedProcessTypes: string[] = [ProcessType.analyze, ProcessType.log];

        if (!allowedProcessTypes.includes(processType)) {
            return;
        }

        const notification = this.activeNotifications.get(process.commandLine);
        if (notification === undefined && status.type !== ProcessStatusType.queued) {
            return;
        }

        const makeMessage = (message: string): Command => {
            return {
                title: `Process "${processType}" ${message}`,
                command: '',
                tooltip: `Full command line: ${process.commandLine}`
            };
        };

        const makeReason = (): (Command)[] => {
            if (!status.reason) {
                return [];
            }

            return [{
                title: `Reason: ${status.reason}`,
                command: 'codechecker.executor.showOutput',
                tooltip: `Reason: ${status.reason}\nSee the output log for full details`
            },
            {
                title: 'Show process logs',
                command: 'codechecker.executor.showOutput'
            }];
        };

        switch (status.type) {
        case ProcessStatusType.queued: {
            const newNotification = SidebarContainer.notificationView.addNotification(
                'browser', makeMessage('added to the process queue'), [
                    {
                        title: 'Run now',
                        command: 'codechecker.executor.forceRunProcess',
                        arguments: [process]
                    },
                    {
                        title: 'Remove from queue',
                        command: 'codechecker.executor.removeFromQueue',
                        arguments: [process]
                    }
                ]);
            this.activeNotifications.set(process.commandLine, newNotification);

            break;
        }
        case ProcessStatusType.running: {
            notification!.silentUpdate({ choices: [] });

            const newNotification = SidebarContainer.notificationView.addNotification(
                'browser', makeMessage('is running...'), [
                    {
                        title: 'Kill process',
                        command: 'codechecker.executor.stopCodeChecker'
                    },
                    {
                        title: 'Show process logs',
                        command: 'codechecker.executor.showOutput'
                    }
                ]);
            this.activeNotifications.set(process.commandLine, newNotification);

            break;
        }
        case ProcessStatusType.killed: {
            notification!.update({
                message: makeMessage('was killed'),
                choices: []
            });
            this.activeNotifications.delete(process.commandLine);

            break;
        }
        case ProcessStatusType.finished: {
            notification!.update({
                message: makeMessage('finished running'),
                choices: makeReason()
            });
            this.activeNotifications.delete(process.commandLine);

            break;
        }
        case ProcessStatusType.warning: {
            notification!.update({
                message: makeMessage('finished with warnings'),
                choices: makeReason()
            });
            this.activeNotifications.delete(process.commandLine);

            break;
        }
        case ProcessStatusType.errored: {
            notification!.update({
                message: makeMessage('finished with errors'),
                choices: makeReason()
            });
            this.activeNotifications.delete(process.commandLine);

            break;
        }
        case ProcessStatusType.removed: {
            notification!.update({
                message: makeMessage('removed from the process queue'),
                type: 'browser',
                choices: []
            });
            this.activeNotifications.delete(process.commandLine);

            break;
        }
        default: break;
        }
    }

    onConfigChanged(event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('codechecker.editor')) {
            this.showTrayNotifications = workspace.getConfiguration('codechecker.editor')
                .get('enableNotifications') ?? true;
        }
    }
}