import { TextDecoder } from 'util';
import { Uri, workspace } from 'vscode';
import { AnalyzerMetadata, CheckerMetadata, MetadataFile } from '../types';
import { v1Types } from '../types/internal/metadata';

export class MetadataParseError extends Error {
    public code: string;

    constructor(message: string) {
        super(message);

        this.code = 'UnsupportedVersion';
    }
}

// TODO: Interruptible
export async function parseMetadata(path: string): Promise<MetadataFile> {
    const rawFileContents = await workspace.fs.readFile(Uri.file(path));

    const fileContents = new TextDecoder('utf-8').decode(rawFileContents);

    let metadataFile = JSON.parse(fileContents);

    if (!metadataFile.version) {
        // Cherry-pick a test item
        if (!metadataFile.result_source_files) {
            throw new SyntaxError('required member not found');
        }

        // Convert v1 config files to v2
        const v1 = metadataFile as v1Types.MetadataFile;

        const v2Analyzers = Object.fromEntries(Object.entries(v1.analyzer_statistics)
            .map(([name, stats]) => {
                return [
                    name,
                    {
                        checkers: v1.checkers[name] || {},
                        analyzer_statistics: { // eslint-disable-line @typescript-eslint/naming-convention
                            successful_sources: [], // eslint-disable-line @typescript-eslint/naming-convention
                            ...stats
                        }
                    } as AnalyzerMetadata
                ];
            }));

        // FIXME: Define better types here
        const v2Metadata: any = {
            ...v1,

            // Add v2-only vars
            name: 'codechecker',
            version: v1.versions['codechecker'] || 'Unknown',
            analyzers: v2Analyzers
        } as CheckerMetadata;

        // Remove unused vars
        delete v2Metadata.versions;
        delete v2Metadata.analyzer_statistics; // eslint-disable-line @typescript-eslint/naming-convention
        delete v2Metadata.checkers;

        metadataFile = {
            version: 2,
            tools: [v2Metadata as CheckerMetadata]
        };
    } else if (metadataFile.version !== 2) {
        throw new MetadataParseError(`Version ${metadataFile.version} not supported`);
    }

    return metadataFile as MetadataFile;
}
