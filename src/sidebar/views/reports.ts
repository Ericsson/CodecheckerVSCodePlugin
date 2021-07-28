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
import { AnalysisPathEvent, AnalysisPathKind, DiagnosticEntry } from '../../backend/types';

export interface IssueMetadata {
    entryIndex?: number;
    reprStep?: number;
    reprHasChildren?: boolean;
    description?: string;
    command?: Command;
}

export class ReportsView implements TreeDataProvider<IssueMetadata> {
    protected currentFile?: Uri;
    protected currentEntryList?: DiagnosticEntry[];

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
        if (!ExtensionApi.metadata.metadata) {
            commands.executeCommand('setContext', 'codechecker.sidebar.showReports', false);
        }

        this.currentFile = window.activeTextEditor?.document.uri;

        // Clear tree on file close
        if (this.currentFile === undefined) {
            this.currentEntryList = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        this.currentEntryList = ExtensionApi.diagnostics.getFileDiagnostics(this.currentFile);
        this._onDidChangeTreeData.fire();

        commands.executeCommand('setContext', 'codechecker.sidebar.showReports', true);
    }

    getChildren(element?: IssueMetadata): IssueMetadata[] | undefined {
        const makeArray = <T>(length: number, func: (idx: number) => T): T[] => {
            return Array.from(Array(length), (_, idx) => func(idx));
        };

        // Special case: No reports in current file
        if ((this.currentEntryList?.length ?? 0) === 0) {
            if (element === undefined) {
                return [{ description: 'No reports found in file' }];
            }

            return [];
        }

        // First level, report list
        if (element?.entryIndex === undefined) {
            const header: IssueMetadata[] = [
                { description: this.currentEntryList!.length + ' reports found in file' }
            ];

            const currentHeader: IssueMetadata[] = [
                { description: '——' },
                { description: 'In the current file:' }
            ];

            const currentItems = this.currentEntryList!
                .map((entry, idx): [DiagnosticEntry, number] => [entry, idx])
                .filter(([entry, _]) => entry.files[entry.location.file] === this.currentFile?.fsPath)
                .map(([_, entryIndex]) => { return { entryIndex }; });

            const relatedHeader: IssueMetadata[] = [
                { description: '——' },
                { description: 'In related files:' }
            ];

            const relatedItems = this.currentEntryList!
                .map((entry, idx): [DiagnosticEntry, number] => [entry, idx])
                .filter(([entry, _]) => entry.files[entry.location.file] !== this.currentFile?.fsPath)
                .map(([_, entryIndex]) => { return { entryIndex }; });

            return header
                .concat(currentHeader)
                .concat(currentItems)
                .concat(relatedHeader)
                .concat(relatedItems);
        }

        // Commands have no children
        if (element.description !== undefined || element.command !== undefined) {
            return [];
        }

        const path = this.currentEntryList![element.entryIndex].path
            .filter(pathElem => pathElem.kind === AnalysisPathKind.Event)
            .map((pathElem, idx) => { return { idx, pathElem: pathElem as AnalysisPathEvent }; });

        // Second level, reproduction steps
        if (element.reprStep === undefined) {
            const commands: IssueMetadata[] = [
                {
                    ...element,
                    description: 'Jump to report (no-op.)',
                    command: {
                        title: 'jumpToReport',
                        command: 'codechecker.editor.jumpToReport',
                        arguments: [this.currentFile, element.entryIndex, true]
                    }
                },
                { ...element, description: '——' }
            ];

            const items = path
                .filter(({ pathElem }) => pathElem.depth === 0)
                .map(({ idx }) => {
                    return {
                        ...element,
                        reprStep: idx
                    };
                });

            return commands.concat(items);
        }

        // Third level, children of reproduction steps
        // There are inner-depth children
        if (
            path[element.reprStep + 1] &&
            path[element.reprStep + 1].pathElem.depth > path[element.reprStep].pathElem.depth
        ) {
            const children = path.slice(element.reprStep + 1);

            const startingDepth = path[element.reprStep].pathElem.depth;
            const childDepth = path[element.reprStep + 1].pathElem.depth;

            const sameLevelIdx = children.findIndex(({ pathElem }) => pathElem.depth <= startingDepth);

            const items = children.slice(0, sameLevelIdx)
                .filter(({ pathElem }) => pathElem.depth <= childDepth)
                .map(({ idx }) => {
                    return {
                        ...element,
                        reprStep: idx
                    };
                });

            return items;
        }

        // Third level, no inner-depth children
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

        // First level, report list
        if (element.reprStep === undefined) {
            const currentBug = this.currentEntryList![element.entryIndex];
            const currentBugPath = currentBug.files[currentBug.location.file];

            const fileDescription = currentBugPath === this.currentFile?.fsPath
                ? `[L${currentBug.location.line}]`
                : `[${basename(currentBugPath)}:${currentBug.location.line}]`;

            const item = new TreeItem(`${fileDescription} - ${currentBug.description}`);
            item.collapsibleState = TreeItemCollapsibleState.Collapsed;
            item.description = `(${currentBug.path.length})`;

            if (currentBugPath !== this.currentFile?.fsPath) {
                item.tooltip = `Full path to file: ${currentBugPath}`;
            }

            return item;
        }

        // Second level, repr steps
        const currentBug = this.currentEntryList![element.entryIndex];
        const steps = currentBug.path
            .filter(pathElem => pathElem.kind === AnalysisPathKind.Event) as AnalysisPathEvent[];
        const currentStep = steps[element.reprStep];

        const stepHasChildren = steps[element.reprStep + 1] && currentStep.depth < steps[element.reprStep + 1].depth;
        const currentStepPath = currentBug.files[currentStep.location.file];
        const currentStepFile = basename(currentStepPath);

        const item = new TreeItem(
            `${element.reprStep + 1}. [${currentStepFile}:${currentStep.location.line}] - ${currentStep.message}`
        );
        item.tooltip = `${currentStep.extended_message}\nFull path to file: ${currentStepPath}`;
        item.collapsibleState = stepHasChildren ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None;
        item.command = {
            title: 'jumpToStep',
            command: 'codechecker.editor.jumpToStep',
            arguments: [this.currentFile, element.entryIndex, element.reprStep, true]
        };

        return item;
    }
}