import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import browser from '../utils/browser-polyfill';
import {
	appendResearchQueue,
	appendResearchQueueDirect,
	clearResearchQueue,
	clearResearchQueueDirect,
	readResearchQueue,
	RESEARCH_QUEUE_STORAGE_KEY,
	validateResearchQueueRecord,
} from './queue-storage';
import { RESEARCH_QUEUE_APPEND_ACTION, RESEARCH_QUEUE_CLEAR_ACTION } from './queue-messaging';
import { createSerialResearchQueueWriter } from './queue-writer';
import type { ResearchQueueRecord } from './contracts';

const validRecord: ResearchQueueRecord = {
	schemaVersion: 1,
	recordId: 'capture-1',
	status: 'queued',
	queuedAt: '2026-08-09T00:00:00.000Z',
	destination: 'research_queue',
	context: {
		captureId: 'capture-1',
		capturedAt: '2026-08-09T00:00:00.000Z',
		intent: 'research',
		source: {
			url: 'https://example.com',
			title: 'Example',
		},
	},
	metadata: {
		capture_id: 'capture-1',
		capture_intent: 'research',
		capture_destination: 'research_queue',
		capture_captured_at: '2026-08-09T00:00:00.000Z',
	},
	payload: {
		fileContent: '# Example',
		noteName: 'Example',
		templateId: 'default',
	},
};

function recordWithId(recordId: string): ResearchQueueRecord {
	return {
		...validRecord,
		recordId,
		context: {
			...validRecord.context,
			captureId: recordId,
			source: { ...validRecord.context.source, title: recordId },
		},
		metadata: { ...validRecord.metadata, capture_id: recordId },
		payload: { ...validRecord.payload, noteName: recordId, fileContent: `# ${recordId}` },
	};
}

const originalLocalGet = browser.storage.local.get;
const originalLocalSet = browser.storage.local.set;
const originalSendMessage = browser.runtime.sendMessage;
let stored: Record<string, unknown>;

beforeEach(() => {
	stored = {};
	browser.storage.local.get = vi.fn(async () => stored) as unknown as typeof browser.storage.local.get;
	browser.storage.local.set = vi.fn(async (items: Record<string, unknown>) => {
		Object.assign(stored, items);
	}) as unknown as typeof browser.storage.local.set;
	browser.runtime.sendMessage = vi.fn(async () => ({ success: true })) as unknown as typeof browser.runtime.sendMessage;
});

afterEach(() => {
	browser.storage.local.get = originalLocalGet;
	browser.storage.local.set = originalLocalSet;
	browser.runtime.sendMessage = originalSendMessage;
});

describe('Research Queue record schema', () => {
	test('accepts version 1 records', () => {
		expect(validateResearchQueueRecord(validRecord)).toEqual(validRecord);
	});

	test('rejects unsupported versions without silently dropping them', () => {
		expect(() => validateResearchQueueRecord({ ...validRecord, schemaVersion: 2 }))
			.toThrow('Unsupported Research Queue schema version: 2');
	});

	test('rejects malformed payloads', () => {
		expect(() => validateResearchQueueRecord({
			...validRecord,
			payload: { fileContent: '# Missing fields' },
		})).toThrow('Research Queue record payload is invalid.');
	});

	test('rejects metadata that does not match the capture identity', () => {
		expect(() => validateResearchQueueRecord({
			...validRecord,
			metadata: { ...validRecord.metadata, capture_id: 'other-capture' },
		})).toThrow('Research Queue metadata does not match its context.');
	});
});

