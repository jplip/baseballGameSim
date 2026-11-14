// Squad editing keeps the same starting nine in defense and the batting order.
// Batting reorders never change a player's defensive assignment.
const STANDARD_DEFENSE = {
	name: 'Standard defense',
	points: { LF: [12, 25], CF: [50, 10], RF: [88, 25], SS: [36, 29.5], '2B': [64, 29.5], '3B': [28.7, 401 / 680 * 100], '1B': [71.3, 401 / 680 * 100], P: [50, 68.5], C: [50, 88] },
};
const SETUP_STORAGE_KEY = 'diamond-office.squads.v1';
let manageSelection = null;
let manageDrag = null;
const isPitcher = (p) => p && (p.position === 'P' || p.position === 'RP');
const assignedPosition = (t, id) => POSITIONS.find((pos) => t.positions[pos] === id);

function validTeamSetup(t, saved) {
	return saved &&
		Array.isArray(saved.lineup) && saved.lineup.length === 9 && new Set(saved.lineup).size === 9 &&
		saved.lineup.every((id) => t.players.some((p) => p.id === id)) &&
		saved.positions && new Set(POSITIONS.map((pos) => saved.positions[pos])).size === 9 &&
		POSITIONS.every((pos) => saved.lineup.includes(saved.positions[pos]) &&
			(pos === 'P' ? isPitcher(player(saved.positions[pos])) : !isPitcher(player(saved.positions[pos]))));
}
function syncPitchingStaff(t) {
	t.starterId = t.positions.P;
	t.relieverIds = t.players.filter((p) => isPitcher(p) && p.id !== t.starterId).slice(0, 3).map((p) => p.id);
}
function restoreTeamSetups() {
	let saved = {};
	try { saved = JSON.parse(window.localStorage.getItem(SETUP_STORAGE_KEY)) || {}; } catch { /* Storage may be unavailable in file mode. */ }
	for (const t of teams) {
		t.formation = 'standard';
		t.setupDirty = false;
		if (validTeamSetup(t, saved?.[t.id])) {
			Object.assign(t, { lineup: [...saved[t.id].lineup], positions: { ...saved[t.id].positions }, formation: 'standard' });
			syncPitchingStaff(t);
		}
	}
}
function saveTeamSetup(t) {
	try {
		let saved;
		try { saved = JSON.parse(window.localStorage.getItem(SETUP_STORAGE_KEY)); } catch { saved = {}; }
		if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
		saved[t.id] = { lineup: [...t.lineup], positions: { ...t.positions }, formation: 'standard' };
		window.localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(saved));
		t.setupDirty = false;
		renderManage();
		showToast(`${t.name} setup saved on this device.`);
	} catch {
		showToast('Setup applies this session. Browser storage is unavailable.');
	}
}

