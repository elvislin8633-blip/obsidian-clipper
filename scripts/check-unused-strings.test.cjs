const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exercise the real CLI against isolated fixtures without moving real locales.
function runCheck(t, messages) {
	const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-locale-check-'));
	t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
	fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
	fs.mkdirSync(path.join(fixture, 'src/_locales/en'), { recursive: true });
	fs.copyFileSync(path.join(__dirname, 'check-unused-strings.ts'), path.join(fixture, 'scripts/check-unused-strings.ts'));
	fs.writeFileSync(path.join(fixture, 'src/example.ts'), "getMessage('used');\n");
	if (messages !== undefined) {
		fs.writeFileSync(path.join(fixture, 'src/_locales/en/messages.json'), messages);
	}
	return spawnSync(process.execPath, ['-r', require.resolve('ts-node/register'), path.join(fixture, 'scripts/check-unused-strings.ts')], {
		encoding: 'utf8',
		env: { ...process.env, TS_NODE_PROJECT: path.join(__dirname, 'tsconfig.json') },
	});
}

test('reads _locales and reports unused strings without failing', t => {
	const result = runCheck(t, JSON.stringify({ used: { message: 'Used' }, unused: { message: 'Unused' } }));
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Total strings: 2/);
	assert.match(result.stdout, /Unused strings: 1/);
});

test('missing English source exits nonzero', t => {
	const result = runCheck(t);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /ENOENT/);
});

test('invalid JSON exits nonzero', t => {
	const result = runCheck(t, '{ invalid json');
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /SyntaxError/);
});
