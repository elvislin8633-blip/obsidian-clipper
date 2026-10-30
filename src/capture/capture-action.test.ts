import { describe, expect, test } from 'vitest';
import type { CaptureIntent } from './contracts';
import { captureActionLabelKey, resolveCaptureAction } from './capture-action';

const intents: CaptureIntent[] = [
	'reference',
	'read_later',
	'research',
	'knowledge',
	'project_material',
];

const saveBehaviors = ['addToObsidian', 'copyToClipboard', 'saveFile'] as const;

const expectedCaptureLabels = {
	reference: 'captureActionReference',
	read_later: 'captureActionReadLater',
	research: 'captureActionResearch',
	knowledge: 'captureActionKnowledge',
	project_material: 'captureActionProjectMaterial',
} as const;

describe('captureActionLabelKey', () => {
	test.each(intents)('%s has an intent-specific capture action label', intent => {
		expect(captureActionLabelKey(intent)).toBe(expectedCaptureLabels[intent]);
	});
});

describe('resolveCaptureAction', () => {
	test.each(intents.flatMap(intent => saveBehaviors.map(saveBehavior => [intent, saveBehavior] as const)))
		('%s resolves the %s primary action consistently', (intent, saveBehavior) => {
			const result = resolveCaptureAction(intent, saveBehavior);
			const isResearch = intent === 'research';
			const captureLabelKey = expectedCaptureLabels[intent];

			expect(result).toMatchObject({
				intent,
				destination: isResearch ? 'research_queue' : 'obsidian',
				captureLabelKey,
			});

			if (saveBehavior === 'addToObsidian') {
				expect(result.primaryAction).toBe('capture');
				expect(result.primaryLabelKey).toBe(isResearch ? captureLabelKey : 'addToObsidian');
				expect(result.previewLabelKey).toBe(isResearch
					? 'captureDestinationResearchQueue'
					: 'captureDestinationObsidian');
			} else {
				expect(result.primaryAction).toBe(saveBehavior);
				expect(result.primaryLabelKey).toBe(saveBehavior);
				expect(result.previewLabelKey).toBe(saveBehavior);
			}
		});
});
