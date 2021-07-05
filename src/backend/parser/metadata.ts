import { TextDecoder } from 'util';
import { Uri, workspace } from 'vscode';
import { MetadataFile } from '../types';

// TODO: Interruptible
export async function parseMetadata(path: string): Promise<MetadataFile> {
    const rawFileContents = await workspace.fs.readFile(Uri.file(path));

    const fileContents = new TextDecoder('utf-8').decode(rawFileContents);

    return JSON.parse(fileContents) as MetadataFile;
}
