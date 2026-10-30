// Optional integration smoke: build first; provide PLAYWRIGHT_MODULE if Playwright
// is installed outside this checkout. Uses a disposable profile and local article.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { compressToUTF16 } = require('lz-string');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright');
const en = require('../src/_locales/en/messages.json');
const checks = [];
const mark = (name, detail) => { checks.push({ name, detail }); console.log('PASS', name); };

function record(id) {
	const time = '2026-09-11T00:00:00.000Z';
	return {
		schemaVersion: 1, recordId: id, status: 'queued', queuedAt: time, destination: 'research_queue',
		context: { captureId: id, capturedAt: time, intent: 'research', source: { url: 'https://example.test/', title: id } },
		metadata: { capture_id: id, capture_intent: 'research', capture_destination: 'research_queue', capture_captured_at: time },
		payload: { fileContent: `# ${id}`, noteName: id, templateId: 'smoke' },
	};
}

(async () => {
	fs.mkdirSync(output, { recursive: true });
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-integration-'));
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end('<!doctype html><html><head><title>Capture smoke article</title></head><body><main><article><h1>Capture smoke article</h1><p>A local article for testing reliable knowledge capture. Research material should remain available after simultaneous captures from separate extension pages.</p><p>This fixture contains no private information and never sends an Obsidian URI to the operating system.</p></article></main></body></html>');
	});
	let context;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		context = await chromium.launchPersistentContext(profile, {
			channel: 'chromium', headless: true,
			args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`],
		});
		const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
		const extension = new URL(worker.url()).host;
		const settings = await context.newPage();
		await settings.goto(`chrome-extension://${extension}/settings.html`);
		await settings.evaluate(() => chrome.storage.local.set({ language: 'en' }));
		const article = await context.newPage();
		const articleUrl = `http://127.0.0.1:${server.address().port}/article`;
		await article.goto(articleUrl);
		const articleId = await settings.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, articleUrl);
		async function openEditor(saveBehavior = 'addToObsidian', behavior = 'create') {
			const template = { id: 'smoke', name: 'Smoke template', behavior, noteNameFormat: '{{title}}', path: 'Clippings', noteContentFormat: '{{content}}', properties: [], triggers: [], context: '' };
			await settings.evaluate(async data => {
				await chrome.storage.sync.set({ general_settings: { saveBehavior: data.saveBehavior, legacyMode: true }, template_list: ['smoke'], template_smoke: [data.compressed] });
			}, { saveBehavior, compressed: compressToUTF16(JSON.stringify(template)) });
			const page = await context.newPage();
			await page.setViewportSize({ width: 380, height: 700 });
			page.on('pageerror', error => console.error('Popup error:', error.message));
			// Intercept only the OS handoff boundary. Extraction, Router, UI, and
			// queue messages still execute the real production extension code.
			await page.addInitScript(() => {
				const original = chrome.runtime.sendMessage.bind(chrome.runtime);
				window.smokeHandoffs = [];
				chrome.runtime.sendMessage = (...args) => {
					if (args[0]?.action === 'openObsidianUrl') {
						window.smokeHandoffs.push(args[0].url);
						const result = { success: false, error: 'Smoke: handoff rejected' };
						const callback = args[args.length - 1];
						if (typeof callback === 'function') { callback(result); return; }
						return Promise.resolve(result);
					}
					return original(...args);
				};
			});
			await page.goto(`chrome-extension://${extension}/popup.html?tabId=${articleId}`);
			await page.waitForFunction(() => document.querySelector('#capture-intent-select')?.options.length === 5 && document.querySelector('#clip-btn')?.textContent.trim());
			await page.waitForFunction(() => document.querySelector('#note-name-field')?.value.includes('Capture smoke article'), undefined, { timeout: 15000 }).catch(async error => {
				console.error(await page.locator('body').ariaSnapshot());
				await page.screenshot({ path: path.join(output, 'smoke-failure.png'), fullPage: true });
				throw error;
			});
			assert.match(await page.locator('#note-name-field').inputValue(), /Capture smoke article/);
			return page;
		}

		const intents = ['reference', 'read_later', 'research', 'knowledge', 'project_material'];
		const actionKeys = ['captureActionReference', 'captureActionReadLater', 'captureActionResearch', 'captureActionKnowledge', 'captureActionProjectMaterial'];
		for (const saveBehavior of ['addToObsidian', 'copyToClipboard', 'saveFile']) {
			const page = await openEditor(saveBehavior);
			for (const intent of intents) {
				await page.locator('#capture-intent-select').selectOption(intent);
				const button = await page.locator('#clip-btn').innerText();
				const destination = await page.locator('#capture-destination').innerText();
				if (saveBehavior !== 'addToObsidian') {
					assert.equal(button, en[saveBehavior].message);
					assert.ok(!destination.includes(en.captureDestinationResearchQueue.message), destination);
					assert.match(await page.locator('.secondary-actions').innerText(), new RegExp(en[actionKeys[intents.indexOf(intent)]].message));
				} else if (intent === 'research') {
					assert.equal(button, en.captureActionResearch.message);
					assert.ok(destination.includes(en.captureDestinationResearchQueue.message), destination);
				} else {
					assert.equal(button, en.addToObsidian.message);
					assert.ok(destination.includes(en.captureDestinationObsidian.message), destination);
				}
			}
			await page.close();
		}
		mark('15 intent / primary-action combinations');

		for (const behavior of ['append-daily', 'prepend-daily']) {
			for (const intent of ['read_later', 'knowledge']) {
				const page = await openEditor('addToObsidian', behavior);
				await page.locator('#capture-intent-select').selectOption(intent);
				await page.locator('#clip-btn').click();
				await page.locator('.capture-error').waitFor({ state: 'visible' });
				assert.match(await page.locator('.capture-error').innerText(), /Smoke: handoff rejected/);
				const urls = await page.evaluate(() => window.smokeHandoffs);
				assert.equal(urls.length, 1);
				assert.equal(new URL(urls[0]).searchParams.get('file'), 'Inbox/Capture smoke article');
				assert.equal(await page.locator('#clip-btn').isEnabled(), true);
				await page.close();
			}
		}
		mark('4 daily / Inbox combinations and rejected handoff error UI');

		const research = await openEditor();
		await research.locator('#capture-intent-select').selectOption('research');
		await research.screenshot({ path: path.join(output, 'research-capture.png'), fullPage: true });
		await research.locator('#clip-btn').click();
		await research.waitForEvent('close');
		const initial = await settings.evaluate(async () => (await chrome.storage.local.get('research_queue_v1')).research_queue_v1);
		assert.equal(initial.length, 1);
		assert.equal(initial[0].context.intent, 'research');
		mark('real popup Research delivery');

		const other = await context.newPage();
		await other.goto(`chrome-extension://${extension}/settings.html`);
		const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? settings : other).evaluate(
			data => chrome.runtime.sendMessage({ action: 'researchQueueAppend', record: data }), record(`parallel-${i}`))));
		assert.ok(responses.every(response => response.success === true));
		const queue = await settings.evaluate(async () => (await chrome.storage.local.get('research_queue_v1')).research_queue_v1);
		assert.equal(queue.length, 21);
		assert.equal(new Set(queue.map(item => item.recordId)).size, 21);
		mark('20 concurrent appends across two extension pages', { retained: queue.length });
		const invalid = await other.evaluate(() => chrome.runtime.sendMessage({ action: 'researchQueueAppend', record: {} }));
		assert.equal(invalid.success, false);
		assert.equal((await other.evaluate(data => chrome.runtime.sendMessage({ action: 'researchQueueAppend', record: data }), record('after-invalid'))).success, true);
		assert.equal((await settings.evaluate(() => chrome.runtime.sendMessage({ action: 'researchQueueClear' }))).success, true);
		const cleared = await settings.evaluate(async () => (await chrome.storage.local.get('research_queue_v1')).research_queue_v1);
		assert.deepEqual(cleared, []);
		mark('invalid request recovery and serialized clear');
		const bundleHashes = Object.fromEntries(['popup.js', 'background.js'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, 'dist', file))).digest('hex')]));
		fs.writeFileSync(path.join(output, 'capture-smoke.json'), JSON.stringify({ date: new Date().toISOString(), browser: context.browser().version(), bundleHashes, checks, limitations: ['OS handoff is intercepted; no Obsidian disk-write verification.', 'Disposable Chromium profile; no Firefox/Safari runtime coverage.'] }, null, 2));
	} finally {
		if (context) await context.close();
		await new Promise(resolve => server.close(resolve));
		fs.rmSync(profile, { recursive: true, force: true });
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
