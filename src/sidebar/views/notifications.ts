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

export interface NotificationUpdateArgs {
    type?: NotificationType | string,
    message?: string | Command,
    choices?: Command[] | NotificationItem[]
}

export class NotificationItem {
    private label: string = '';
    private iconPath?: string;
    private command?: Command;
    private _children: NotificationItem[] = [];
    public get children(): readonly NotificationItem[] { return this._children; };

    private notificationIcons: {[type in NotificationType]: string} = {
        [NotificationType.information]: 'info',
        [NotificationType.warning]: 'warning',
        [NotificationType.error]: 'error'
    };

    constructor(
        private view: NotificationView, type: NotificationType | string,
        message: string | Command, choices?: Command[] | NotificationItem[]
    ) {
        this.silentUpdate({ type, message, choices });
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const node = new TreeItem(
            this.label,
            this.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
        );

        if (this.command?.command) {
            node.command = this.command;
        }
        node.iconPath = this.iconPath ? new ThemeIcon(this.iconPath) : undefined;
        node.tooltip = this.command?.tooltip;

        return node;
    }

    update(args: NotificationUpdateArgs) {
        this.silentUpdate(args);

        this.view.updateNotifications();
    }

    silentUpdate(args: NotificationUpdateArgs) {
        const { type, message, choices } = args;

        if (type !== undefined) {
            this.iconPath = typeof type === 'string' ? type : this.notificationIcons[type];
        }

        if (message !== undefined) {
            if (typeof message === 'object') {
                this.label = message.title;
                this.command = message;
            } else {
                this.label = message;
                this.command = undefined;
            }
        }

        if (choices !== undefined) {
            if (choices.length === 0 || choices[0] instanceof NotificationItem) {
                this._children = [ ...choices as NotificationItem[] ];
            } else {
                this._children = (choices as Command[]).map(choice => new NotificationItem(this.view, '', choice));
            }

            if (this.command) {
                this.command.command = '';
            }
        }
    }
}

export class NotificationView implements TreeDataProvider<NotificationItem> {
    private tree?: TreeView<NotificationItem>;

    private topItems: {[id: string]: NotificationItem[]} = {
        'default': [
            new NotificationItem(
                this,
                'clear-all',
                { title: 'Clear notifications', command: 'codechecker.sidebar.clearNotifications' }
            ),
            new NotificationItem(this, '', '——')
        ],
        'noNotifications': [
            new NotificationItem(this, 'list-flat', 'No recent notifications')
        ]
    };

    private notifications: NotificationItem[] = [];

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
            this.itemsList = [this.topItems.default, this.notifications];
        } else {
            this.itemsList = [this.topItems.noNotifications];
        }

        this._onDidChangeTreeData.fire();
    }

    // Adds either a pre-made notification to the sidebar, or creates one.
    addNotification(
        type: NotificationItem | NotificationType | string, message?: string | Command,
        choices?: Command[] | NotificationItem[]
    ): NotificationItem {
        if (!(type instanceof NotificationItem)) {
            type = new NotificationItem(this, type, message ?? '', choices);
        }

        this.notifications.unshift(type);
        this.updateNotifications();

        return type;
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
            return [ ...element.children ?? [] ];
        }

        return this.itemsList.flat();
    }

    getTreeItem(item: NotificationItem): TreeItem | Promise<TreeItem> {
        return item.getTreeItem();
    }
}