// Local illustrated portraits for the fictional roster: no remote image dependencies.
function squadAvatar(p, className = '') {
	const n = Number(p.id.slice(1)), t = team(p.teamId);
	const skin = ['#dfac80', '#a66b48', '#efc5a4', '#784a35', '#c38b61'][n % 5];
	return `<svg class="squad-avatar ${className}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
		<path d="M7 100 Q9 72 32 70 L68 70 Q92 74 95 100" fill="#e7e4d8"/>
		<path d="M35 71 L50 85 L65 71 M50 85 V100" fill="none" stroke="${t.colors[0]}" stroke-width="3"/>
		<path d="M41 61 V76 Q50 84 59 76 V61" fill="${skin}"/>
		<ellipse cx="50" cy="43" rx="21" ry="27" fill="${skin}"/>
		<path d="M29 36 Q24 8 50 8 Q76 8 72 36 L63 29 L36 30Z" fill="${t.colors[1]}"/>
		<path d="M26 31 Q48 21 76 31 L84 37 Q55 34 26 36Z" fill="${t.colors[0]}"/>
		<text x="49" y="24" text-anchor="middle" fill="#fff" font-size="12" font-family="sans-serif" font-weight="800">${t.abbr[0]}</text>
		<path d="M36 43 H43 M57 43 H64" stroke="#3e3027" stroke-width="2" stroke-linecap="round"/>
		<path d="M48 46 L46 55 H52" stroke="#775039" stroke-width="1.5" fill="none"/>
		<path d="M42 61 Q50 ${n % 2 ? 65 : 62} 58 60" stroke="#70432e" stroke-width="2" fill="none"/>
		${n % 3 === 0 ? '<path d="M33 54 Q36 73 50 73 Q66 70 68 54 L61 64 H40Z" fill="#443329" opacity=".65"/>' : ''}
		<text x="70" y="95" fill="${t.colors[1]}" font-size="13" font-family="sans-serif" font-weight="800">${p.number}</text>
	</svg>`;
}
function squadCard(p, zone, pos = '') {
	const selected = manageSelection?.id === p.id;
	const mismatch = pos && p.position !== pos && p.position !== 'UTIL' && !(pos === 'P' && isPitcher(p));
	return `<button class="squad-card ${avg(p) >= 80 ? 'elite' : ''} ${selected ? 'is-selected' : ''}"
		draggable="true" data-squad-player="${p.id}" data-squad-zone="${zone}" ${pos ? `data-field-position="${pos}"` : ''}
		aria-pressed="${selected}" aria-label="${esc(p.name)}, ${avg(p)} overall, ${pos || p.position}${mismatch ? ', out of primary position' : ''}"
		title="${esc(p.name)} · ${p.position}${mismatch ? ' · Out of primary position' : ''}">
		<span class="squad-card-face"><span class="squad-card-rating">${avg(p)}<small>${p.position}</small></span>
		${squadAvatar(p)}<span class="card-club">${team(p.teamId).abbr}</span>
		<span class="squad-card-name">${esc(p.name)}</span><span class="squad-card-rule"></span>
		<span class="squad-card-stats">${isPitcher(p) ? `${p.ratings.velocity} <small>VEL</small> &nbsp; ${p.ratings.control} <small>CTL</small>` : `${p.ratings.contact} <small>CON</small> &nbsp; ${p.ratings.power} <small>POW</small>`}</span></span>
		${pos ? `<span class="position-pedestal ${mismatch ? 'out-of-position' : ''}">${pos}${mismatch ? ' · !' : ''}</span>` : `<span class="bench-role">${isPitcher(p) ? 'BULLPEN' : 'SUBSTITUTE'}</span>`}
	</button>`;
}
function squadFieldArt() {
	return `<svg class="squad-field-art" viewBox="0 0 1000 680" preserveAspectRatio="none" aria-hidden="true">
		<defs>
			<radialGradient id="turf"><stop stop-color="#376b43"/><stop offset="1" stop-color="#183d2a"/></radialGradient>
			<pattern id="mowing" width="100" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><rect width="50" height="100" fill="#9abe83" opacity=".045"/></pattern>
			<linearGradient id="dirt" x2="0" y2="1"><stop stop-color="#b19465"/><stop offset="1" stop-color="#7a6043"/></linearGradient>
		</defs>
		<path d="M76 225 Q115 30 500 25 Q885 30 924 225 L500 610Z" fill="url(#turf)" stroke="#597456" stroke-width="3"/>
		<path d="M76 225 Q115 30 500 25 Q885 30 924 225 L500 610Z" fill="url(#mowing)"/>
		<path d="M102 237 Q146 58 500 54 Q854 58 898 237" fill="none" stroke="#d4c58c" stroke-opacity=".27" stroke-width="2"/>
		<path d="M500 603 L220 371 Q500 124 780 371Z" fill="url(#dirt)" opacity=".83"/>
		<path d="M500 551 L320 399 L500 259 L680 399Z" fill="#315a36"/>
		<path d="M500 581 L287 401 L500 226 L713 401Z" fill="none" stroke="#f3e9ca" stroke-opacity=".58" stroke-width="2"/>
		<path d="M69 218 L500 581 L931 218" fill="none" stroke="#eee5cc" stroke-opacity=".65" stroke-width="2"/>
		<ellipse cx="500" cy="581" rx="53" ry="34" fill="url(#dirt)"/>
		<ellipse cx="500" cy="414" rx="32" ry="24" fill="url(#dirt)"/>
		<path d="M488 413 H512" stroke="#eee9d9" stroke-width="4"/>
		<g fill="#fff1d8"><path d="M500 216 L511 226 L500 236 L489 226Z"/><path d="M713 391 L724 401 L713 411 L702 401Z"/><path d="M287 391 L298 401 L287 411 L276 401Z"/><path d="M490 575 H510 V584 L500 591 L490 584Z"/></g>
		<g fill="none" stroke="#e4dfce" stroke-opacity=".35"><path d="M467 571 H480 V594 H467Z M520 571 H533 V594 H520Z"/><path d="M452 608 Q500 643 548 608"/></g>
		<g fill="#d4dbc9" fill-opacity=".32" font-family="monospace" font-size="12" text-anchor="middle"><text x="151" y="211">330</text><text x="500" y="80">400</text><text x="849" y="211">330</text></g>
	</svg>`;
}
function renderManage() {
	const t = team(state.manageTeamId), formation = STANDARD_DEFENSE;
	const points = formation.points;
	const nine = t.lineup.map(player), bench = t.players.filter((p) => !t.lineup.includes(p.id));
	const overall = Math.round(nine.reduce((sum, p) => sum + avg(p), 0) / 9);
	const hitters = nine.filter((p) => !isPitcher(p));
	const hitting = Math.round(hitters.reduce((sum, p) => sum + (p.ratings.contact + p.ratings.power) / 2, 0) / hitters.length);
	const fielding = Math.round(hitters.reduce((sum, p) => sum + p.ratings.fielding, 0) / hitters.length);
	$('#screen-manage').innerHTML = `<div class="squad-page-heading">
		<div><div class="eyebrow">Clubhouse <span>/</span> Squad management</div><h1 class="page-title">Manage <span>team.</span></h1><p class="lede">Your nine. Your diamond. Your game.</p></div>
		<div class="squad-heading-actions"><span class="setup-status ${t.setupDirty ? 'unsaved' : ''}"><i></i>${t.setupDirty ? 'Unsaved changes' : 'Ready for first pitch'}</span><button class="btn primary" data-manage-action="save">Save setup <span aria-hidden="true">↗</span></button></div>
	</div>
	<div class="club-command-bar"><div class="club-identity">${logo(t)}<label><span class="eyebrow">Active club</span><select id="manage-club" aria-label="Select club">${teams.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><small>${esc(t.city)} <span>·</span> ${t.players.length}-man roster</small></label></div>
		<div class="squad-metrics"><div class="overall-metric"><strong>${overall}</strong><span>Squad<br>rating</span></div><div><span>Hitting</span><strong>${hitting}</strong><i style="--value:${hitting}%"></i></div><div><span>Fielding</span><strong>${fielding}</strong><i style="--value:${fielding}%"></i></div></div>
	</div>
	<div class="squad-layout"><div class="squad-left"><section class="squad-pitch-panel" aria-labelledby="defense-title">
		<div class="squad-panel-header"><div><span class="section-index">01</span><h2 id="defense-title">The starting nine</h2><span class="mini-tag">DEFENSE</span></div><span class="formation-label">${formation.name}</span></div>
		<div class="squad-pitch"><div class="pitch-caption"><span><i class="live-dot"></i> ${esc(t.abbr)} <b>HOME DIAMOND</b></span><span>9 / 9 <b>POSITIONS FILLED</b></span></div>${squadFieldArt()}
			<div class="diamond-wordmark" aria-hidden="true">${esc(t.abbr)}<span>DIAMOND CLUB</span></div>
			${POSITIONS.map((pos) => `<div class="field-card-slot${pos === '1B' || pos === '3B' ? ' base-anchored' : ''}" style="--x:${points[pos][0]}%;--y:${points[pos][1]}%">${squadCard(player(t.positions[pos]), 'field', pos)}</div>`).join('')}
			<div class="field-bottom-note"><span>◆</span> ${esc(formation.name)} <span>·</span> No designated hitter</div>
		</div>
		<div class="squad-interaction-hint"><span aria-hidden="true">↔</span><span>${manageSelection ? `<strong>${esc(player(manageSelection.id).name)} selected.</strong> Choose a field card, bench player, or batting spot.` : 'Drag players to swap. Or select a player, then choose their destination.'}</span>${manageSelection ? '<button data-manage-action="clear" aria-label="Cancel player selection">Cancel ×</button>' : '<span class="hint-key">DRAG & DROP</span>'}</div>
	</section>
	<section class="squad-bench-panel" aria-labelledby="bench-title"><div class="squad-panel-header"><div><span class="section-index">02</span><h2 id="bench-title">The bench</h2><span class="count-tag">${bench.length}</span></div><span class="bench-summary">${bench.filter((p) => !isPitcher(p)).length} substitutes <span>·</span> ${bench.filter(isPitcher).length} pitchers</span></div><div class="squad-bench" tabindex="0" aria-label="Available substitutes and bullpen; scroll for all players">${bench.map((p) => squadCard(p, 'bench')).join('')}</div><div class="bench-footer"><span><i class="gold-dot"></i> ${t.players.filter((p) => avg(p) >= 80).length} elite players</span><span>Scroll to explore roster <span aria-hidden="true">→</span></span></div></section>
	</div>
	<aside class="squad-right"><section class="batting-panel" aria-labelledby="batting-title"><div class="squad-panel-header"><div><span class="section-index">03</span><h2 id="batting-title">Batting order</h2></div><span class="mini-tag">OFFENSE</span></div><p class="batting-intro">Set the order. Find your rhythm.</p><div class="batting-columns"><span>ORDER / PLAYER</span><span>POS</span><span>OVR</span></div>
		<ol class="batting-list">${t.lineup.map((id, i) => { const p = player(id); return `<li><button class="batting-row ${manageSelection?.id === id ? 'is-selected' : ''}" draggable="true" data-squad-player="${id}" data-squad-zone="batting" data-batting-index="${i}" aria-pressed="${manageSelection?.id === id}" aria-label="Batting spot ${i + 1}, ${esc(p.name)}, primary position ${p.position}"><span class="batting-number">${String(i + 1).padStart(2, '0')}</span>${squadAvatar(p, 'batting-avatar')}<span class="batter-identity"><strong>${esc(p.name)}</strong><small>${isPitcher(p) ? 'Pitcher' : p.type}</small></span><span class="batter-position">${p.position}</span><span class="batter-overall">${avg(p)}</span><span class="drag-grip" aria-hidden="true">⠿</span></button></li>`; }).join('')}</ol>
		<div class="batting-note"><span aria-hidden="true">↕</span> Drag to reorder, or select a player and a batting spot. Defensive positions stay assigned.</div>
	</section>
	${renderSquadInspector(t)}
	<div class="squad-tip"><span aria-hidden="true">◇</span><p><strong>A place for every player.</strong>Gold cards mark players rated 80+. Position warnings help you spot players outside their primary role.</p></div></aside></div>`;
}
function renderSquadInspector(t) {
	if (!manageSelection) return `<section class="squad-inspector inspector-empty"><span class="inspector-icon" aria-hidden="true">⌖</span><h3>Make your next move.</h3><p>Select any player to assign a position or batting spot.</p><span class="inspector-label">YOUR CLUB. YOUR CALL.</span></section>`;
	const p = player(manageSelection.id), pos = assignedPosition(t, p.id);
	return `<section class="squad-inspector"><div class="inspector-player">${squadAvatar(p)}<div><span class="eyebrow">Selected player</span><h3>${esc(p.name)}</h3><p>${p.position} · ${avg(p)} OVR · #${p.number}</p></div><button data-manage-action="clear" aria-label="Clear selection">×</button></div><div class="assignment-controls"><div><label for="assign-defense">Defensive position</label><select id="assign-defense"><option value="">${pos ? `Assigned: ${pos}` : 'Choose a position'}</option>${POSITIONS.filter((position) => (position === 'P') === isPitcher(p)).map((position) => `<option value="${position}">${position} — ${esc(player(t.positions[position]).name)}</option>`).join('')}</select></div><div><label for="assign-batting">Batting spot</label><select id="assign-batting"><option value="">${t.lineup.includes(p.id) ? `Batting ${t.lineup.indexOf(p.id) + 1}` : 'Replace a batter'}</option>${t.lineup.map((id, index) => `<option value="${index}">${index + 1} — ${esc(player(id).name)}</option>`).join('')}</select></div></div></section>`;
}

