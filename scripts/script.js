/* Diamond Office: a deliberately self-contained foundation for a larger franchise sim. */
// Configuration is loaded before the roster is generated or the UI becomes interactive.
let POSITIONS;
let TEAM_SEEDS;
let FIRST;
let LAST;
let STAT_DEFAULTS;
let ready = false;

async function loadGameData() {
	// Browsers block fetch() of neighboring files when index.html uses file://.
	if (window.location.protocol === 'file:') {
		if (!window.DIAMOND_LOCAL_DATA) {
			throw new Error('Local game data is missing. Run node scripts/build-data.cjs.');
		}
		return window.DIAMOND_LOCAL_DATA;
	}

	const readJson = async (filename) => {
		const response = await fetch(`data/${filename}`, { cache: 'no-cache' });
		if (!response.ok) {
			throw new Error(`Could not load data/${filename} (HTTP ${response.status}).`);
		}
		try {
			return await response.json();
		} catch {
			throw new Error(`data/${filename} does not contain valid JSON.`);
		}
	};

	const [positions, teams, names, statDefaults] = await Promise.all([
		readJson('positions.json'),
		readJson('teams.json'),
		readJson('player-names.json'),
		readJson('stat-defaults.json'),
	]);

	return { positions, teams, names, statDefaults };
}

function validateGameData(data) {
	const isNameList = (list) =>
		Array.isArray(list) &&
		list.length > 0 &&
		list.every((value) => typeof value === 'string' && value.trim().length > 0);

	if (
		!isNameList(data.positions) ||
		data.positions.length !== 9 ||
		new Set(data.positions).size !== 9 ||
		data.positions[0] !== 'P'
	) {
		throw new Error('positions.json must contain nine unique positions, starting with P.');
	}
	if (
		!Array.isArray(data.teams) ||
		data.teams.length < 2 ||
		new Set(data.teams.map((team) => team?.id)).size !== data.teams.length ||
		!data.teams.every(
			(team) =>
				team &&
				['id', 'name', 'abbr', 'city', 'record'].every(
					(key) => typeof team[key] === 'string' && team[key].trim().length > 0,
				) &&
				Array.isArray(team.colors) &&
				team.colors.length === 2 &&
				team.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)),
		)
	) {
		throw new Error(
			'teams.json requires at least two clubs with unique IDs and two hex colors.',
		);
	}
	if (!isNameList(data.names?.first) || !isNameList(data.names?.last)) {
		throw new Error('player-names.json requires nonempty first and last name lists.');
	}
	const requiredStats = {
		season: ['ab', 'h', 'r', 'rbi', 'hr', 'bb', 'k', 'ip', 'ha', 'ra', 'er', 'hrAllowed'],
		pitching: ['ip', 'ha', 'ra', 'er', 'bb', 'k', 'hr'],
	};
	for (const [group, keys] of Object.entries(requiredStats)) {
		if (!keys.every((key) => data.statDefaults?.[group]?.[key] === 0)) {
			throw new Error(`stat-defaults.json must define zero values for all ${group} stats.`);
		}
	}
}

async function initializeGame() {
	$('#screen-home').textContent = 'Loading clubs and rosters…';
	try {
		const data = await loadGameData();
		validateGameData(data);
		POSITIONS = data.positions;
		TEAM_SEEDS = data.teams;
		FIRST = data.names.first;
		LAST = data.names.last;
		STAT_DEFAULTS = data.statDefaults;
		teams = createTeams();
		restoreTeamSetups();
		state.manageTeamId = teams[0].id;
		ready = true;
		render();
	} catch (error) {
		$('#screen-home').textContent = `Unable to start the game: ${error.message}`;
		console.error(error);
	}
}

