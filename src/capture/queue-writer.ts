import browser from '../utils/browser-polyfill';
import {
	appendResearchQueueDirect,
	clearResearchQueueDirect,
	validateResearchQueueRecord,
} from './queue-storage';
import {
	getResearchQueueWriteAction,
	parseResearchQueueWriteRequest,
	RESEARCH_QUEUE_APPEND_ACTION,
	RESEARCH_QUEUE_CLEAR_ACTION,
	type ResearchQueueWriteRequest,
} from './queue-messaging';
import type { ResearchQueueRecord } from './contracts';

export interface ResearchQueueWriterDependencies {
	append: (record: ResearchQueueRecord) => Promise<void>;
	clear: () => Promise<void>;
}

export type SerialResearchQueueWriter = (request: ResearchQueueWriteRequest) => Promise<void>;

const defaultDependencies: ResearchQueueWriterDependencies = {
	append: appendResearchQueueDirect,
	clear: clearResearchQueueDirect,
};

/**
 * Serialize every queue mutation through one promise tail. The tail is reset
 * after either outcome, so a failed storage operation does not poison later
 * writes. Append and clear deliberately share this serializer.
 */
export function createSerialResearchQueueWriter(
	dependencies: ResearchQueueWriterDependencies = defaultDependencies,
): SerialResearchQueueWriter {
	let tail: Promise<void> = Promise.resolve();

	return (request) => {
		const operation = tail.then(() => {
			if (request.action === RESEARCH_QUEUE_APPEND_ACTION) {
				return dependencies.append(request.record);
			}
			if (request.action === RESEARCH_QUEUE_CLEAR_ACTION) {
				return dependencies.clear();
			}
			throw new Error('Unknown Research Queue write action.');
		});

		// Always leave a resolved tail for the next request while preserving the
		// current operation's rejection for its caller.
		tail = operation.then(() => undefined, () => undefined);
		return operation;
	};
}

type RuntimeMessageListener = (
	request: unknown,
	sender: browser.Runtime.MessageSender,
	sendResponse: (response: unknown) => void,
) => true | undefined;

interface RuntimeMessageEvent {
	addListener(listener: RuntimeMessageListener): void;
}

interface RuntimeWithMessageEvent {
	onMessage: RuntimeMessageEvent;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Register the background queue endpoint synchronously. It only claims the
 * two queue actions, allowing the other background listeners to handle their
 * own messages. Every claimed request receives exactly one explicit result.
 */
export function registerResearchQueueMessageHandler(
	runtime: RuntimeWithMessageEvent = browser.runtime,
	writer: SerialResearchQueueWriter = createSerialResearchQueueWriter(),
): void {
	runtime.onMessage.addListener((request, _sender, sendResponse) => {
		if (!getResearchQueueWriteAction(request)) return undefined;

		let parsedRequest: ResearchQueueWriteRequest;
		try {
			parsedRequest = parseResearchQueueWriteRequest(request);
			if (parsedRequest.action === RESEARCH_QUEUE_APPEND_ACTION) {
				parsedRequest = {
					...parsedRequest,
					record: validateResearchQueueRecord(parsedRequest.record),
				};
			}
		} catch (error) {
			sendResponse({ success: false, error: errorMessage(error) });
			return true;
		}

		Promise.resolve()
			.then(() => writer(parsedRequest))
			.then(() => sendResponse({ success: true }))
			.catch(error => sendResponse({ success: false, error: errorMessage(error) }));
		return true;
	});
}
