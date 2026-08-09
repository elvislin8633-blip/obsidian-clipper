import { describe, expect, test, vi } from 'vitest';
import type { CaptureEnvelope } from './contracts';
import { ResearchQueueAdapter } from './adapters/research-queue';

const envelope: CaptureEnvelope = {
	schemaVersion: 1,
	payload: {
		fileContent: '# Research source',
		noteName: 'Research source',
		path: 'Ignored by queue delivery',
		behavior: 'create',
		vault: 'Personal',
		templateId: 'default',
	},
	context: {
		captureId: 'capture-adapter-test',
		capturedAt: '2026-08-09T00:00:00.000Z',
		intent: 'research',
		source: {
			url: 'https://example.com/research',
			title: 'Research source',
		},
	},
	destination: 'research_queue',
	metadata: {
		capture_id: 'capture-adapter-test',
		capture_intent: 'research',
		capture_destination: 'research_queue',
		capture_captured_at: '2026-08-09T00:00:00.000Z',
	},
};

describe('ResearchQueueAdapter', () => {
	test('writes the explicit versioned queue record and returns RoutingResult', async () => {
		const write = vi.fn(async () => undefined);
		const adapter = new ResearchQueueAdapter(write);

		const result = await adapter.deliver(envelope);

		expect(write).toHaveBeenCalledWith({
			schemaVersion: 1,
			recordId: 'capture-adapter-test',
			status: 'queued',
			queuedAt: '2026-08-09T00:00:00.000Z',
			destination: 'research_queue',
			context: envelope.context,
			metadata: envelope.metadata,
			payload: {
				fileContent: '# Research source',
				noteName: 'Research source',
				templateId: 'default',
			},
		});
		expect(result).toEqual({
			schemaVersion: 1,
			captureId: 'capture-adapter-test',
			destination: 'research_queue',
			status: 'delivered',
			adapterId: 'research_queue',
			queueRecordId: 'capture-adapter-test',
		});
	});

	test('propagates queue writer failure without returning success', async () => {
		const failure = new Error('storage quota exceeded');
		const adapter = new ResearchQueueAdapter(vi.fn(async () => {
			throw failure;
		}));

		await expect(adapter.deliver(envelope)).rejects.toBe(failure);
	});
});
