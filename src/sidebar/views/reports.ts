import { basename } from 'path';
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
import { DiagnosticReport } from '../../backend/types';

export interface IssueMetadata {
    entryIndex?: number | 'sticky';
    reprStep?: number;
    reprHasChildren?: boolean;
    description?: string;
    command?: Command;
}

export class ReportsView implements TreeDataProvider<IssueMetadata> {
    protected currentFile?: Uri;
    protected currentEntryList?: DiagnosticReport[];

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
        // Hide the report list when there's no metadata
        const metadataExists = ExtensionApi.metadata.metadata !== undefined;
        commands.executeCommand('setContext', 'codechecker.sidebar.showReports', metadataExists);

        const activeUri = window.activeTextEditor?.document.uri;

        // Handle Code's Output tab
        if (activeUri?.scheme === 'output') {
            // Only clear currentFile if it was closed
            if (window.visibleTextEditors.every((editor) => editor.document.uri.fsPath !== this.currentFile?.fsPath)) {
                this.currentFile = undefined;
            }
        } else {
            this.currentFile = activeUri;
        }

        // Clear tree on file close
        if (this.currentFile === undefined) {
            this.currentEntryList = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        this.currentEntryList = ExtensionApi.diagnostics.getFileDiagnostics(this.currentFile);
        this._onDidChangeTreeData.fire();
    }

