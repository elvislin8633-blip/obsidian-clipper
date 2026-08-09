import type { CaptureIntent, DestinationId } from './contracts';

export function destinationForIntent(intent: CaptureIntent): DestinationId {
	switch (intent) {
		case 'research':
			return 'research_queue';
		case 'reference':
		case 'read_later':
		case 'knowledge':
		case 'project_material':
		default:
			return 'obsidian';
	}
}
