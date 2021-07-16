import {
    Command,
    Event,
    EventEmitter,
    ExtensionContext,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    Uri,
    commands,
    window
} from 'vscode';
import { ExtensionApi } from '../../backend/api';
import { AnalysisPathEvent, AnalysisPathKind, DiagnosticEntry } from '../../backend/types';

export interface IssueMetadata {
    bugIndex?: number;
    reprStep?: number;
    description?: string;
    command?: Command;
}

export class ReportsView implements TreeDataProvider<IssueMetadata> {
    protected currentFile?: Uri;
    protected currentBugList?: DiagnosticEntry[];

    protected tree?: TreeView<IssueMetadata>;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());
        window.onDidChangeActiveTextEditor(this.refreshBugList, this, ctx.subscriptions);
        ExtensionApi.diagnostics.diagnosticsUpdated(this.refreshBugList, this, ctx.subscriptions);

        ctx.subscriptions.push(this.tree = window.createTreeView(
            'codechecker.views.reports',
            { treeDataProvider: this }
        ));

        this.init();
    }

    protected init() {
        this.currentFile = window.activeTextEditor?.document.uri;
    }

    private _onDidChangeTreeData: EventEmitter<void>;
    public get onDidChangeTreeData(): Event<void> {
        return this._onDidChangeTreeData.event;
    }

    refreshBugList() {
        // Hide the bug list when there's no metadata
        if (!ExtensionApi.metadata.metadata) {
            commands.executeCommand('setContext', 'codechecker.sidebar.showReports', false);
        }

        this.currentFile = window.activeTextEditor?.document.uri;

        // Clear tree on file close
        if (this.currentFile === undefined) {
            this.currentBugList = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        this.currentBugList = ExtensionApi.diagnostics.getFileDiagnostics(this.currentFile);
        this._onDidChangeTreeData.fire();

        commands.executeCommand('setContext', 'codechecker.sidebar.showReports', true);
    }

    getChildren(element?: IssueMetadata): IssueMetadata[] | undefined {
        const makeArray = <T>(length: number, func: (idx: number) => T): T[] => {
            return Array.from(Array(length), (_, idx) => func(idx));
        };

        // Special case: No reports in current file
        if ((this.currentBugList?.length ?? 0) === 0) {
            if (element === undefined) {
                return [{ description: 'No reports found in file' }];
            }

            return [];
        }

        // First level, bug list
        if (element?.bugIndex === undefined) {
            const commands: IssueMetadata[] = [
                { description: this.currentBugList!.length + ' reports found in file' },
                { description: '——' }
            ];

            const items = makeArray(this.currentBugList!.length, (idx): IssueMetadata => { 
                return { bugIndex: idx };
            });

            return commands.concat(items);
        }

        // Commands have no children
        if (element.description !== undefined || element.command !== undefined) {
            return [];
        }

        // Second level, reproduction steps
        if (element.reprStep === undefined) {
            const commands: IssueMetadata[] = [
                {
                    ...element,
                    description: 'Jump to bug (no-op.)',
                    command: {
                        title: 'jumpToBug',
                        command: 'codechecker.editor.jumpToBug',
                        arguments: [this.currentFile, element.bugIndex, true]
                    }
                },
                { ...element, description: '——' }
            ];

            const items = makeArray(
                this.currentBugList![element.bugIndex].path
                    .filter(pathElem => pathElem.kind === AnalysisPathKind.Event).length,
                (idx) => {
                    return { ...element, reprStep: idx };
                }
            );

            return commands.concat(items);
        }

        // Third level, children of reproduction steps
        return [];
    }

    getTreeItem(element: IssueMetadata): TreeItem | Thenable<TreeItem> {
        // Command nodes
        if (element.command !== undefined) {
            const item = new TreeItem(element.description ?? element.command.title);
            item.command = element.command;
            return item;
        }

        // Description nodes, also handles special case with no reports
        if (element.description !== undefined) {
            return new TreeItem(element.description);
        }

        // Invalid nodes, detect early
        if (element.bugIndex === undefined) {
            console.error('Tried to add invalid node to CurrentFileReports tree:', element);
            return new TreeItem('Internal error - invalid node');
        }

        // First level, bug list
        if (element.reprStep === undefined) {
            const currentBug = this.currentBugList![element.bugIndex];

            const item = new TreeItem(currentBug.description);
            item.collapsibleState = TreeItemCollapsibleState.Collapsed;

            return item;
        }

        // Second level, repr steps
        const currentBug = this.currentBugList![element.bugIndex];
        const currentStep = currentBug.path
            .filter(pathElem => pathElem.kind === AnalysisPathKind.Event)[element.reprStep!] as AnalysisPathEvent;

        const item = new TreeItem(currentStep.message);
        item.tooltip = currentStep.extended_message;
        item.command = {
            title: 'jumpToStep',
            command: 'codechecker.editor.jumpToStep',
            arguments: [this.currentFile, element.bugIndex, element.reprStep, true]
        };

        return item;
    }
}