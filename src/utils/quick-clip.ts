import { Template, Property } from '../types/types';
import { buildVariables, formatPropertyValue, generateFrontmatter } from './shared';
import { sanitizeFileName, unescapeValue } from './string-utils';
import type { ContentResponse } from './content-extractor';
import {
	createCaptureId,
	type CaptureContext,
	type CapturePayload,
	type RoutingResult,
} from '../capture/contracts';

export type QuickClipPageData = ContentResponse;

export type QuickClipCompiler = (
	tabId: number,
	text: string,
	variables: { [key: string]: any },
	currentUrl: string
) => Promise<string>;

export interface QuickClipNote {
	noteName: string;
	path: string;
	fileContent: string;
	properties: Property[];
	variables: Record<string, string>;
}

export interface QuickClipResult extends QuickClipNote {
	vault: string;
	template: Template;
	url: string;
	title: string;
	routingResult: RoutingResult;
}

export interface QuickClipDependencies {
	getTab: (tabId: number) => Promise<{ url?: string }>;
	ensureContentScriptLoaded: (tabId: number) => Promise<void>;
	extractPageContent: (tabId: number) => Promise<QuickClipPageData | null>;
	loadTemplates: () => Promise<Template[]>;
	initializeTriggers: (templates: Template[]) => void;
	findMatchingTemplate: (
		url: string,
		getSchemaOrgData: () => Promise<any>
	) => Promise<Template | undefined>;
	getPropertyTypes: () => Record<string, string>;
	getVault: (template: Template) => Promise<string>;
	routeCapture: (payload: CapturePayload, context: CaptureContext) => Promise<RoutingResult>;
	recordSave: (vault: string, path: string, url: string, title: string) => Promise<void>;
	rememberVault?: (vault: string) => Promise<void>;
	compileTemplate: QuickClipCompiler;
}

function createVariables(page: QuickClipPageData, currentUrl: string): Record<string, string> {
	return buildVariables({
		title: page.title,
		author: page.author,
		content: page.markdownContent,
		contentHtml: page.content,
		url: currentUrl,
		fullHtml: page.fullHtml,
		description: page.description,
		favicon: page.favicon,
		image: page.image,
		published: page.published,
		site: page.site,
		language: page.language,
		wordCount: page.wordCount,
		schemaOrgData: page.schemaOrgData,
		metaTags: page.metaTags,
		extractedContent: page.extractedContent,
	});
}

/**
 * Compile the same note parts that the popup displays, without depending on
 * popup DOM state. This is deliberately kept separate from browser APIs so it
 * can be tested with an injected compiler.
 */
export async function prepareQuickClipNote(options: {
	tabId: number;
	currentUrl: string;
	page: QuickClipPageData;
	template: Template;
	propertyTypes: Record<string, string>;
	compileTemplate: QuickClipCompiler;
}): Promise<QuickClipNote> {
	const { tabId, currentUrl, page, template, propertyTypes } = options;
	const compile = options.compileTemplate;
	const variables = createVariables(page, currentUrl);

	const [compiledProperties, compiledNoteName, compiledPath, compiledContent] = await Promise.all([
		Promise.all((template.properties || []).map(async (property) => {
			const templateValue = unescapeValue(property.value);
			const value = await compile(tabId, templateValue, variables, currentUrl);
			const type = propertyTypes[property.name] || property.type || 'text';
			return {
				...property,
				value: formatPropertyValue(value, type, templateValue),
				type: property.type,
			};
		})),
		compile(tabId, template.noteNameFormat, variables, currentUrl),
		template.behavior === 'append-daily' || template.behavior === 'prepend-daily'
			? Promise.resolve('')
			: compile(tabId, template.path, variables, currentUrl),
		template.noteContentFormat
			? compile(tabId, template.noteContentFormat, variables, currentUrl)
			: Promise.resolve(''),
	]);

	const noteName = sanitizeFileName(compiledNoteName.trim()) || 'Untitled';
	const frontmatter = generateFrontmatter(compiledProperties, propertyTypes);

	return {
		noteName,
		path: compiledPath.trim(),
		fileContent: frontmatter + compiledContent,
		properties: compiledProperties,
		variables,
	};
}

/**
 * Execute the non-UI Quick Clip flow. Browser-specific operations are passed
 * in as dependencies so the orchestration remains independently testable.
 */
export async function executeQuickClip(
	tabId: number,
	dependencies: QuickClipDependencies
): Promise<QuickClipResult> {
	const tab = await dependencies.getTab(tabId);
	const currentUrl = tab.url;
	if (!currentUrl) {
		throw new Error('The active tab has no URL');
	}

	await dependencies.ensureContentScriptLoaded(tabId);
	const page = await dependencies.extractPageContent(tabId);
	if (!page || !page.markdownContent.trim()) {
		throw new Error('No article content was extracted');
	}

	const templates = await dependencies.loadTemplates();
	if (templates.length === 0) {
		throw new Error('No clipping templates are available');
	}
	dependencies.initializeTriggers(templates);

	const template = await dependencies.findMatchingTemplate(
		currentUrl,
		async () => page.schemaOrgData
	) || templates[0];

	const note = await prepareQuickClipNote({
		tabId,
		currentUrl,
		page,
		template,
		propertyTypes: dependencies.getPropertyTypes(),
		compileTemplate: dependencies.compileTemplate,
	});
	const vault = await dependencies.getVault(template);
	const context: CaptureContext = {
		captureId: createCaptureId(),
		capturedAt: new Date().toISOString(),
		intent: 'reference',
		source: {
			url: currentUrl,
			title: page.title,
			selection: page.selectedHtml || undefined,
			author: page.author || undefined,
			site: page.site || undefined,
			published: page.published || undefined,
		},
	};
	const routingResult = await dependencies.routeCapture({
		fileContent: note.fileContent,
		noteName: note.noteName,
		path: note.path,
		vault,
		behavior: template.behavior,
		templateId: template.id,
	}, context);

	// Saving is the success boundary. Stats/history should not make a second
	// save happen through the popup fallback if storage is temporarily blocked.
	try {
		await dependencies.recordSave(vault, note.path, currentUrl, page.title);
	} catch (error) {
		console.warn('Quick Clip saved, but recording history failed:', error);
	}
	if (dependencies.rememberVault) {
		try {
			await dependencies.rememberVault(vault);
		} catch (error) {
			console.warn('Quick Clip saved, but remembering the vault failed:', error);
		}
	}

	return {
		...note,
		vault,
		template,
		url: currentUrl,
		title: page.title,
		routingResult,
	};
}
