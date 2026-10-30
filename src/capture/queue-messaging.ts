import browser from '../utils/browser-polyfill';
import type { ResearchQueueRecord } from './contracts';

/**
 * Queue writes cross extension-page boundaries through the background script.
 * Keep these action names stable: popup and side-panel bundles use the same
 * protocol, while the background owns the single serial writer.
 */
export const RESEARCH_QUEUE_APPEND_ACTION = 'researchQueueAppend' as const;
export const RESEARCH_QUEUE_CLEAR_ACTION = 'researchQueueClear' as const;

export interface ResearchQueueAppendRequest {
	action: typeof RESEARCH_QUEUE_APPEND_ACTION;
	record: ResearchQueueRecord;
}

export interface ResearchQueueClearRequest {
	action: typeof RESEARCH_QUEUE_CLEAR_ACTION;
}

export type ResearchQueueWriteRequest = ResearchQueueAppendRequest | ResearchQueueClearRequest;

export interface ResearchQueueWriteResponse {
	success: boolean;
	error?: string;
}

export class ResearchQueueMessagingError extends Error {
	readonly cause?: unknown;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message);
		this.cause = options?.cause;
		this.name = 'ResearchQueueMessagingError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Return the queue action for known requests without claiming unrelated
 * runtime messages. This lets the background listener leave other handlers'
 * messages alone.
 */
export function getResearchQueueWriteAction(request: unknown): ResearchQueueWriteRequest['action'] | undefined {
	if (!isRecord(request)) return undefined;
	if (request.action === RESEARCH_QUEUE_APPEND_ACTION || request.action === RESEARCH_QUEUE_CLEAR_ACTION) {
		return request.action;
	}
	return undefined;
}

/**
 * Parse the small message envelope. Record validation belongs to the storage
 * boundary and is repeated in the background, because runtime messages are
 * untrusted JSON data after crossing an extension context.
 */
export function parseResearchQueueWriteRequest(request: unknown): ResearchQueueWriteRequest {
	if (!isRecord(request)) {
		throw new ResearchQueueMessagingError('Research Queue write request is invalid.');
	}

	if (request.action === RESEARCH_QUEUE_APPEND_ACTION) {
		if (!Object.prototype.hasOwnProperty.call(request, 'record')) {
			throw new ResearchQueueMessagingError('Research Queue append request is missing its record.');
		}
		return {
			action: RESEARCH_QUEUE_APPEND_ACTION,
			record: request.record as ResearchQueueRecord,
		};
	}

	if (request.action === RESEARCH_QUEUE_CLEAR_ACTION) {
		return { action: RESEARCH_QUEUE_CLEAR_ACTION };
	}

	throw new ResearchQueueMessagingError('Unknown Research Queue write action.');
}

function getResponseError(response: unknown): string | undefined {
	if (!isRecord(response) || typeof response.error !== 'string') return undefined;
	return response.error;
}

/**
 * Send exactly one write request and require an explicit background
 * acknowledgement. There is deliberately no retry: retrying an append after
 * an uncertain response could create a duplicate record.
 */
export async function sendResearchQueueWrite(request: ResearchQueueWriteRequest): Promise<void> {
	let response: unknown;
	try {
		response = await browser.runtime.sendMessage(request);
	} catch (error) {
		throw new ResearchQueueMessagingError('Research Queue background writer is unavailable.', { cause: error });
	}

	if (!isRecord(response) || response.success !== true) {
		const detail = getResponseError(response);
		throw new ResearchQueueMessagingError(
			detail || 'Research Queue background writer did not confirm the write.'
		);
	}
}
