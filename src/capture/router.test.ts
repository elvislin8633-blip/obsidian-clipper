import { describe, expect, test, vi } from 'vitest';
import type { Property } from '../types/types';
import { generateFrontmatter as generateFrontmatterCore } from '../utils/shared';
import type {
	CaptureContext,
	CapturePayload,
	DestinationAdapter,
	RoutingResult,
} from './contracts';
import { createCaptureRouter } from './router';
import { destinationForIntent } from './routing';

const generateFrontmatter = async (properties: Property[]): Promise<string> =>
	generateFrontmatterCore(properties, {});

function makeContext(overrides: Partial<CaptureContext> = {}): CaptureContext {
	return {
		captureId: 'capture-test-1',
		capturedAt: '2026-08-09T00:00:00.000Z',
		intent: 'reference',
		source: {
			url: 'https://example.com/article',
			title: 'Example article',
			selection: 'Selected text',
		},
		...overrides,
	};
}

function makePayload(overrides: Partial<CapturePayload> = {}): CapturePayload {
	return {
		fileContent: '---\ntitle: "Example article"\n---\nBody',
		noteName: 'Example article',
		path: 'Clippings',
		behavior: 'create',
		vault: 'Personal',
		templateId: 'default',
		...overrides,
	};
}

function resultFor(envelope: Parameters<DestinationAdapter['deliver']>[0]): RoutingResult {
	return {
		schemaVersion: envelope.schemaVersion,
		captureId: envelope.context.captureId,
		destination: envelope.destination,
		status: 'delivered',
		adapterId: envelope.destination,
	};
}

describe('destinationForIntent', () => {
	test.each([
		['reference', 'obsidian'],
		['read_later', 'obsidian'],
		['research', 'research_queue'],
		['knowledge', 'obsidian'],
		['project_material', 'obsidian'],
	] as const)('%s routes to %s', (intent, destination) => {
		expect(destinationForIntent(intent)).toBe(destination);
	});
});

describe('CaptureRouter', () => {
	test('owns reserved metadata and routes Reference to Obsidian', async () => {
		let received: Parameters<DestinationAdapter['deliver']>[0] | undefined;
		const obsidian: DestinationAdapter = {
			id: 'obsidian',
			deliver: vi.fn(async envelope => {
				received = envelope;
				return resultFor(envelope);
			}),
		};

		const router = createCaptureRouter(
			{ inboxPath: 'Inbox', projects: [] },
			{ obsidian },
			generateFrontmatter,
		);
		const result = await router.route(
			makePayload(),
			makeContext({ projectId: 'project-ai', projectName: 'AI Research' }),
		);

		expect(result).toMatchObject({
			status: 'delivered',
			destination: 'obsidian',
			adapterId: 'obsidian',
		});
		expect(received?.metadata).toEqual({
			capture_id: 'capture-test-1',
			capture_intent: 'reference',
			capture_project_id: 'project-ai',
			capture_project_name: 'AI Research',
			capture_destination: 'obsidian',
			capture_captured_at: '2026-08-09T00:00:00.000Z',
		});
		expect(received?.payload.fileContent).toContain('capture_intent: "reference"');
		expect(received?.payload.fileContent).toContain('capture_project_id: "project-ai"');
	});

	test('Router replaces a conflicting reserved property', async () => {
		let received: Parameters<DestinationAdapter['deliver']>[0] | undefined;
		const obsidian: DestinationAdapter = {
			id: 'obsidian',
			deliver: vi.fn(async envelope => {
				received = envelope;
				return resultFor(envelope);
			}),
		};
		const router = createCaptureRouter(
			{ inboxPath: 'Inbox', projects: [] },
			{ obsidian },
			generateFrontmatter,
		);

		await router.route(
			makePayload({ fileContent: '---\ncapture_intent: "user-value"\ncustom: "yes"\n---\nBody' }),
			makeContext(),
		);

		const content = received?.payload.fileContent || '';
		expect(content.match(/capture_intent:/g)).toHaveLength(1);
		expect(content).toContain('capture_intent: "reference"');
		expect(content).not.toContain('user-value');
		expect(content).toContain('custom: "yes"');
	});

	test.each(['read_later', 'knowledge'] as const)('%s resolves the configured Inbox path', async intent => {
		let received: Parameters<DestinationAdapter['deliver']>[0] | undefined;
		const obsidian: DestinationAdapter = {
			id: 'obsidian',
			deliver: vi.fn(async envelope => {
				received = envelope;
				return resultFor(envelope);
			}),
		};
		const router = createCaptureRouter(
			{ inboxPath: 'Knowledge/Inbox', projects: [] },
			{ obsidian },
			generateFrontmatter,
		);

		await router.route(makePayload({ path: 'Template Path', behavior: 'append-daily' }), makeContext({ intent }));

		expect(received?.payload.path).toBe('Knowledge/Inbox');
		expect(received?.payload.behavior).toBe('create');
	});

	test('adapter failure propagates without a success result', async () => {
		const failure = new Error('storage quota exceeded');
		const research: DestinationAdapter = {
			id: 'research_queue',
			deliver: vi.fn(async () => {
				throw failure;
			}),
		};
		const router = createCaptureRouter(
			{ inboxPath: 'Inbox', projects: [] },
			{ research_queue: research },
			generateFrontmatter,
		);

		await expect(router.route(makePayload(), makeContext({ intent: 'research' }))).rejects.toBe(failure);
		expect(research.deliver).toHaveBeenCalledTimes(1);
	});

	test('rejects an adapter result with an unsupported schema version', async () => {
		const obsidian: DestinationAdapter = {
			id: 'obsidian',
			deliver: vi.fn(async envelope => ({
				...resultFor(envelope),
				schemaVersion: 2 as 1,
			})),
		};
		const router = createCaptureRouter(
			{ inboxPath: 'Inbox', projects: [] },
			{ obsidian },
			generateFrontmatter,
		);

		await expect(router.route(makePayload(), makeContext())).rejects.toThrow(
			'Adapter returned an invalid routing result for obsidian.'
		);
	});
});
