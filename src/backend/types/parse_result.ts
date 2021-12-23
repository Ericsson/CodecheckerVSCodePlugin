/* eslint-disable @typescript-eslint/naming-convention */

/** Should be kept in sync with the official documentation of the 'CodeChecker parse' JSON output:
 * https://github.com/Ericsson/codechecker/blob/master/docs/analyzer/user_guide.md#json-format-of-codechecker-parse
 */

export type DiagnosticFile = Readonly<{
    id: string;
    path: string;
    original_path: string;
}>;

export type DiagnosticRange = Readonly<{
    start_line: number;
    start_col: number;
    end_line: number;
    end_col: number;
}>;

export type DiagnosticComment = Readonly<{
    checkers: readonly string[];
    message: string;
    status: string;
    line: string;
}>;

export type DiagnosticPathEvent = Readonly<{
    file: DiagnosticFile;
    line: number;
    column: number;

    range?: DiagnosticRange;

    message: string;
}>;

export type DiagnosticPathPosition = Readonly<{
    file: DiagnosticFile;
    range: DiagnosticRange;
}>;

export type DiagnosticMacroExpansion = Readonly<{
    name: string;
    file: DiagnosticFile;
    line: number;
    column: number;
    message: string;
    range: DiagnosticRange;
}>;

export type DiagnosticReport = Readonly<{
    analyzer_result_file_path: string;

    file: DiagnosticFile;
    line: number;
    column: number;

    message: string;
    category?: string;

    analyzer_name?: string;
    checker_name: string;

    report_hash?: string;
    type?: string;

    severity?: string;
    review_status: string;

    source_code_comments: readonly DiagnosticComment[];

    bug_path_events: readonly DiagnosticPathEvent[];
    bug_path_positions: readonly DiagnosticPathPosition[];

    notes: DiagnosticPathEvent[];

    macro_expansions: readonly DiagnosticMacroExpansion[];
}>;

export type ParseResult = Readonly<{
    version: 1;
    reports: readonly DiagnosticReport[];
}>;