import {
    Command,
    Event,
    EventEmitter,
    ExtensionContext,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    commands,
    window
} from 'vscode';
import { ExtensionApi } from '../../backend';
import { CheckerMetadata } from '../../backend/types';
import { NotificationType } from '../../editor/notifications';

export class NotificationItem {
    constructor(
        private label: string | (() => string), private iconPath?: string,
        private command?: Command, private hasChildren: boolean = false
    ) {}

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const label = typeof this.label === 'string' ? this.label : this.label();

        const node = new TreeItem(
            label,
            this.hasChildren ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
        );
        node.command = this.command;
        node.iconPath = this.iconPath ? new ThemeIcon(this.iconPath) : undefined;
        node.description = this.command?.tooltip;

        return node;
    }
}


export class NotificationView implements TreeDataProvider<NotificationItem> {
    private tree?: TreeView<NotificationItem>;
    private notificationIcons: {[type in NotificationType]: string} = {
        [NotificationType.information]: 'info',
        [NotificationType.warning]: 'warning',
        [NotificationType.error]: 'error'
    };

    private topItems: {[id: string]: NotificationItem[]} = {
        'default': [
            new NotificationItem(
                'Clear notifications',
                'clear-all',
                { title: 'clearNotifications', command: 'codechecker.sidebar.clearNotifications' }
            ),
            new NotificationItem('——')
        ],
        'noNotifications': [
            new NotificationItem(
                'No recent notifications',
                'list-flat'
            )
        ]
    };

    private notifications: { notification: NotificationItem, commands: NotificationItem[] }[] = [];

    private itemsList: NotificationItem[][];

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());

        this.itemsList = [this.topItems.noNotifications];

        ctx.subscriptions.push(this.tree = window.createTreeView(
            'codechecker.views.notifications',
            {
                treeDataProvider: this
            }
        ));

        ctx.subscriptions.push(
            commands.registerCommand('codechecker.sidebar.clearNotifications', this.clearNotifications, this)
        );

        this.init();
    }

    private init() {
        if (ExtensionApi.metadata.metadata) {
            this.updateNotifications(ExtensionApi.metadata.metadata);
        }
    }

    updateNotifications(_event?: CheckerMetadata | void) {
        if (this.notifications.length !== 0) {
            this.itemsList = [this.topItems.default, this.notifications.map((x) => x.notification)];
        } else {
            this.itemsList = [this.topItems.noNotifications];
        }

        this._onDidChangeTreeData.fire();
    }

    addNotification(type: NotificationType, message: string, choices?: Command[]) {
        const notification = new NotificationItem(
            message,
            this.notificationIcons[type],
            undefined,
            choices !== undefined
        );

        // TODO: Allow specifying icons for every command
        const commands = choices?.map(
            (command) => new NotificationItem(command.title, undefined, command)
        ) ?? [];

        this.notifications.unshift({ notification, commands });
        this.updateNotifications();
    }

    clearNotifications() {
        this.notifications = [];
        this.updateNotifications();
    }

    private _onDidChangeTreeData: EventEmitter<void>;
    public get onDidChangeTreeData(): Event<void> {
        return this._onDidChangeTreeData.event;
    }

    getChildren(element?: NotificationItem): NotificationItem[] {
        if (element !== undefined) {
            return this.notifications.find((notif) => notif.notification === element)?.commands ?? [];
        }

        return this.itemsList.flat();
    }

    getTreeItem(item: NotificationItem): TreeItem | Promise<TreeItem> {
        return item.getTreeItem();
    }
}
