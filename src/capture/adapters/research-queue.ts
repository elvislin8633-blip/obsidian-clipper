import type {
	CaptureEnvelope,
	DestinationAdapter,
	ResearchQueueRecord,
	RoutingResult,
} from '../contracts';
import { appendResearchQueue } from '../queue-storage';

export type ResearchQueueWriter = (record: ResearchQueueRecord) => Promise<void>;

export class ResearchQueueAdapter implements DestinationAdapter {
	readonly id = 'research_queue' as const;

	constructor(private readonly write: ResearchQueueWriter = appendResearchQueue) {}

	async deliver(envelope: CaptureEnvelope): Promise<RoutingResult> {
		const record: ResearchQueueRecord = {
			schemaVersion: envelope.schemaVersion,
			recordId: envelope.context.captureId,
			status: 'queued',
			queuedAt: envelope.context.capturedAt,
			destination: 'research_queue',
			context: envelope.context,
			metadata: envelope.metadata,
			payload: {
				fileContent: envelope.payload.fileContent,
				noteName: envelope.payload.noteName,
				templateId: envelope.payload.templateId,
			},
		};
		await this.write(record);
		return {
			schemaVersion: envelope.schemaVersion,
			captureId: envelope.context.captureId,
			destination: envelope.destination,
			status: 'delivered',
			adapterId: this.id,
			queueRecordId: record.recordId,
		};
	}
}
