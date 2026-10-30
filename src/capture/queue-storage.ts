import browser from '../utils/browser-polyfill';
import {
	CAPTURE_SCHEMA_VERSION,
	type ResearchQueueRecord,
} from './contracts';
import {
	RESEARCH_QUEUE_APPEND_ACTION,
	RESEARCH_QUEUE_CLEAR_ACTION,
	sendResearchQueueWrite,
} from './queue-messaging';

export const RESEARCH_QUEUE_STORAGE_KEY = `research_queue_v${CAPTURE_SCHEMA_VERSION}`;

export class ResearchQueueStorageError extends Error {
	readonly cause?: unknown;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message);
		this.cause = options?.cause;
		this.name = 'ResearchQueueStorageError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function validateResearchQueueRecord(value: unknown): ResearchQueueRecord {
	if (!isRecord(value)) {
		throw new ResearchQueueStorageError('Research Queue contains an invalid record.');
	}
	if (value.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
		throw new ResearchQueueStorageError(
			`Unsupported Research Queue schema version: ${String(value.schemaVersion)}`
		);
	}
	if (value.status !== 'queued' || value.destination !== 'research_queue') {
		throw new ResearchQueueStorageError('Research Queue contains a record with an invalid status.');
	}
	if (typeof value.recordId !== 'string' || typeof value.queuedAt !== 'string') {
		throw new ResearchQueueStorageError('Research Queue record is missing its identity.');
	}
	if (!isRecord(value.context) || !isRecord(value.metadata) || !isRecord(value.payload)) {
		throw new ResearchQueueStorageError('Research Queue record is missing required sections.');
	}

	const context = value.context;
	if (typeof context.captureId !== 'string'
		|| typeof context.capturedAt !== 'string'
		|| value.recordId !== context.captureId) {
		throw new ResearchQueueStorageError('Research Queue record identity does not match its context.');
	}
	if (context.intent !== 'research'
		|| !isRecord(context.source)
		|| typeof context.source.url !== 'string'
		|| typeof context.source.title !== 'string') {
		throw new ResearchQueueStorageError('Research Queue record must have research intent.');
	}

	const metadata = value.metadata;
	if (metadata.capture_id !== value.recordId
		|| metadata.capture_intent !== 'research'
		|| metadata.capture_destination !== 'research_queue'
		|| metadata.capture_captured_at !== context.capturedAt) {
		throw new ResearchQueueStorageError('Research Queue metadata does not match its context.');
	}

	const payload = value.payload;
	if (typeof payload.fileContent !== 'string'
		|| typeof payload.noteName !== 'string'
		|| typeof payload.templateId !== 'string') {
		throw new ResearchQueueStorageError('Research Queue record payload is invalid.');
	}
	return value as unknown as ResearchQueueRecord;
}

export async function readResearchQueue(): Promise<ResearchQueueRecord[]> {
	try {
		const stored = await browser.storage.local.get(RESEARCH_QUEUE_STORAGE_KEY) as Record<string, unknown>;
		const raw = stored[RESEARCH_QUEUE_STORAGE_KEY];
		if (raw === undefined) return [];
		if (!Array.isArray(raw)) {
			throw new ResearchQueueStorageError('Research Queue storage is not an array.');
		}
		return raw.map(validateResearchQueueRecord);
	} catch (error) {
		if (error instanceof ResearchQueueStorageError) throw error;
		throw new ResearchQueueStorageError('Unable to read Research Queue.', { cause: error });
	}
}

/**
 * Apply an append in the background context. Callers in extension pages must
 * use appendResearchQueue(), which crosses the runtime message boundary so all
 * popup and side-panel writers share the background serializer.
 */
export async function appendResearchQueueDirect(record: ResearchQueueRecord): Promise<void> {
	const validated = validateResearchQueueRecord(record);
	const queue = await readResearchQueue();
	try {
		await browser.storage.local.set({
			[RESEARCH_QUEUE_STORAGE_KEY]: [...queue, validated],
		});
	} catch (error) {
		throw new ResearchQueueStorageError('Unable to persist Research Queue record.', { cause: error });
	}
}

/** Apply a clear in the background context. */
export async function clearResearchQueueDirect(): Promise<void> {
	try {
		await browser.storage.local.set({ [RESEARCH_QUEUE_STORAGE_KEY]: [] });
	} catch (error) {
		throw new ResearchQueueStorageError('Unable to clear Research Queue.', { cause: error });
	}
}

/**
 * Public append entry point for popup and side-panel contexts. The background
 * handler validates the record again before applying this request.
 */
export async function appendResearchQueue(record: ResearchQueueRecord): Promise<void> {
	const validated = validateResearchQueueRecord(record);
	try {
		await sendResearchQueueWrite({
			action: RESEARCH_QUEUE_APPEND_ACTION,
			record: validated,
		});
	} catch (error) {
		throw new ResearchQueueStorageError('Unable to persist Research Queue record.', { cause: error });
	}
}

/** Public clear entry point for popup and side-panel contexts. */
export async function clearResearchQueue(): Promise<void> {
	try {
		await sendResearchQueueWrite({ action: RESEARCH_QUEUE_CLEAR_ACTION });
	} catch (error) {
		throw new ResearchQueueStorageError('Unable to clear Research Queue.', { cause: error });
	}
}
