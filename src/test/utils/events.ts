import { Event } from 'vscode';
import { openDocument } from './files';

/** Waits for a single event. */
export function waitForEvent<T>(event: Event<T>): Promise<T> {
    return new Promise<T>((resolve, _reject) => {
        const disposable = event((param: T) => {
            disposable.dispose();
            // 0-long timeout to make sure all other listeners of the same event already executed
            setTimeout(() => resolve(param), 0);
        });
    });
};

/** Waits for a single event. */
export async function wrapWithEvent<T>(event: Event<T>, command: () => Promise<void>): Promise<T> {
    const listener = waitForEvent(event);
    await command();
    return await listener;
};

export async function openFileWithEvent<T>(event: Event<T>, file: string): Promise<T> {
    return await wrapWithEvent(event, async () => await openDocument(file));
}
