import { describe, expect, test, vi } from 'vitest';
import browser from '../utils/browser-polyfill';
import type { ResearchQueueRecord } from './contracts';
import {
	RESEARCH_QUEUE_APPEND_ACTION,
	RESEARCH_QUEUE_CLEAR_ACTION,
	type ResearchQueueWriteRequest,
} from './queue-messaging';
import {
	createSerialResearchQueueWriter,
	registerResearchQueueMessageHandler,
	type ResearchQueueWriterDependencies,
} from './queue-writer';

function makeRecord(recordId: string): ResearchQueueRecord {
	return {
		schemaVersion: 1,
		recordId,
		status: 'queued',
		queuedAt: '2026-08-09T00:00:00.000Z',
		destination: 'research_queue',
		context: {
			captureId: recordId,
			capturedAt: '2026-08-09T00:00:00.000Z',
			intent: 'research',
			source: {
				url: `https://example.com/${recordId}`,
				title: recordId,
			},
		},
		metadata: {
			capture_id: recordId,
			capture_intent: 'research',
			capture_destination: 'research_queue',
			capture_captured_at: '2026-08-09T00:00:00.000Z',
		},
		payload: {
			fileContent: `# ${recordId}`,
			noteName: recordId,
			templateId: 'default',
		},
	};
}

function appendRequest(recordId: string): ResearchQueueWriteRequest {
	return {
		action: RESEARCH_QUEUE_APPEND_ACTION,
		record: makeRecord(recordId),
	};
}

describe('createSerialResearchQueueWriter', () => {
	test('serializes concurrent appends and keeps invocation order', async () => {
		const calls: string[] = [];
		let releaseFirst!: () => void;
		const firstStarted = new Promise<void>(resolve => {
			releaseFirst = resolve;
		});
		const dependencies: ResearchQueueWriterDependencies = {
			append: vi.fn(async record => {
				calls.push(record.recordId);
				if (record.recordId === 'capture-a') await firstStarted;
			}),
			clear: vi.fn(async () => {
				calls.push('clear');
			}),
		};
		const writer = createSerialResearchQueueWriter(dependencies);

		const first = writer(appendRequest('capture-a'));
		const second = writer(appendRequest('capture-b'));
		await Promise.resolve();
		expect(calls).toEqual(['capture-a']);

		releaseFirst();
		await Promise.all([first, second]);
		expect(calls).toEqual(['capture-a', 'capture-b']);
	});

	test('serializes clear with append through the same writer', async () => {
		const calls: string[] = [];
		const dependencies: ResearchQueueWriterDependencies = {
			append: vi.fn(async record => {
				calls.push(record.recordId);
			}),
			clear: vi.fn(async () => {
				calls.push('clear');
			}),
		};
		const writer = createSerialResearchQueueWriter(dependencies);

		await Promise.all([
			writer(appendRequest('capture-a')),
			writer({ action: RESEARCH_QUEUE_CLEAR_ACTION }),
		]);

		expect(calls).toEqual(['capture-a', 'clear']);
	});

	test('allows later writes after a failed operation', async () => {
		const failure = new Error('temporary storage failure');
		const append = vi.fn()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(undefined);
		const writer = createSerialResearchQueueWriter({
			append,
			clear: vi.fn(async () => undefined),
		});

		const first = writer(appendRequest('capture-a'));
		const second = writer(appendRequest('capture-b'));
		await expect(first).rejects.toBe(failure);
		await expect(second).resolves.toBeUndefined();
		expect(append).toHaveBeenCalledTimes(2);
	});
});

type Listener = (
	request: unknown,
	sender: browser.Runtime.MessageSender,
	sendResponse: (response: unknown) => void,
) => true | undefined;

describe('registerResearchQueueMessageHandler', () => {
	test('registers synchronously and acknowledges a valid append', async () => {
		let listener: Listener | undefined;
		const addListener = vi.fn((candidate: Listener) => {
			listener = candidate;
		});
		const runtime = { onMessage: { addListener } };
		const writer = vi.fn(async () => undefined);

		registerResearchQueueMessageHandler(runtime, writer);

		expect(addListener).toHaveBeenCalledTimes(1);
		expect(listener).toBeDefined();
		let returnValue: true | undefined;
		const response = new Promise<unknown>(resolve => {
			returnValue = listener!(appendRequest('capture-a'), {} as browser.Runtime.MessageSender, resolve);
		});

		expect(returnValue).toBe(true);
		await expect(response).resolves.toEqual({ success: true });
		expect(writer).toHaveBeenCalledWith(appendRequest('capture-a'));
	});

	test('rejects malformed records before entering the writer', async () => {
		let listener!: Listener;
		const runtime = {
			onMessage: {
				addListener: (candidate: Listener) => {
					listener = candidate;
				},
			},
		};
		const writer = vi.fn(async () => undefined);
		registerResearchQueueMessageHandler(runtime, writer);

		const malformed = {
			action: RESEARCH_QUEUE_APPEND_ACTION,
			record: { ...makeRecord('capture-a'), schemaVersion: 2 },
		};
		const response = new Promise<unknown>(resolve => {
			listener(malformed, {} as browser.Runtime.MessageSender, resolve);
		});

		await expect(response).resolves.toEqual({
			success: false,
			error: 'Unsupported Research Queue schema version: 2',
		});
		expect(writer).not.toHaveBeenCalled();
	});

	test('propagates writer failures as an unsuccessful response', async () => {
		let listener!: Listener;
		const runtime = {
			onMessage: {
				addListener: (candidate: Listener) => {
					listener = candidate;
				},
			},
		};
		const failure = new Error('quota exceeded');
		const writer = vi.fn(async () => {
			throw failure;
		});
		registerResearchQueueMessageHandler(runtime, writer);

		const response = new Promise<unknown>(resolve => {
			listener(appendRequest('capture-a'), {} as browser.Runtime.MessageSender, resolve);
		});

		await expect(response).resolves.toEqual({ success: false, error: 'quota exceeded' });
	});

	test('leaves unrelated runtime messages for other handlers', () => {
		let listener!: Listener;
		const runtime = {
			onMessage: {
				addListener: (candidate: Listener) => {
					listener = candidate;
				},
			},
		};
		const writer = vi.fn(async () => undefined);
		registerResearchQueueMessageHandler(runtime, writer);

		expect(listener({ action: 'getActiveTab' }, {} as browser.Runtime.MessageSender, vi.fn())).toBeUndefined();
		expect(writer).not.toHaveBeenCalled();
	});
});
