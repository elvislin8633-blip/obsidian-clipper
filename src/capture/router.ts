import { generateFrontmatter } from '../utils/obsidian-note-creator';
import type {
	CaptureContext,
	CaptureEnvelope,
	CapturePayload,
	CaptureSettings,
	DestinationAdapter,
	DestinationId,
	RoutingResult,
} from './contracts';
import { CAPTURE_SCHEMA_VERSION } from './contracts';
import { addReservedMetadataToPayload, createReservedCaptureMetadata } from './metadata';
import { destinationForIntent } from './routing';

export interface CaptureRouterOptions {
	settings: CaptureSettings;
	adapters: Partial<Record<DestinationId, DestinationAdapter>>;
	generateFrontmatter?: typeof generateFrontmatter;
}

export class CaptureRouter {
	private readonly generateFrontmatter: typeof generateFrontmatter;

	constructor(private readonly options: CaptureRouterOptions) {
		this.generateFrontmatter = options.generateFrontmatter || generateFrontmatter;
	}

	async route(payload: CapturePayload, context: CaptureContext): Promise<RoutingResult> {
		const destination = destinationForIntent(context.intent);
		const adapter = this.options.adapters[destination];
		if (!adapter) {
			throw new Error(`No adapter configured for destination: ${destination}`);
		}
		if (adapter.id !== destination) {
			throw new Error(`Adapter ${adapter.id} is not valid for destination: ${destination}`);
		}

		const metadata = createReservedCaptureMetadata(context, destination);
		const routedPayload = await addReservedMetadataToPayload(
			this.resolvePayload(payload, context.intent),
			metadata,
			this.generateFrontmatter,
		);
		const envelope: CaptureEnvelope = {
			schemaVersion: CAPTURE_SCHEMA_VERSION,
			payload: routedPayload,
			context,
			destination,
			metadata,
		};

		// Adapter failures intentionally propagate to the caller. The popup must
		// not report success or retry delivery after this boundary.
		const result = await adapter.deliver(envelope);
		if (!result
			|| result.schemaVersion !== CAPTURE_SCHEMA_VERSION
			|| result.status !== 'delivered'
			|| result.captureId !== context.captureId
			|| result.destination !== destination
			|| result.adapterId !== adapter.id) {
			throw new Error(`Adapter returned an invalid routing result for ${destination}.`);
		}
		return result;
	}

	private resolvePayload(payload: CapturePayload, intent: CaptureContext['intent']): CapturePayload {
		if (intent !== 'read_later' && intent !== 'knowledge') return payload;
		return {
			...payload,
			path: this.options.settings.inboxPath,
			behavior: 'create',
		};
	}
}

export function createCaptureRouter(
	settings: CaptureSettings,
	adapters: Partial<Record<DestinationId, DestinationAdapter>>,
	generateFrontmatterFn?: typeof generateFrontmatter,
): CaptureRouter {
	return new CaptureRouter({
		settings,
		adapters,
		generateFrontmatter: generateFrontmatterFn,
	});
}