    getChildren(element?: IssueMetadata): IssueMetadata[] | undefined {
        // Special case: No file selected
        if (!this.currentFile) {
            if (element === undefined) {
                return [{ description: 'No file selected' }];
            }

            return [];
        }

        // First level, report list
        if (element?.entryIndex === undefined) {
            const entryCount = this.currentEntryList?.length ?? 0;
            const reportsText = entryCount === 1
                ? '1 report'
                : `${entryCount === 0 ? 'No' : entryCount} reports`;

            const header: IssueMetadata[] = [
                { description: `${reportsText} found in file ${basename(this.currentFile!.fsPath)}` }
            ];

            let selectedHeader: IssueMetadata[] = [];

            if (ExtensionApi.diagnostics.selectedEntry) {
                selectedHeader = [
                    {
                        description: 'Hide active reproduction steps',
                        command: {
                            title: 'toggleSteps',
                            command: 'codechecker.editor.toggleSteps',
                            arguments: [this.currentFile, -1, false]
                        }
                    }
                ];
            }

            const stickyHeader: IssueMetadata[] = [
                { description: '——' },
                { description: 'Active reproduction steps:' }
            ];

            const stickyItems: IssueMetadata[] = [];

            // When in the same file as the sticky, displays as part of In current file
            if (
                ExtensionApi.diagnostics.selectedEntry &&
                ExtensionApi.diagnostics.selectedEntry.position.file !== this.currentFile.fsPath) {
                stickyItems.push({ entryIndex: 'sticky' });
            }

            const currentHeader: IssueMetadata[] = [
                { description: '——' },
                { description: 'In the current file:' }
            ];

            const currentItems = this.currentEntryList!
                .map((entry, idx): [DiagnosticReport, number] => [entry, idx])
                .filter(([entry, _]) => entry.file.original_path === this.currentFile?.fsPath)
                .map(([_, entryIndex]) => { return { entryIndex }; });

            let sidebar = header.concat(selectedHeader);

            if (stickyItems.length > 0) {
                sidebar = sidebar.concat(stickyHeader, stickyItems);
            }

            if (currentItems.length > 0) {
                sidebar = sidebar.concat(currentHeader, currentItems);
            }

            return sidebar;
        }

        // Commands have no children
        if (element.description !== undefined || element.command !== undefined) {
            return [];
        }

        const entry = element.entryIndex === 'sticky'
            ? ExtensionApi.diagnostics.selectedEntry?.diagnostic
            : this.currentEntryList![element.entryIndex];

        // No children of sticky when there's no selected report
        if (entry === undefined) {
            return [];
        }

        const path = entry.bug_path_events
            .map((pathElem, idx) => { return { idx, pathElem }; });

        // Second level, reproduction steps
        if (element.reprStep === undefined) {
            const commands: IssueMetadata[] = [];

            // Sticky has a different indexing method
            if (element.entryIndex === 'sticky') {
                const { file, idx } = ExtensionApi.diagnostics.selectedEntry!.position;

                commands.push(
                    {
                        ...element,
                        description: 'Jump to report',
                        command: {
                            title: 'jumpToReport',
                            command: 'codechecker.editor.jumpToReport',
                            arguments: [file, idx, true]
                        }
                    },
                    {
                        ...element,
                        description: 'Hide reproduction steps',
                        command: {
                            title: 'toggleSteps',
                            command: 'codechecker.editor.toggleSteps',
                            arguments: [file, idx]
                        }
                    },
                    { ...element, description: '——' }
                );
            } else {
                const selectedPosition = ExtensionApi.diagnostics.selectedEntry?.position;
                const isActiveReport = selectedPosition?.idx === element.entryIndex;

                commands.push(
                    {
                        ...element,
                        description: 'Jump to report',
                        command: {
                            title: 'jumpToReport',
                            command: 'codechecker.editor.jumpToReport',
                            arguments: [this.currentFile, element.entryIndex, true]
                        }
                    },
                    {
                        ...element,
                        description: `${isActiveReport ? 'Hide' : 'Show'} reproduction steps`,
                        command: {
                            title: 'toggleSteps',
                            command: 'codechecker.editor.toggleSteps',
                            arguments: [this.currentFile, element.entryIndex]
                        }
                    },
                    { ...element, description: '——' }
                );
            }

            const items = path
                .map(({ idx }) => {
                    return {
                        ...element,
                        reprStep: idx
                    };
                });

            return commands.concat(items);
        }

        // Third level, no inner-depth children without depth data
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
        if (element.entryIndex === undefined) {
            console.error('Tried to add invalid node to CurrentFileReports tree:', element);
            return new TreeItem('Internal error - invalid node');
        }

        const currentReport = element.entryIndex === 'sticky'
            ? ExtensionApi.diagnostics.selectedEntry?.diagnostic
            : this.currentEntryList![element.entryIndex];

        // No children of sticky when there's no selected report
        if (currentReport === undefined) {
            return new TreeItem('Loading... - reload metadata if this does not disappear');
        }

        const isSticky = element.entryIndex === 'sticky' || (
            this.currentFile?.fsPath === ExtensionApi.diagnostics.selectedEntry?.position.file &&
            element.entryIndex === ExtensionApi.diagnostics.selectedEntry?.position.idx
        );

        const steps = currentReport.bug_path_events;

        // First level, report list
        if (element.reprStep === undefined) {
            const currentReportPath = currentReport.file.original_path;

            const fileDescription = currentReportPath === this.currentFile?.fsPath
                ? `[L${currentReport.line}]`
                : `[${basename(currentReportPath)}:${currentReport.line}]`;

            const item = new TreeItem(`${fileDescription} - ${currentReport.message} [${currentReport.checker_name}]`);
            item.collapsibleState = isSticky
                ? TreeItemCollapsibleState.Expanded
                : TreeItemCollapsibleState.Collapsed;
            item.description = `(${steps.length})`;

            if (currentReportPath !== this.currentFile?.fsPath) {
                item.tooltip = `Full path to file: ${currentReportPath}`;
            }

            return item;
        }

        // Second level, repr steps
        const currentStep = steps[element.reprStep];

        const currentStepFilePath = currentStep.file.original_path;
        const currentStepFileName = basename(currentStepFilePath);

        const item = new TreeItem(
            `${element.reprStep + 1}. [${currentStepFileName}:${currentStep.line}] - ${currentStep.message}`
        );
        item.tooltip = `Full path to file: ${currentStepFilePath}`;
        item.collapsibleState = TreeItemCollapsibleState.None;

        // Sticky has a different indexing method
        if (element.entryIndex === 'sticky') {
            const { file, idx } = ExtensionApi.diagnostics.selectedEntry!.position;

            item.command = {
                title: 'jumpToStep',
                command: 'codechecker.editor.jumpToStep',
                arguments: [file, idx, element.reprStep, true]
            };
        } else {
            item.command = {
                title: 'jumpToStep',
                command: 'codechecker.editor.jumpToStep',
                arguments: [this.currentFile, element.entryIndex, element.reprStep, true]
            };
        }

        return item;
    }
}