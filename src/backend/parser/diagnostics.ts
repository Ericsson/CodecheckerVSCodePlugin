import * as FastPlist from 'fast-plist';
import { TextDecoder } from 'util';
import { Uri, workspace } from 'vscode';
import { DiagnosticFile } from '../types';

export async function parseDiagnostics(path: string): Promise<DiagnosticFile> {

    const rawFileContents = await workspace.fs.readFile(Uri.file(path));
    const fileContents = new TextDecoder('utf-8').decode(rawFileContents);
    const parsedContents = FastPlist.parse(fileContents);

    // Use the files.
    for (const diagnostic of parsedContents.diagnostics) {
        diagnostic.files = parsedContents.files;
    }

    return parsedContents as DiagnosticFile;
}
