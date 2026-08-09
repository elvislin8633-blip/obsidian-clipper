import { describe, expect, test, vi } from 'vitest';
import {
	executeQuickClip,
	prepareQuickClipNote,
} from './quick-clip';
import type { QuickClipCompiler, QuickClipPageData } from './quick-clip';
import { Template } from '../types/types';
import type { CaptureContext, CapturePayload } from '../capture/contracts';

function makePage(overrides: Partial<QuickClipPageData> = {}): QuickClipPageData {
	return {
		content: '<p>Article body</p>',
		markdownContent: 'Article body',
		selectedHtml: '',
		extractedContent: {},
		schemaOrgData: [],
		fullHtml: '<html><body><p>Article body</p></body></html>',
		domain: 'example.com',
		highlights: [],
		title: 'A useful article',
		author: 'Ada Lovelace',
		description: 'A short description',
		favicon: '',
		image: '',
		published: '2026-08-08',
		parseTime: 1,
		site: 'Example Site',
		wordCount: 2,
		language: 'en',
		metaTags: [],
		...overrides,
	};
}

function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 'article',
		name: 'Articles',
		behavior: 'create',
		noteNameFormat: '{{title}}',
		path: 'Clippings/Articles',
		noteContentFormat: '{{content}}',
		properties: [
			{ name: 'title', value: '{{title}}' },
			{ name: 'source', value: '{{url}}' },
			{ name: 'quoted', value: '\\"{{title}}\\"' },
			{ name: 'tags', value: 'web-clip, 待整理' },
		],
		...overrides,
	};
}

const simpleCompiler: QuickClipCompiler = async (_tabId, text, variables) => {
	return text.replace(/{{(title|url|content)}}/g, (_match, name: string) => variables[`{{${name}}}`] || '');
};

describe('prepareQuickClipNote', () => {
	test('compiles the note name, path, properties, frontmatter, and markdown body', async () => {
		const note = await prepareQuickClipNote({
			tabId: 3,
			currentUrl: 'https://example.com/article',
			page: makePage(),
			template: makeTemplate(),
			propertyTypes: { tags: 'multitext' },
			compileTemplate: simpleCompiler,
		});

		expect(note.noteName).toBe('A useful article');
		expect(note.path).toBe('Clippings/Articles');
		expect(note.fileContent).toContain('title: "A useful article"');
		expect(note.fileContent).toContain('  - "web-clip"');
		expect(note.fileContent).toContain('  - "待整理"');
		expect(note.properties.find(property => property.name === 'quoted')?.value).toBe('"A useful article"');
		expect(note.fileContent).toContain('\n---\nArticle body');
	});
});

describe('executeQuickClip', () => {
		test('runs extraction, template matching, save, and history in order', async () => {
		const template = makeTemplate();
		const matchedTemplate = makeTemplate({ id: 'matched', name: 'Matched template' });
		const routeCapture = vi.fn(async (payload: Pick<CapturePayload, 'noteName' | 'path'>, context: CaptureContext) => ({
			schemaVersion: 1 as const,
			captureId: context.captureId,
			destination: 'obsidian' as const,
			status: 'delivered' as const,
			adapterId: 'obsidian' as const,
			noteName: payload.noteName,
			path: payload.path,
		}));
		const recordSave = vi.fn(async () => undefined);
		const rememberVault = vi.fn(async () => undefined);
		const initializeTriggers = vi.fn();
		const matched = vi.fn(async () => matchedTemplate);

		const result = await executeQuickClip(7, {
			getTab: vi.fn(async () => ({ url: 'https://example.com/article' })),
			ensureContentScriptLoaded: vi.fn(async () => undefined),
			extractPageContent: vi.fn(async () => makePage()),
			loadTemplates: vi.fn(async () => [template]),
			initializeTriggers,
			findMatchingTemplate: matched,
			getPropertyTypes: () => ({ tags: 'multitext' }),
			getVault: vi.fn(async () => 'Personal'),
			routeCapture,
			recordSave,
			rememberVault,
			compileTemplate: simpleCompiler,
		});

		expect(initializeTriggers).toHaveBeenCalledWith([template]);
		expect(matched).toHaveBeenCalledWith('https://example.com/article', expect.any(Function));
		expect(result.template.id).toBe('matched');
		expect(result.vault).toBe('Personal');
		expect(routeCapture).toHaveBeenCalledWith(
			expect.objectContaining({
				fileContent: result.fileContent,
				noteName: 'A useful article',
				path: 'Clippings/Articles',
				vault: 'Personal',
				behavior: 'create',
				templateId: 'matched',
			}),
			expect.objectContaining({
				intent: 'reference',
			}),
		);
		const routedContext = routeCapture.mock.calls[0][1];
		expect(routedContext).not.toHaveProperty('projectId');
		expect(routedContext).not.toHaveProperty('projectName');
		expect(routedContext.source).toMatchObject({
			url: 'https://example.com/article',
			title: 'A useful article',
		});
		expect(recordSave).toHaveBeenCalledWith(
			'Personal',
			'Clippings/Articles',
			'https://example.com/article',
			'A useful article'
		);
		expect(rememberVault).toHaveBeenCalledWith('Personal');
	});

	test('fails before saving when extraction has no markdown content', async () => {
		const routeCapture = vi.fn(async () => {
			throw new Error('route should not be called');
		});

		await expect(executeQuickClip(7, {
			getTab: vi.fn(async () => ({ url: 'https://example.com/article' })),
			ensureContentScriptLoaded: vi.fn(async () => undefined),
			extractPageContent: vi.fn(async () => makePage({ markdownContent: '' })),
			loadTemplates: vi.fn(async () => [makeTemplate()]),
			initializeTriggers: vi.fn(),
			findMatchingTemplate: vi.fn(async () => undefined),
			getPropertyTypes: () => ({}),
			getVault: vi.fn(async () => ''),
			routeCapture,
			recordSave: vi.fn(async () => undefined),
			compileTemplate: simpleCompiler,
		})).rejects.toThrow('No article content was extracted');

		expect(routeCapture).not.toHaveBeenCalled();
	});
});
