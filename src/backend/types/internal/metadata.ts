/* eslint-disable @typescript-eslint/naming-convention */

export module v1Types {
    export interface AnalyzerStats {
        version: string;

        failed: number;
        failed_sources: string[];
        successful: number;
    }

    export interface MetadataFile {
        timestamps: {begin: number, end: number};

        command: string[];
        versions: {[analyzerName: string]: string};

        working_directory: string;
        output_path: string;

        result_source_files: {[analysisPath: string]: string};
        analyzer_statistics: {[analyzerName: string]: AnalyzerStats};
        checkers: {
            [analyzerName: string]: {
                [checkerEnabled: string]: boolean
            }
        };

        action_num: number;
        skipped: number;
    }
}


