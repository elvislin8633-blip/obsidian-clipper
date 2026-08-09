import type { Template } from '../../types/types';
import type { CaptureEnvelope, DestinationAdapter, RoutingResult } from '../contracts';

export type ObsidianSave = (
	fileContent: string,
	noteName: string,
	path: string,
	vault: string,
	behavior: Template['behavior'],
) => Promise<void>;

export class ObsidianAdapter implements DestinationAdapter {
	readonly id = 'obsidian' as const;

	constructor(private readonly save: ObsidianSave) {}

	async deliver(envelope: CaptureEnvelope): Promise<RoutingResult> {
		const { payload } = envelope;
		await this.save(payload.fileContent, payload.noteName, payload.path, payload.vault, payload.behavior);
		return {
			schemaVersion: envelope.schemaVersion,
			captureId: envelope.context.captureId,
			destination: envelope.destination,
			status: 'delivered',
			adapterId: this.id,
			noteName: payload.noteName,
			path: payload.path,
		};
	}
}
