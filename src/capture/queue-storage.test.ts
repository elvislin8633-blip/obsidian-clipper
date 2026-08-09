import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import browser from '../utils/browser-polyfill';
import {
	appendResearchQueue,
	clearResearchQueue,
	readResearchQueue,
	RESEARCH_QUEUE_STORAGE_KEY,
	validateResearchQueueRecord,
} from './queue-storage';
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

const originalLocalGet = browser.storage.local.get;
const originalLocalSet = browser.storage.local.set;
let stored: Record<string, unknown>;

beforeEach(() => {
	stored = {};
	browser.storage.local.get = vi.fn(async () => stored) as unknown as typeof browser.storage.local.get;
	browser.storage.local.set = vi.fn(async (items: Record<string, unknown>) => {
		Object.assign(stored, items);
	}) as unknown as typeof browser.storage.local.set;
});

afterEach(() => {
	browser.storage.local.get = originalLocalGet;
	browser.storage.local.set = originalLocalSet;
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

		await expect(appendResearchQueue(validRecord)).rejects.toMatchObject({
			name: 'ResearchQueueStorageError',
			cause: failure,
		});
	});

	test('clears the versioned queue key', async () => {
		stored[RESEARCH_QUEUE_STORAGE_KEY] = [validRecord];
		await clearResearchQueue();

		expect(stored[RESEARCH_QUEUE_STORAGE_KEY]).toEqual([]);
	});
});