let idCounter = 1;
function makePlayer(teamIndex, number, position, pitcher = false) {
	const n = idCounter++;
	let base = 62 + ((n * 13 + teamIndex * 7) % 27);
	return {
		id: `p${n}`,
		name: `${FIRST[(n * 3 + teamIndex) % FIRST.length]} ${LAST[(n * 5 + teamIndex) % LAST.length]}`,
		age: 22 + (n % 15),
		number,
		position,
		teamId: TEAM_SEEDS[teamIndex].id,
		type: pitcher
			? 'Power Pitcher'
			: position === 'C'
				? 'Defensive Catcher'
				: base > 78
					? 'Complete Hitter'
					: 'Contact Hitter',
		ratings: pitcher
			? { velocity: base + 7, control: base - 2, movement: base + 3, stamina: 65 + (n % 25) }
			: {
					contact: base,
					power: base - 4 + ((n * 3) % 15),
					discipline: base - 3 + ((n * 5) % 14),
					speed: base - 10 + ((n * 7) % 22),
					clutch: base - 4 + ((n * 2) % 17),
					fielding: base - 2 + ((n * 11) % 16),
					arm: base - 5 + ((n * 13) % 18),
					reaction: base - 3 + ((n * 17) % 15),
				},
		// Each player needs an independent copy of the JSON stat template.
		season: { ...STAT_DEFAULTS.season },
	};
}
function createTeams() {
	return TEAM_SEEDS.map((t, ti) => {
		const players = [];
		let number = 1;
		POSITIONS.forEach((p, i) => players.push(makePlayer(ti, number++, p, p === 'P')));
		for (let i = 0; i < 6; i++) players.push(makePlayer(ti, number++, 'UTIL'));
		for (let i = 0; i < 4; i++) players.push(makePlayer(ti, number++, 'RP', true));
		return {
			...t,
			players,
			lineup: players.slice(0, 9).map((p) => p.id),
			positions: Object.fromEntries(POSITIONS.map((p, i) => [p, players[i].id])),
			starterId: players[0].id,
			relieverIds: players
				.filter((p) => p.position === 'RP')
				.slice(0, 3)
				.map((p) => p.id),
		};
	});
}
let teams = [];
let state = { screen: 'home', manageTeamId: null, playerFilter: 'all', game: null };
const $ = (s) => document.querySelector(s),
	$$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
	String(s).replace(
		/[&<>'"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
	);
function team(id) {
	return teams.find((t) => t.id === id);
}
function player(id) {
	return teams.flatMap((t) => t.players).find((p) => p.id === id);
}
function logo(t, small = false) {
	return /* HTML */ `<span
		class="logo${small ? ' sm' : ''}"
		style="background:linear-gradient(135deg,${t.colors[0]},${t.colors[1]})"
		>${t.abbr}</span
	>`;
}
function avg(p) {
	const r = p.ratings;
	return Math.round(Object.values(r).reduce((a, b) => a + b, 0) / Object.values(r).length);
}
function ratingBars(p) {
	return Object.entries(p.ratings)
		.map(
			([k, v]) =>
				/* HTML */ `<div class="rating-bar">
					<label
						><span
							>${k === 'discipline'
								? 'plate discipline'
								: k === 'arm'
									? 'arm strength'
									: k}</span
						><b>${v}</b></label
					>
					<div class="bar"><i style="width:${v}%"></i></div>
				</div>`,
		)
		.join('');
}
function render() {
	$$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${state.screen}`));
	$$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.screen === state.screen));
	if (state.screen === 'home') renderHome();
	if (state.screen === 'manage') renderManage();
	if (state.screen === 'players') renderPlayers();
	if (state.screen === 'game') renderGame();
	if (state.screen === 'postgame') renderPostgame();
}
function renderHome() {
	const next = teams[0],
		opp = teams[1];
	$('#screen-home').innerHTML = /* HTML */ `<div class="hero">
			<div>
				<div class="eyebrow">Manager workspace / preseason</div>
				<h1 class="page-title">Run the <span>diamond.</span></h1>
				<p class="lede">
					Build your lineup, read the matchups, and let the game breathe one pitch at a
					time. Your office is ready.
				</p>
			</div>
			<div class="hero-actions">
				<button class="btn ghost" data-screen="manage">Set Lineup</button
				><button class="btn primary" data-action="new-game">Start Exhibition</button>
			</div>
		</div>
		<div class="dash-grid">
			<div class="card matchup">
				<div class="matchup-top">
					<span>Next on the schedule</span><span>9 innings · Exhibition</span>
				</div>
				<div class="team-row">
					${logo(next)}
					<div>
						<div class="team-name">${next.name}</div>
						<div class="team-meta">${next.city} · Manager’s club</div>
					</div>
					<div class="score-preview">—</div>
				</div>
				<div class="versus">vs</div>
				<div class="team-row">
					${logo(opp)}
					<div>
						<div class="team-name">${opp.name}</div>
						<div class="team-meta">${opp.city} · Away</div>
					</div>
					<div class="score-preview">—</div>
				</div>
				<div class="matchup-footer">
					<span>First pitch · Ready when you are</span
					><button class="btn small primary" data-action="new-game">
						Open Game Center →
					</button>
				</div>
			</div>
			<div class="card stat-card">
				<h3>Office snapshot</h3>
				<div class="stat-line"><span>Clubs in universe</span><b>04</b></div>
				<div class="stat-line">
					<span>Players on file</span
					><b>${teams.reduce((a, t) => a + t.players.length, 0)}</b>
				</div>
				<div class="stat-line">
					<span>Last game</span><b>${state.game?.ended ? 'Final' : '—'}</b>
				</div>
				<div class="stat-line">
					<span>Engine status</span><b style="color:var(--green)">Online</b>
				</div>
			</div>
		</div>
		<div class="section-head">
			<div>
				<div class="eyebrow">The league</div>
				<h2>Club directory</h2>
			</div>
			<p>Choose a club to open its roster.</p>
		</div>
		<div class="team-grid">
			${teams
				.map(
					(t) =>
						/* HTML */ `<div class="card team-card" data-team="${t.id}">
							<div class="card-top">
								${logo(t)}<span class="rating"
									>${(t.players.slice(0, 9).reduce((a, p) => a + avg(p), 0) / 9) |
									0}
									OVR</span
								>
							</div>
							<h3>${t.name}</h3>
							<p>${t.city} · ${t.players.length} players</p>
						</div>`,
				)
				.join('')}
		</div>`;
}
function playerCard(p) {
	const t = team(p.teamId);
	return /* HTML */ `<article
		class="card player-card"
		style="--accent:${t.colors[0]}"
		data-player="${p.id}"
	>
		<div class="player-card-top">
			${logo(t, true)}<span class="rating-total">${avg(p)}</span>
		</div>
		<h3>${p.name}</h3>
		<div class="player-sub">#${p.number} · ${p.position} · ${p.age} yrs · ${p.type}</div>
		<div class="ratings">${ratingBars(p)}</div>
	</article>`;
}
function renderPlayers() {
	let list = teams.flatMap((t) => t.players);
	if (state.playerFilter !== 'all') list = list.filter((p) => p.teamId === state.playerFilter);
	$('#screen-players').innerHTML = /* HTML */ `<div class="eyebrow">
			Scouting department / player database
		</div>
		<h1 class="page-title">Player <span>cards.</span></h1>
		<p class="lede">
			Every rating feeds the engine. Browse the league, compare profiles, and find the edge.
		</p>
		<div class="section-head">
			<div>
				<h2>League players <span class="rating">(${list.length})</span></h2>
			</div>
			<select class="pitch-select" id="player-filter">
				<option value="all">All clubs</option>
				${teams
					.map(
						(t) =>
							/* HTML */ `<option
								value="${t.id}"
								${state.playerFilter === t.id ? 'selected' : ''}
							>
								${t.name}
							</option>`,
					)
					.join('')}
			</select>
		</div>
		<div class="player-list">${list.map((p) => playerCard(p)).join('')}</div>`;
}
function newGame() {
	const away = teams[0],
		home = teams[1];
	state.game = {
		awayId: away.id,
		homeId: home.id,
		inning: 1,
		half: 'top',
		outs: 0,
		balls: 0,
		strikes: 0,
		bases: [null, null, null],
		scores: { [away.id]: 0, [home.id]: 0 },
		hits: { [away.id]: 0, [home.id]: 0 },
		errors: { [away.id]: 0, [home.id]: 0 },
		rbi: { [away.id]: 0, [home.id]: 0 },
		batters: { [away.id]: 0, [home.id]: 0 },
		pitchers: {
			[away.id]: { ...STAT_DEFAULTS.pitching },
			[home.id]: { ...STAT_DEFAULTS.pitching },
		},
		feed: [
			{
				text: `First pitch is moments away. ${away.name} visits ${home.name}.`,
				inning: 'PRE-GAME',
			},
		],
		ended: false,
		paused: false,
	};
	state.screen = 'game';
	render();
}
function currentTeam() {
	return team(state.game.half === 'top' ? state.game.awayId : state.game.homeId);
}
function defenseTeam() {
	return team(state.game.half === 'top' ? state.game.homeId : state.game.awayId);
}
function currentBatter() {
	const t = currentTeam();
	return player(t.lineup[state.game.batters[t.id] % t.lineup.length]);
}
function currentPitcher() {
	const t = defenseTeam();
	return player(t.starterId);
}
function renderGame() {
	const g = state.game;
	if (!g) return newGame();
	const away = team(g.awayId),
		home = team(g.homeId),
		bat = currentBatter(),
		pitch = currentPitcher(),
		scoreRows = [away, home]
			.map(
				(t) =>
					/* HTML */ `<div class="score-team">
						${logo(t, true)}<strong>${t.abbr}</strong
						><span class="big-score">${g.scores[t.id]}</span>
					</div>`,
			)
			.join('');
	$('#screen-game').innerHTML = /* HTML */ `<div class="game-header">
			<div>
				<div class="eyebrow">Game center / live simulation</div>
				<h1>${away.name} <span class="muted">at</span> ${home.name}</h1>
				<p class="lede">
					${g.ended ? 'Final' : 'Live exhibition'} ·
					${g.inning > 9 ? 'Extra innings' : `Inning ${g.inning}`} ·
					${g.half === 'top' ? 'Top' : 'Bottom'}
				</p>
			</div>
			<button class="btn ghost" data-screen="home">Exit game</button>
		</div>
		<div class="card scoreboard">
			${scoreRows}
			<div class="score-cell">
				<label>Inning</label><b>${g.inning}${g.half === 'top' ? ' ▲' : ' ▼'}</b>
			</div>
			<div class="score-cell"><label>Outs</label><b>${g.outs}</b></div>
			<div class="score-cell"><label>Count</label><b>${g.balls}-${g.strikes}</b></div>
		</div>
		<div class="game-grid" style="margin-top:18px">
			<div>
				<div class="card field-wrap">
					<div class="field">
						<div class="field-info">
							<span
								>${g.half === 'top' ? 'BATTING' : 'FIELDING'} ·
								${currentTeam().abbr}</span
							><span>${bat.name} vs ${pitch.name}</span>
						</div>
						<div class="diamond">
							<i class="base home"></i
							><i class="base first ${g.bases[0] ? 'occupied' : ''}"></i
							><i class="base second ${g.bases[1] ? 'occupied' : ''}"></i
							><i class="base third ${g.bases[2] ? 'occupied' : ''}"></i>
						</div>
						<span class="field-label pitcher">P · ${pitch.name.split(' ')[1]}</span
						><span class="field-label batter">${bat.name}</span
						><span class="field-label catcher">C</span>
					</div>
					<div class="controls">
						<button
							class="btn primary"
							data-action="at-bat"
							${g.ended || g.paused ? 'disabled' : ''}
						>
							${g.ended ? 'Game final' : 'Simulate next at-bat'}</button
						><button
							class="btn"
							data-action="half"
							${g.ended || g.paused ? 'disabled' : ''}
						>
							Half-inning</button
						><button
							class="btn"
							data-action="inning"
							${g.ended || g.paused ? 'disabled' : ''}
						>
							Full inning</button
						><button class="btn" data-action="game" ${g.ended ? 'disabled' : ''}>
							${g.paused ? 'Resume' : 'Simulate game'}</button
						><button class="btn" data-action="pause" ${g.ended ? 'disabled' : ''}>
							${g.paused ? 'Resume play' : 'Pause game'}
						</button>
					</div>
				</div>
				<div class="card play-feed">
					<div class="feed-head">
						<h3>Play-by-play</h3>
						<span class="rating">${g.feed.length} plays</span>
					</div>
					<div class="feed-list">
						${g.feed
							.slice()
							.reverse()
							.map(
								(f) =>
									/* HTML */ `<div class="feed-item">
										<time>${f.inning}</time>${esc(f.text)}
									</div>`,
							)
							.join('')}
					</div>
				</div>
			</div>
			<aside class="card play-feed">
				<div class="feed-head">
					<h3>At the plate</h3>
					<span class="rating"
						>${currentTeam().abbr} ${(g.batters[currentTeam().id] % 9) + 1}</span
					>
				</div>
				${playerCard(bat)}
				<div style="height:14px"></div>
				<div class="feed-head">
					<h3>On the mound</h3>
					<span class="rating">${defenseTeam().abbr}</span>
				</div>
				${playerCard(pitch)}
			</aside>
		</div>`;
}
function rnd() {
	return Math.random();
}
function addFeed(text) {
	const g = state.game;
	g.feed.push({ text, inning: `${g.inning}${g.half === 'top' ? ' ▲' : ' ▼'} · ${g.outs} OUT` });
}
function scoreRun(battingId, runner, reason) {
	state.game.scores[battingId]++;
	runner.season.r++;
	state.game.rbi[battingId]++;
	addFeed(`${runner.name} scores${reason ? ' — ' + reason : ''}!`);
}
function advanceRunners(battingId, bases) {
	const g = state.game,
		old = g.bases.slice();
	g.bases = [null, null, null];
	let scored = 0;
	for (let i = 2; i >= 0; i--) {
		if (!old[i]) continue;
		let dest = i + bases;
		if (dest >= 3) {
			scoreRun(battingId, old[i], 'runner advances');
			scored++;
		} else g.bases[dest] = old[i];
	}
	return scored;
}
function simulatePA() {
	const g = state.game;
	if (g.ended || g.paused) return;
	const bat = currentBatter(),
		pitch = currentPitcher(),
		off = currentTeam(),
		def = defenseTeam(),
		br = bat.ratings,
		pr = pitch.ratings;
	let contact = br.contact || 55,
		power = br.power || 45,
		discipline = br.discipline || 45;
	let outs = 0;
	for (let p = 0; p < 8; p++) {
		const zone = rnd(),
			pitcherEdge = ((pr.velocity || 65) + (pr.movement || 65)) / 2;
		if (zone < 0.025) {
			g.balls = 0;
			g.strikes = 0;
			bat.season.ab++;
			addFeed(`${bat.name} is hit by the pitch and takes first.`);
			if (g.bases[0]) advanceRunners(off.id, 1);
			g.bases[0] = bat;
			break;
		}
		if (zone < 0.27 + (100 - discipline) / 650 - (pr.control || 60) / 1200) {
			g.balls++;
			if (g.balls >= 4) {
				g.balls = 0;
				g.strikes = 0;
				g.pitchers[def.id].bb++;
				bat.season.bb++;
				const walked = g.bases[0];
				if (walked) {
					g.bases[0] = bat;
					const r2 = g.bases[1];
					if (r2) {
						g.bases[1] = walked;
						const r3 = g.bases[2];
						if (r3) {
							scoreRun(off.id, r3, 'bases loaded walk');
						} else g.bases[2] = r2;
					} else g.bases[1] = walked;
				} else g.bases[0] = bat;
				addFeed(`${bat.name} works a walk.`);
				break;
			}
			continue;
		}
		g.strikes++;
		if (g.strikes >= 3) {
			g.strikes = 0;
			g.balls = 0;
			g.outs++;
			g.pitchers[def.id].k++;
			bat.season.k++;
			addFeed(`${bat.name} strikes out swinging.`);
			outs = 1;
			break;
		}
		if (rnd() < 0.16 + pitcherEdge / 1000) {
			continue;
		}
		let quality = rnd() + contact / 250 - power / 700;
		let result =
			quality < 0.22
				? 'out'
				: quality < 0.54
					? 'single'
					: quality < 0.74
						? 'double'
						: quality < 0.87
							? 'triple'
							: 'hr';
		if (result === 'out') {
			g.outs++;
			bat.season.ab++;
			const kind = ['groundout', 'flyout', 'lineout'][Math.floor(rnd() * 3)];
			addFeed(
				`${bat.name} hits a ${kind} to the ${['left', 'center', 'right'][Math.floor(rnd() * 3)]}.`,
			);
			outs = 1;
			break;
		}
		g.balls = 0;
		g.strikes = 0;
		bat.season.ab++;
		bat.season.h++;
		g.hits[off.id]++;
		g.pitchers[def.id].ha++;
		let advance =
			result === 'single' ? 1 : result === 'double' ? 2 : result === 'triple' ? 3 : 4;
		if (result === 'hr') {
			g.pitchers[def.id].hr++;
			bat.season.hr++;
			advanceRunners(off.id, 4);
			scoreRun(off.id, bat, 'solo shot');
			addFeed(`${bat.name} launches a deep fly ball... IT'S GONE! HOME RUN!`);
		} else {
			const runs = advanceRunners(off.id, advance);
			g.bases[advance - 1] = bat;
			addFeed(
				`${bat.name} hits a ${result} to ${['left', 'center', 'right'][Math.floor(rnd() * 3)]} field${runs ? ' and runners score' : ''}.`,
			);
		}
		break;
	}
	if (!outs) {
	}
	g.batters[off.id]++;
	if (g.outs >= 3) endHalf();
	renderGame();
}
function endHalf() {
	const g = state.game;
	g.bases = [null, null, null];
	g.outs = 0;
	g.balls = 0;
	g.strikes = 0;
	if (g.half === 'top') {
		if (g.inning >= 9 && g.scores[g.awayId] > g.scores[g.homeId]) {
			finishGame();
			return;
		}
		g.half = 'bottom';
		addFeed(`${team(g.homeId).name} come to bat.`);
	} else {
		if (g.inning >= 9 && g.scores[g.homeId] !== g.scores[g.awayId]) {
			finishGame();
			return;
		}
		g.inning++;
		g.half = 'top';
		addFeed(`End of inning ${g.inning - 1}.`);
	}
}
function finishGame() {
	const g = state.game;
	g.ended = true;
	g.half = 'bottom';
	g.feed.push({
		text: `Final: ${team(g.awayId).name} ${g.scores[g.awayId]}, ${team(g.homeId).name} ${g.scores[g.homeId]}.`,
		inning: 'FINAL',
	});
	state.screen = 'postgame';
	render();
}
function runUntil(type) {
	const g = state.game;
	if (g.ended) return;
	const start = g.inning,
		half = g.half;
	let guard = 0;
	while (!g.ended && guard++ < 2000) {
		simulatePA();
		if (type === 'atbat') break;
		if (type === 'half' && (g.inning !== start || g.half !== half)) break;
		if (type === 'inning' && g.inning > start) break;
	}
	render();
}
function renderPostgame() {
	const g = state.game,
		away = team(g.awayId),
		home = team(g.homeId),
		winner = g.scores[away.id] > g.scores[home.id] ? away : home,
		loser = winner.id === away.id ? home : away;
	const table = (t) =>
		t.lineup
			.map((pid) => {
				const p = player(pid),
					s = p.season;
				return /* HTML */ `<tr>
					<td>${p.name}</td>
					<td>${s.ab}</td>
					<td>${s.h}</td>
					<td>${s.r}</td>
					<td>${s.rbi}</td>
					<td>${s.hr}</td>
					<td>${s.bb}</td>
					<td>${s.k}</td>
				</tr>`;
			})
			.join('');
	$('#screen-postgame').innerHTML = /* HTML */ `<div class="postgame-hero">
			<div class="eyebrow">Game center / final</div>
			<h1 class="page-title">Final <span>score.</span></h1>
			<div class="final-score">
				${logo(away)}<strong>${away.name}</strong
				><span class="score">${g.scores[away.id]} — ${g.scores[home.id]}</span
				><strong>${home.name}</strong>${logo(home)}
			</div>
		</div>
		<div class="summary-grid">
			<div class="card summary-stat">
				<label>Winner</label><strong>${winner.name}</strong>
			</div>
			<div class="card summary-stat"><label>Loser</label><strong>${loser.name}</strong></div>
			<div class="card summary-stat">
				<label>Total hits</label><strong>${g.hits[away.id]} — ${g.hits[home.id]}</strong>
			</div>
			<div class="card summary-stat">
				<label>Errors</label><strong>${g.errors[away.id]} — ${g.errors[home.id]}</strong>
			</div>
		</div>
		<div class="card boxscore">
			<div class="section-head" style="margin:0 0 12px">
				<div>
					<h3>Batting box score</h3>
					<p>${g.inning} innings · ${winner.name} take the exhibition.</p>
				</div>
				<button class="btn primary" data-action="new-game">Start another game</button>
			</div>
			<div class="table-scroll">
				<table class="box-table">
					<thead>
						<tr>
							<th>Player</th>
							<th>AB</th>
							<th>H</th>
							<th>R</th>
							<th>RBI</th>
							<th>HR</th>
							<th>BB</th>
							<th>K</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<th colspan="8" style="text-align:left;color:var(--green)">
								${away.name}
							</th>
						</tr>
						${table(away)}
						<tr>
							<th colspan="8" style="text-align:left;color:var(--green)">
								${home.name}
							</th>
						</tr>
						${table(home)}
					</tbody>
				</table>
			</div>
		</div>`;
}
document.addEventListener('click', (e) => {
	if (!ready) return;
	if (state.screen === 'manage' && handleManageClick(e)) return;
	const screen = e.target.closest('[data-screen]')?.dataset.screen;
	if (screen) {
		state.screen = screen;
		render();
		return;
	}
	const tid = e.target.closest('[data-team]')?.dataset.team;
	if (tid) {
		state.manageTeamId = tid;
		state.screen = 'manage';
		manageSelection = null;
		render();
		return;
	}
	const card = e.target.closest('[data-player]');
	if (card) {
		const p = player(card.dataset.player);
		showToast(`${p.name} · ${p.type} · ${avg(p)} OVR`);
		return;
	}
	const action = e.target.closest('[data-action]')?.dataset.action;
	if (!action) return;
	if (action === 'new-game') {
		newGame();
		return;
	}
	if (action === 'pause') {
		state.game.paused = !state.game.paused;
		renderGame();
		return;
	}
	if (action === 'at-bat') runUntil('atbat');
	if (action === 'half') runUntil('half');
	if (action === 'inning') runUntil('inning');
	if (action === 'game') {
		if (state.game.paused) {
			state.game.paused = false;
		} else {
			while (!state.game.ended) runUntil('inning');
		}
	}
});
document.addEventListener('change', (e) => {
	if (!ready) return;
	if (e.target.id === 'player-filter') {
		state.playerFilter = e.target.value;
		renderPlayers();
	}
	if (state.screen === 'manage') handleManageChange(e);
});
function showToast(message) {
	const toast = $('#toast');
	toast.textContent = message;
	toast.classList.add('show');
	clearTimeout(showToast.timer);
	showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}
initializeGame();
