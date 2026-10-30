import type { SaveBehavior } from '../types/types';
import type { CaptureIntent, DestinationId } from './contracts';
import { destinationForIntent } from './routing';

export type CapturePrimaryAction = 'capture' | SaveBehavior;

export type CaptureActionLabelKey =
	| 'captureActionReference'
	| 'captureActionReadLater'
	| 'captureActionResearch'
	| 'captureActionKnowledge'
	| 'captureActionProjectMaterial';

export type CapturePreviewLabelKey =
	| 'captureDestinationObsidian'
	| 'captureDestinationResearchQueue'
	| 'copyToClipboard'
	| 'saveFile';

export interface CaptureActionResolution {
	intent: CaptureIntent;
	destination: DestinationId;
	primaryAction: CapturePrimaryAction;
	primaryLabelKey: CaptureActionLabelKey | SaveBehavior;
	captureLabelKey: CaptureActionLabelKey;
	previewLabelKey: CapturePreviewLabelKey;
}

const CAPTURE_ACTION_LABELS: Record<CaptureIntent, CaptureActionLabelKey> = {
	reference: 'captureActionReference',
	read_later: 'captureActionReadLater',
	research: 'captureActionResearch',
	knowledge: 'captureActionKnowledge',
	project_material: 'captureActionProjectMaterial',
};

export function captureActionLabelKey(intent: CaptureIntent): CaptureActionLabelKey {
	return CAPTURE_ACTION_LABELS[intent];
}

export function resolveCaptureAction(
	intent: CaptureIntent,
	saveBehavior: SaveBehavior,
): CaptureActionResolution {
	const destination = destinationForIntent(intent);
	const captureLabelKey = captureActionLabelKey(intent);

	if (saveBehavior === 'addToObsidian') {
		return {
			intent,
			destination,
			primaryAction: 'capture',
			// Keep the established primary label for Obsidian captures. Research is
			// the one intent whose capture action changes the destination entirely.
			primaryLabelKey: destination === 'research_queue' ? captureLabelKey : 'addToObsidian',
			captureLabelKey,
			previewLabelKey: destination === 'research_queue'
				? 'captureDestinationResearchQueue'
				: 'captureDestinationObsidian',
		};
	}

	return {
		intent,
		destination,
		primaryAction: saveBehavior,
		primaryLabelKey: saveBehavior,
		captureLabelKey,
		// Copy/download remain the configured primary action. The preview must
		// describe that action instead of the capture route used by the secondary
		// action.
		previewLabelKey: saveBehavior,
	};
}
