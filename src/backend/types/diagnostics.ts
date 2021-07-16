/* eslint-disable @typescript-eslint/naming-convention */
export interface AnalysisLocation {
    readonly line: number;
    readonly file: number;
    readonly col: number;
}

export type AnalysisRange = [AnalysisLocation, AnalysisLocation];

export interface AnalysisNoteEntry {
    readonly location: AnalysisLocation;
    readonly ranges?: AnalysisRange[];
    readonly message: string;
    readonly extended_message: string;
}

export enum AnalysisPathKind {
    Event = 'event',
    Control = 'control'
}

export interface AnalysisPathEntry {
    readonly kind: AnalysisPathKind;
}

export interface AnalysisPathEvent extends AnalysisPathEntry, AnalysisNoteEntry {
    readonly kind: AnalysisPathKind.Event;
    readonly depth: number;
}

export interface AnalysisPathControl extends AnalysisPathEntry {
    readonly kind: AnalysisPathKind.Control;
    readonly edges: {
        readonly start: AnalysisLocation[],
        readonly end: AnalysisLocation[]
    }
}

export interface AnalysisMacroExpansion {
    readonly location: AnalysisLocation;
    readonly name: string;
    readonly expansion: string;
}

export interface DiagnosticEntry {
    readonly files: string[];
    readonly location: AnalysisLocation;
    readonly notes: AnalysisNoteEntry[];
    readonly path: AnalysisPathEntry[];
    readonly macro_expansions?: AnalysisMacroExpansion[];

    readonly description: string;
    readonly category: string;
    readonly type: string;
    readonly check_name: string;

    readonly issue_hash_content_of_line_in_context: string;
    readonly issue_content_kind: string;
    readonly issue_hash_function_offset: string;
}

export interface DiagnosticFile {
    readonly diagnostics: DiagnosticEntry[];
    readonly files: string[];
}