function finishSquadEdit(t, message) {
	syncPitchingStaff(t);
	t.setupDirty = true;
	manageSelection = null;
	renderManage();
	showToast(message);
}
function assignDefense(t, sourceId, targetPosition) {
	const source = t.players.find((p) => p.id === sourceId);
	if (!source || !POSITIONS.includes(targetPosition)) return false;
	if ((targetPosition === 'P') !== isPitcher(source)) {
		showToast(isPitcher(source) ? 'Assign pitchers to P. Choose a position player for the field.' : 'Choose a pitcher for the mound.');
		return false;
	}
	const targetId = t.positions[targetPosition], sourcePosition = assignedPosition(t, sourceId);
	if (targetId === sourceId) { manageSelection = null; renderManage(); return false; }
	if (sourcePosition) t.positions[sourcePosition] = targetId;
	else t.lineup[t.lineup.indexOf(targetId)] = sourceId;
	t.positions[targetPosition] = sourceId;
	finishSquadEdit(t, `${source.name} assigned to ${targetPosition}.`);
	return true;
}
function assignBattingSpot(t, sourceId, targetIndex) {
	if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 8) return false;
	const oldIndex = t.lineup.indexOf(sourceId);
	if (oldIndex < 0) return assignDefense(t, sourceId, assignedPosition(t, t.lineup[targetIndex]));
	if (oldIndex === targetIndex) { manageSelection = null; renderManage(); return false; }
	t.lineup.splice(oldIndex, 1);
	t.lineup.splice(targetIndex, 0, sourceId);
	finishSquadEdit(t, `${player(sourceId).name} moved to batting spot ${targetIndex + 1}.`);
	return true;
}
function applySquadMove(source, target) {
	const t = team(state.manageTeamId);
	if (target.squadZone === 'batting') return assignBattingSpot(t, source.id, Number(target.battingIndex));
	if (target.squadZone === 'field') return assignDefense(t, source.id, target.fieldPosition);
	const sourcePosition = assignedPosition(t, source.id);
	if (sourcePosition) return assignDefense(t, target.squadPlayer, sourcePosition);
	return false;
}
function handleManageClick(e) {
	const action = e.target.closest('[data-manage-action]')?.dataset.manageAction;
	if (action) {
		if (action === 'save') saveTeamSetup(team(state.manageTeamId));
		if (action === 'clear') { manageSelection = null; renderManage(); }
		return true;
	}
	const card = e.target.closest('[data-squad-player]');
	if (!card) return false;
	const id = card.dataset.squadPlayer;
	if (!manageSelection) manageSelection = { id, zone: card.dataset.squadZone };
	else if (manageSelection.id === id) manageSelection = null;
	else if (manageSelection.zone === 'bench' && card.dataset.squadZone === 'bench') manageSelection = { id, zone: 'bench' };
	else { applySquadMove(manageSelection, card.dataset); return true; }
	renderManage();
	// Preserve keyboard navigation after replacing the selected card's markup.
	$(`[data-squad-player="${id}"][data-squad-zone="${card.dataset.squadZone}"]`)?.focus?.({ preventScroll: true });
	return true;
}
function handleManageChange(e) {
	const t = team(state.manageTeamId);
	if (e.target.id === 'manage-club') { state.manageTeamId = e.target.value; manageSelection = null; renderManage(); }
	if (manageSelection && e.target.value) {
		if (e.target.id === 'assign-defense') assignDefense(t, manageSelection.id, e.target.value);
		if (e.target.id === 'assign-batting') assignBattingSpot(t, manageSelection.id, Number(e.target.value));
	}
}
document.addEventListener('dragstart', (e) => {
	if (!ready || state.screen !== 'manage') return;
	const card = e.target.closest('[data-squad-player]');
	if (!card) return;
	manageDrag = { id: card.dataset.squadPlayer, zone: card.dataset.squadZone };
	e.dataTransfer.setData('text/plain', manageDrag.id);
	e.dataTransfer.effectAllowed = 'move';
	card.classList.add('is-dragging');
});
document.addEventListener('dragover', (e) => {
	if (!manageDrag || state.screen !== 'manage') return;
	const target = e.target.closest('[data-squad-player]');
	if (target) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; target.classList.add('drop-target'); }
});
document.addEventListener('dragleave', (e) => {
	const target = e.target.closest('[data-squad-player]');
	if (target && !target.contains(e.relatedTarget)) target.classList.remove('drop-target');
});
document.addEventListener('drop', (e) => {
	if (!manageDrag || state.screen !== 'manage') return;
	const target = e.target.closest('[data-squad-player]');
	if (target) { e.preventDefault(); applySquadMove(manageDrag, target.dataset); }
	manageDrag = null;
	$$('.drop-target, .is-dragging').forEach((el) => el.classList.remove('drop-target', 'is-dragging'));
});
document.addEventListener('dragend', () => {
	manageDrag = null;
	$$('.drop-target, .is-dragging').forEach((el) => el.classList.remove('drop-target', 'is-dragging'));
});
document.addEventListener('keydown', (e) => {
	if (ready && state.screen === 'manage' && e.key === 'Escape' && manageSelection) { manageSelection = null; renderManage(); }
});