describe('Research Queue storage', () => {
	test('uses the versioned local storage key and appends records', async () => {
		expect(await readResearchQueue()).toEqual([]);
		await appendResearchQueue(validRecord);

		expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
			action: RESEARCH_QUEUE_APPEND_ACTION,
			record: validRecord,
		});
		expect(stored[RESEARCH_QUEUE_STORAGE_KEY]).toBeUndefined();
	});

	test('applies an append through the background storage primitive', async () => {
		await appendResearchQueueDirect(validRecord);

		expect(browser.storage.local.get).toHaveBeenCalledWith(RESEARCH_QUEUE_STORAGE_KEY);
		expect(stored[RESEARCH_QUEUE_STORAGE_KEY]).toEqual([validRecord]);
		expect(await readResearchQueue()).toEqual([validRecord]);
	});

	test('does not discard unsupported records while reading', async () => {
		stored[RESEARCH_QUEUE_STORAGE_KEY] = [{ ...validRecord, schemaVersion: 2 }];

		await expect(readResearchQueue()).rejects.toThrow('Unsupported Research Queue schema version: 2');
		expect(stored[RESEARCH_QUEUE_STORAGE_KEY]).toHaveLength(1);
	});

	test('propagates local storage failures', async () => {
		const failure = new Error('quota exceeded');
		browser.storage.local.set = vi.fn(async () => {
			throw failure;
		}) as unknown as typeof browser.storage.local.set;

		await expect(appendResearchQueueDirect(validRecord)).rejects.toMatchObject({
			name: 'ResearchQueueStorageError',
			cause: failure,
		});
	});

	test('requires an explicit background acknowledgement for append', async () => {
		browser.runtime.sendMessage = vi.fn(async () => ({
			success: false,
			error: 'background storage failed',
		})) as unknown as typeof browser.runtime.sendMessage;

		await expect(appendResearchQueue(validRecord)).rejects.toMatchObject({
			name: 'ResearchQueueStorageError',
		});
		expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
	});

	test('clears through the background writer', async () => {
		stored[RESEARCH_QUEUE_STORAGE_KEY] = [validRecord];
		await clearResearchQueue();

		expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
			action: RESEARCH_QUEUE_CLEAR_ACTION,
		});
		expect(stored[RESEARCH_QUEUE_STORAGE_KEY]).toEqual([validRecord]);
	});

	test('applies a clear through the background storage primitive', async () => {
		stored[RESEARCH_QUEUE_STORAGE_KEY] = [validRecord];
		await clearResearchQueueDirect();

		expect(stored[RESEARCH_QUEUE_STORAGE_KEY]).toEqual([]);
	});

	test('retains every concurrent append through the serial background writer', async () => {
		let persisted: ResearchQueueRecord[] = [];
		browser.storage.local.get = vi.fn(async () => ({
			[RESEARCH_QUEUE_STORAGE_KEY]: persisted.map(record => ({ ...record })),
		})) as unknown as typeof browser.storage.local.get;
		browser.storage.local.set = vi.fn(async (items: Record<string, unknown>) => {
			// Make each storage write yield, exposing any read-modify-write overlap
			// if the writer stops serializing operations.
			await new Promise(resolve => setTimeout(resolve, 0));
			persisted = (items[RESEARCH_QUEUE_STORAGE_KEY] as ResearchQueueRecord[]).map(record => ({ ...record }));
		}) as unknown as typeof browser.storage.local.set;
		const writer = createSerialResearchQueueWriter();
		const records = ['capture-a', 'capture-b', 'capture-c', 'capture-d'].map(recordWithId);

		await Promise.all(records.map(record => writer({
			action: RESEARCH_QUEUE_APPEND_ACTION,
			record,
		})));

		expect(persisted.map(record => record.recordId)).toEqual(records.map(record => record.recordId));
	});

	test('serializes append, clear, and append as one ordered mutation stream', async () => {
		let persisted: ResearchQueueRecord[] = [recordWithId('capture-before')];
		browser.storage.local.get = vi.fn(async () => ({
			[RESEARCH_QUEUE_STORAGE_KEY]: persisted.map(record => ({ ...record })),
		})) as unknown as typeof browser.storage.local.get;
		browser.storage.local.set = vi.fn(async (items: Record<string, unknown>) => {
			await new Promise(resolve => setTimeout(resolve, 0));
			persisted = (items[RESEARCH_QUEUE_STORAGE_KEY] as ResearchQueueRecord[]).map(record => ({ ...record }));
		}) as unknown as typeof browser.storage.local.set;
		const writer = createSerialResearchQueueWriter();

		await Promise.all([
			writer({ action: RESEARCH_QUEUE_APPEND_ACTION, record: recordWithId('capture-a') }),
			writer({ action: RESEARCH_QUEUE_CLEAR_ACTION }),
			writer({ action: RESEARCH_QUEUE_APPEND_ACTION, record: recordWithId('capture-b') }),
		]);

		expect(persisted.map(record => record.recordId)).toEqual(['capture-b']);
	});
});
