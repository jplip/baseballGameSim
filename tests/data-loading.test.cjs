const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'script.js'), 'utf8');
const fallback = fs.readFileSync(path.join(root, 'data/local-data.js'), 'utf8');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
const files = {
	'positions.json': readJson('positions.json'),
	'teams.json': readJson('teams.json'),
	'player-names.json': readJson('player-names.json'),
	'stat-defaults.json': readJson('stat-defaults.json'),
};

async function start({ protocol = 'http:', fetcher, includeFallback = true, storage = new Map(), storageUnavailable = false } = {}) {
	const elements = new Map();
	const requests = [];
	const errors = [];
	const handlers = new Map();
	const context = vm.createContext({
		window: { location: { protocol }, localStorage: {
			getItem(key) { if (storageUnavailable) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
			setItem(key, value) { if (storageUnavailable) throw new Error('Storage blocked'); storage.set(key, value); },
		} },
		console: { error: (error) => errors.push(error) },
		document: {
			addEventListener(type, handler) {
				if (!handlers.has(type)) handlers.set(type, []);
				handlers.get(type).push(handler);
			},
			querySelectorAll: () => [],
			querySelector(selector) {
				if (!elements.has(selector)) elements.set(selector, {});
				return elements.get(selector);
			},
		},
		fetch: async (url, options) => {
			requests.push({ url, options });
			if (fetcher) return fetcher(url);
			return {
				ok: true,
				json: async () => structuredClone(files[url.replace('data/', '')]),
			};
		},
	});
	if (includeFallback) vm.runInContext(fallback, context);
	vm.runInContext(fs.readFileSync(path.join(root, 'scripts/manage.js'), 'utf8'), context);
	await vm.runInContext(source, context);
	return { context, elements, requests, errors, handlers };
}

test('HTTP startup loads all JSON, builds the original roster, and isolates stats', async () => {
	const { context, requests, elements, errors } = await start();
	assert.equal(errors.length, 0);
	assert.deepEqual(
		requests.map(({ url }) => url).sort(),
		Object.keys(files)
			.map((name) => `data/${name}`)
			.sort(),
	);
	assert.ok(requests.every(({ options }) => options.cache === 'no-cache'));
	assert.equal(vm.runInContext('ready', context), true);
	assert.equal(vm.runInContext('teams.length', context), 4);
	assert.equal(vm.runInContext('teams.flatMap(t => t.players).length', context), 76);
	assert.equal(vm.runInContext('teams[0].players[0].name', context), 'Theo Morrow');
	assert.equal(
		vm.runInContext('new Set(teams.flatMap(t => t.players.map(p => p.id))).size', context),
		76,
	);
	assert.match(elements.get('#screen-home').innerHTML, /Harbor Hawks/);
	vm.runInContext('renderManage(); renderPlayers(); newGame();', context);
	vm.runInContext(
		'teams[0].players[0].season.h = 2; state.game.pitchers.harbor.ha = 3;',
		context,
	);
	assert.equal(vm.runInContext('teams[0].players[1].season.h', context), 0);
	assert.equal(vm.runInContext('STAT_DEFAULTS.season.h', context), 0);
	assert.equal(vm.runInContext('state.game.pitchers.foundry.ha', context), 0);
	assert.equal(vm.runInContext('STAT_DEFAULTS.pitching.ha', context), 0);
});

test('direct-file startup uses the generated fallback without fetching', async () => {
	const { context, requests, errors } = await start({ protocol: 'file:' });
	assert.equal(errors.length, 0);
	assert.equal(requests.length, 0);
	assert.equal(vm.runInContext('ready && teams.length === 4', context), true);
	const data = JSON.parse(vm.runInContext('JSON.stringify(window.DIAMOND_LOCAL_DATA)', context));
	assert.deepEqual(data, {
		positions: files['positions.json'],
		teams: files['teams.json'],
		names: files['player-names.json'],
		statDefaults: files['stat-defaults.json'],
	});
});

test('HTTP startup uses edited JSON instead of the local fallback', async () => {
	const { context, errors } = await start({
		fetcher: async (url) => ({
			ok: true,
			json: async () => {
				const data = structuredClone(files[url.replace('data/', '')]);
				if (url === 'data/teams.json') data[0].name = 'Updated Club';
				return data;
			},
		}),
	});
	assert.equal(errors.length, 0);
	assert.equal(vm.runInContext('teams[0].name', context), 'Updated Club');
});

test('missing files, invalid JSON, invalid configuration, and missing fallback show errors', async () => {
	const cases = [
		{ options: { fetcher: async () => ({ ok: false, status: 404 }) }, message: /HTTP 404/ },
		{
			options: {
				fetcher: async () => ({
					ok: true,
					json: async () => {
						throw new SyntaxError();
					},
				}),
			},
			message: /valid JSON/,
		},
		{
			options: {
				fetcher: async (url) => ({
					ok: true,
					json: async () =>
						url === 'data/positions.json' ? ['P'] : files[url.replace('data/', '')],
				}),
			},
			message: /nine unique positions/,
		},
		{
			options: { protocol: 'file:', includeFallback: false },
			message: /scripts\/build-data.cjs/,
		},
	];
	for (const { options, message } of cases) {
		const { context, elements, errors } = await start(options);
		assert.equal(vm.runInContext('ready', context), false);
		assert.equal(errors.length, 1);
		assert.match(elements.get('#screen-home').textContent, message);
	}
});

// Exercise editing against real generated rosters, independent of rendering details.
function editContext(context) {
	vm.runInContext('renderManage = () => {}; showToast = () => {};', context);
	return (code) => vm.runInContext(code, context);
}
function assertSquadValid(run) {
	assert.equal(run('validTeamSetup(teams[0], teams[0])'), true);
	assert.equal(run('teams[0].starterId === teams[0].positions.P'), true);
	assert.equal(run('teams[0].relieverIds.includes(teams[0].starterId)'), false);
}

test('defensive swaps preserve batting order; bench substitutions replace the same batting slot', async () => {
	const { context } = await start();
	const run = editContext(context);
	run('const originalOrder = [...teams[0].lineup]; const originalSS = teams[0].positions.SS; const original2B = teams[0].positions["2B"];');
	assert.equal(run('assignDefense(teams[0], originalSS, "2B")'), true);
	assert.equal(run('teams[0].positions.SS === original2B && teams[0].positions["2B"] === originalSS'), true);
	assert.equal(run('JSON.stringify(teams[0].lineup) === JSON.stringify(originalOrder)'), true);
	assert.equal(run('assignDefense(teams[0], teams[0].players[9].id, "SS")'), true);
	assert.equal(run('teams[0].lineup[originalOrder.indexOf(original2B)] === teams[0].players[9].id'), true);
	assert.equal(run('teams[0].lineup.includes(original2B)'), false);
	assert.equal(run('teams[0].setupDirty'), true);
	assertSquadValid(run);
});

test('batting reorders leave defense untouched and substitutions keep the same nine on both sides', async () => {
	const { context } = await start();
	const run = editContext(context);
	run('const defenseBefore = JSON.stringify(teams[0].positions); const leadoff = teams[0].lineup[0];');
	assert.equal(run('assignBattingSpot(teams[0], leadoff, 8)'), true);
	assert.equal(run('teams[0].lineup[8] === leadoff'), true);
	assert.equal(run('JSON.stringify(teams[0].positions) === defenseBefore'), true);
	assert.equal(run('assignBattingSpot(teams[0], teams[0].players[9].id, 0)'), true);
	assert.equal(run('teams[0].positions.C === teams[0].players[9].id'), true);
	assertSquadValid(run);
});

test('pitcher substitutions update the game starter and reject incompatible assignments without mutation', async () => {
	const { context } = await start();
	const run = editContext(context);
	run('const before = JSON.stringify(teams[0]);');
	assert.equal(run('assignDefense(teams[0], teams[0].players[9].id, "P")'), false);
	assert.equal(run('assignDefense(teams[0], teams[0].players[15].id, "CF")'), false);
	assert.equal(run('assignDefense(teams[0], "missing-player", "P")'), false);
	assert.equal(run('assignBattingSpot(teams[0], teams[0].players[9].id, -1)'), false);
	assert.equal(run('JSON.stringify(teams[0]) === before'), true);
	assert.equal(run('assignDefense(teams[0], teams[0].players[15].id, "P")'), true);
	run('newGame();');
	assert.equal(run('currentPitcher().id === teams[1].starterId'), true);
	run('state.game.half = "bottom";');
	assert.equal(run('currentPitcher().id === teams[0].players[15].id'), true);
	assertSquadValid(run);
});

test('saved club rosters survive reloads and legacy positioning normalizes to standard defense', async () => {
	const storage = new Map();
	const first = await start({ storage });
	const run = editContext(first.context);
	run('assignDefense(teams[0], teams[0].players[9].id, "CF"); assignBattingSpot(teams[0], teams[0].players[9].id, 0); saveTeamSetup(teams[0]);');
	run('assignDefense(teams[1], teams[1].players[15].id, "P"); saveTeamSetup(teams[1]);');
	assert.equal(run('teams[0].setupDirty || teams[1].setupDirty'), false);
	// Simulate setups saved before alternate positioning was removed.
	const saved = JSON.parse(storage.get('diamond-office.squads.v1'));
	saved.harbor.formation = 'double-play';
	saved.foundry.formation = 'outfield-deep';
	storage.set('diamond-office.squads.v1', JSON.stringify(saved));
	const second = await start({ storage });
	const restored = editContext(second.context);
	for (const index of [0, 1]) {
		assert.equal(restored(`JSON.stringify(teams[${index}].lineup)`), run(`JSON.stringify(teams[${index}].lineup)`));
		assert.equal(restored(`JSON.stringify(teams[${index}].positions)`), run(`JSON.stringify(teams[${index}].positions)`));
		assert.equal(restored(`teams[${index}].formation`), 'standard');
	}
	assertSquadValid(restored);
	restored('saveTeamSetup(teams[0]);');
	assert.equal(JSON.parse(storage.get('diamond-office.squads.v1')).harbor.formation, 'standard');
});

test('corrupt or unavailable saved storage cannot prevent startup or damage a roster', async () => {
	for (const value of ['{bad JSON', 'null', '[]', JSON.stringify({ harbor: { formation: 'standard', lineup: Array(9).fill('p1'), positions: {} } })]) {
		const { context, errors } = await start({ storage: new Map([['diamond-office.squads.v1', value]]) });
		const run = editContext(context);
		assert.equal(errors.length, 0);
		assert.equal(run('ready && teams[0].formation === "standard"'), true);
		assertSquadValid(run);
	}
	const { context, errors } = await start({ storageUnavailable: true });
	const run = editContext(context);
	run('teams[0].setupDirty = true; saveTeamSetup(teams[0]);');
	assert.equal(errors.length, 0);
	assert.equal(run('teams[0].setupDirty'), true);
	assertSquadValid(run);
});


test('drag events substitute bench players and reorder batting without changing defense', async () => {
	const { context, handlers } = await start();
	const run = editContext(context);
	run('state.screen = "manage";');
	const element = (dataset) => {
		const el = { dataset, classList: { add() {}, remove() {} } };
		return { closest: () => el };
	};
	const transfer = { effectAllowed: '', dropEffect: '', setData() {} };
	const drag = (source, target) => {
		for (const handler of handlers.get('dragstart')) handler({ target: element(source), dataTransfer: transfer });
		for (const handler of handlers.get('dragover')) handler({ target: element(target), dataTransfer: transfer, preventDefault() {} });
		assert.equal(transfer.effectAllowed, 'move');
		assert.equal(transfer.dropEffect, 'move');
		for (const handler of handlers.get('drop')) handler({ target: element(target), preventDefault() {} });
		assert.equal(run('manageDrag'), null);
	};
	drag({ squadPlayer: 'p10', squadZone: 'bench' }, { squadPlayer: 'p7', squadZone: 'field', fieldPosition: 'LF' });
	assert.equal(run('teams[0].positions.LF'), 'p10');
	run('const originalDefense = JSON.stringify(teams[0].positions);');
	drag({ squadPlayer: 'p9', squadZone: 'batting' }, { squadPlayer: 'p1', squadZone: 'batting', battingIndex: '0' });
	assert.equal(run('teams[0].lineup[0]'), 'p9');
	assert.equal(run('JSON.stringify(teams[0].positions) === originalDefense'), true);
	assertSquadValid(run);
});
