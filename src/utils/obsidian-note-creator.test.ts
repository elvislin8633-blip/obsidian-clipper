import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import browser from './browser-polyfill';
import { generalSettings } from './storage-utils';
import { saveToObsidian } from './obsidian-note-creator';
import { ObsidianAdapter } from '../capture/adapters/obsidian';
import type { CaptureEnvelope } from '../capture/contracts';

const originalSendMessage = browser.runtime.sendMessage;
const originalLegacyMode = generalSettings.legacyMode;
const originalSilentOpen = generalSettings.silentOpen;

const envelope: CaptureEnvelope = {
	schemaVersion: 1,
	payload: {
		fileContent: '# Example note',
		noteName: 'Example note',
		path: 'Inbox',
		behavior: 'create',
		vault: 'Personal',
		templateId: 'test-template',
	},
	context: {
		captureId: 'capture-obsidian-note-creator-test',
		capturedAt: '2026-09-11T00:00:00.000Z',
		intent: 'reference',
		source: {
			url: 'https://example.com/article',
			title: 'Example note',
		},
	},
	destination: 'obsidian',
	metadata: {
		capture_id: 'capture-obsidian-note-creator-test',
		capture_intent: 'reference',
		capture_destination: 'obsidian',
		capture_captured_at: '2026-09-11T00:00:00.000Z',
	},
};

function setSendMessage(sendMessage: unknown): void {
	browser.runtime.sendMessage = sendMessage as typeof browser.runtime.sendMessage;
}

function setClipboardWrite(writeText: unknown): void {
	vi.stubGlobal('navigator', {
		clipboard: { writeText },
	});
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	generalSettings.legacyMode = false;
	generalSettings.silentOpen = false;
	setClipboardWrite(vi.fn(async () => undefined));
});

afterEach(() => {
	browser.runtime.sendMessage = originalSendMessage;
	generalSettings.legacyMode = originalLegacyMode;
	generalSettings.silentOpen = originalSilentOpen;
	vi.unstubAllGlobals();
});

describe('saveToObsidian', () => {
	test('preserves legacy URI delivery and waits for confirmation', async () => {
		generalSettings.legacyMode = true;
		const sendMessage = vi.fn(async () => ({ success: true }));
		setSendMessage(sendMessage);

		await saveToObsidian('Legacy content', 'Legacy note', 'Inbox', 'Personal', 'create');

		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledWith({
			action: 'openObsidianUrl',
			url: 'obsidian://new?file=Inbox%2FLegacy%20note&vault=Personal&content=Legacy%20content',
		});
	});

	test('waits for a confirmed clipboard handoff before resolving', async () => {
		const handoff = deferred<{ success: boolean }>();
		const sendMessage = vi.fn(() => handoff.promise);
		setSendMessage(sendMessage);
		let settled = false;

		const savePromise = saveToObsidian('Clipboard content', 'Clipboard note', 'Inbox', 'Personal', 'create')
			.then(() => {
				settled = true;
			});

		await new Promise<void>(resolve => setTimeout(resolve, 0));
		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledWith({
			action: 'openObsidianUrl',
			url: expect.stringMatching(/^obsidian:\/\/new\?file=Inbox%2FClipboard%20note&vault=Personal&clipboard&content=/),
		});
		expect(settled).toBe(false);

		handoff.resolve({ success: true });
		await savePromise;
		expect(settled).toBe(true);
	});

	test('uses the URI content fallback when clipboard delivery is unavailable', async () => {
		setClipboardWrite(vi.fn(async () => {
			throw new Error('clipboard blocked');
		}));
		const sendMessage = vi.fn()
			.mockResolvedValueOnce({ success: false, error: 'content script unavailable' })
			.mockResolvedValueOnce({ success: true });
		setSendMessage(sendMessage);

		await saveToObsidian('Fallback content', 'Fallback note', 'Inbox', '', 'create');

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(sendMessage).toHaveBeenNthCalledWith(1, {
			action: 'copy-to-clipboard',
			text: 'Fallback content',
		});
		expect(sendMessage).toHaveBeenNthCalledWith(2, {
			action: 'openObsidianUrl',
			url: 'obsidian://new?file=Inbox%2FFallback%20note&content=Fallback%20content',
		});
	});

	test('rejects a negative handoff response without retrying', async () => {
		generalSettings.legacyMode = true;
		const sendMessage = vi.fn(async () => ({ success: false, error: 'No active tab found' }));
		setSendMessage(sendMessage);

		await expect(saveToObsidian('Unsent content', 'Unsent note', 'Inbox', '', 'create'))
			.rejects.toThrow('No active tab found');
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});

	test('propagates a handoff rejection without retrying', async () => {
		generalSettings.legacyMode = true;
		const failure = new Error('background unavailable');
		const sendMessage = vi.fn(async () => {
			throw failure;
		});
		setSendMessage(sendMessage);

		await expect(saveToObsidian('Rejected content', 'Rejected note', 'Inbox', '', 'create'))
			.rejects.toBe(failure);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});

	test.each([
		['undefined', undefined],
		['missing success', {}],
		['non-boolean success', { success: 'true' }],
		['null', null],
	] as Array<[string, unknown]>)('rejects a malformed handoff response: %s', async (_label, response) => {
		generalSettings.legacyMode = true;
		const sendMessage = vi.fn(async () => response);
		setSendMessage(sendMessage);

		await expect(saveToObsidian('Malformed content', 'Malformed note', 'Inbox', '', 'create'))
			.rejects.toThrow('Background script did not confirm opening the Obsidian URL');
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
});

describe('ObsidianAdapter', () => {
	test('does not return delivered when the URI handoff fails', async () => {
		generalSettings.legacyMode = true;
		const sendMessage = vi.fn(async () => ({ success: false, error: 'No active tab found' }));
		setSendMessage(sendMessage);
		const adapter = new ObsidianAdapter(saveToObsidian);

		await expect(adapter.deliver(envelope)).rejects.toThrow('No active tab found');
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
});
