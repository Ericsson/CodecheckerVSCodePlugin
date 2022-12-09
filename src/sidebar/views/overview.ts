import {
    Command,
    Event,
    EventEmitter,
    ExtensionContext,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeView,
    window
} from 'vscode';
import { ExtensionApi } from '../../backend';
import { CheckerMetadata } from '../../backend/types';

export class OverviewItem {
    constructor(private label: string | (() => string), private iconPath?: string, private command?: Command) {}

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const label = typeof this.label === 'string' ? this.label : this.label();

        const node = new TreeItem(label);
        node.command = this.command;
        node.iconPath = this.iconPath ? new ThemeIcon(this.iconPath) : undefined;
        node.description = this.command?.tooltip;

        return node;
    }
}

export class OverviewView implements TreeDataProvider<OverviewItem> {
    private tree?: TreeView<OverviewItem>;

    private topItems: {[id: string]: OverviewItem[]} = {
        'loading': [
            new OverviewItem(
                'Loading overview, please wait...',
                'loading'
            )
        ],
        'notFound': [
            new OverviewItem(
                'CodeChecker is not run yet. Please use commands below to get started',
                'output-view-icon'
            )
        ],
        'normal': [
            new OverviewItem(
                () => `Total files analyzed: ${ExtensionApi.metadata.sourceFiles.size}`,
                'graph'
            ),
            new OverviewItem(
                () => `Last analysis run: ${
                    new Date(ExtensionApi.metadata.metadata!.timestamps.begin /* seconds */ * 1000).toLocaleString()
                }`,
                'watch'
            ),
            new OverviewItem(() => {
                // Time in seconds
                const beginTime = ExtensionApi.metadata.metadata!.timestamps.begin;
                const endTime = ExtensionApi.metadata.metadata!.timestamps.end;
                const interval = endTime - beginTime;

                const hours = Math.floor(interval/3600) % 60;
                const minutes = Math.floor(interval/60) % 60;
                const seconds = Math.floor(interval) % 60;
                const ms = Math.floor(interval * 1000) % 1000;

                if (hours > 0 || minutes > 0) {
                    // H:MM:SS s / M:SS s
                    const formattedMinutes = hours > 0 ? (`${hours}:${minutes.toString().padStart(2, '0')}`) : minutes;
                    return `Analysis duration: ${formattedMinutes}:${seconds.toString().padStart(2, '0')} s`;
                } else {
                    // S.fff s
                    return `Analysis duration: ${(seconds + ms / 1000).toFixed(3)} s`;
                }
            }, 'history'),
            new OverviewItem(() => `Used analyzers: ${
                Object.keys(ExtensionApi.metadata.metadata!.analyzers).join(', ')
            }`, 'tools'),
        ]
    };

    private bottomItems: {[id: string]: OverviewItem[]} = {
        'normal': [
            new OverviewItem(
                'Reload CodeChecker metadata',
                'debug-restart',
                {
                    title: 'reloadMetadata',
                    command: 'codechecker.backend.reloadMetadata',
                }
            ),
            new OverviewItem(
                'Re-analyze current file',
                'run',
                {
                    title: 'reloadMetadata',
                    command: 'codechecker.executor.analyzeCurrentFile',
                },
            ),
            new OverviewItem(
                'Re-analyze entire project',
                'run-all',
                {
                    title: 'reloadMetadata',
                    command: 'codechecker.executor.analyzeProject',
                }
            ),
            new OverviewItem(
                'Re-run CodeChecker log',
                'list-flat',
                {
                    title: 'runCodeCheckerLog',
                    command: 'codechecker.executor.runCodeCheckerLog'
                }
            ),
            new OverviewItem(
                'Preview CodeChecker log in terminal',
                'terminal',
                {
                    title: 'previewLogInTerminal',
                    command: 'codechecker.executor.previewLogInTerminal'
                }
            ),
            new OverviewItem(
                'Stop analysis',
                'debug-stop',
                {
                    title: 'stopAnalysis',
                    command: 'codechecker.executor.stopAnalysis',
                }
            ),
        ],
        'ccNotFound': [
            new OverviewItem(
                'Setup compilation database',
                'database',
                {
                    title: 'showSetupDialog',
                    command: 'codechecker.editor.showSetupDialog'
                }
            ),
            new OverviewItem('——'),
            new OverviewItem(
                'Reload CodeChecker metadata',
                'debug-restart',
                {
                    title: 'reloadMetadata',
                    command: 'codechecker.backend.reloadMetadata',
                }
            ),
            new OverviewItem(
                'Run CodeChecker log',
                'list-flat',
                {
                    title: 'runCodeCheckerLog',
                    command: 'codechecker.executor.runCodeCheckerLog'
                }
            ),
            new OverviewItem(
                'Preview CodeChecker log in terminal',
                'terminal',
                {
                    title: 'previewLogInTerminal',
                    command: 'codechecker.executor.previewLogInTerminal'
                }
            ),
        ]
    };

    private separator = [new OverviewItem('——')];

    private itemsList: OverviewItem[][];

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());
        ExtensionApi.metadata.metadataUpdated(this.updateStats, this, ctx.subscriptions);
        ExtensionApi.executorBridge.databaseLocationChanged(this.updateStats, this, ctx.subscriptions);

        this.itemsList = [this.topItems.loading];

        ctx.subscriptions.push(this.tree = window.createTreeView(
            'codechecker.views.overview',
            {
                treeDataProvider: this
            }
        ));

        this.init();
    }

    private init() {
        if (ExtensionApi.metadata.metadata) {
            this.updateStats(ExtensionApi.metadata.metadata);
        }
    }

    updateStats(_event?: CheckerMetadata | void) {
        const topItems = ExtensionApi.metadata.metadata !== undefined
            ? this.topItems.normal
            : this.topItems.notFound;

        const bottomItems = ExtensionApi.executorBridge.getCompileCommandsPath() !== undefined
            ? this.bottomItems.normal
            : this.bottomItems.ccNotFound;

        this.itemsList = [topItems, this.separator, bottomItems];

        this._onDidChangeTreeData.fire();
    }

    private _onDidChangeTreeData: EventEmitter<void>;
    public get onDidChangeTreeData(): Event<void> {
        return this._onDidChangeTreeData.event;
    }

    getChildren(element?: OverviewItem): OverviewItem[] {
        if (element !== undefined) {
            return [];
        }

        return this.itemsList.flat();
    }

    getTreeItem(item: OverviewItem): TreeItem | Promise<TreeItem> {
        return item.getTreeItem();
    }
}
