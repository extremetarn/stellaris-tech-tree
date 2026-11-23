import {
    FIELD_NAMES, STATUS, STORAGE_KEY, VIEWS, appendDraft, connectedNodes, draftForBatch, evaluate,
    externalKey, indexCatalog, isRepeatableResearch, newProfile, profileSets, restoreSettings,
    setResearchCycles, toggle, validateProfile,
} from './model.mjs';
import { CIVILIZATION_TYPES } from './civilizations.mjs';
import { createGraph } from './graph.mjs';
import { createFleetStore } from './ship-fleet.mjs';
import { createShipDesigner } from './ship-designer.mjs';

const NAME = '群星科研台';
const MAIN_VIEWS = ['INTRO', 'P', 'S', 'E', 'ME', 'G', 'ASC'];
const STAGES = ['入口', '文明转型', '文明终局'];
const PROJECT_COLLECTIONS = { node: 'nodes', route: 'routes', perk: 'perks' };
const GATEWAY_NOTICE = '里程碑已达成 · L 星门权限授予 · 灰风实体化';

function element(tag, text = '', className = '') {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
}

function button(text, action, className = '') {
    const el = element('button', text, className);
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
}

function iconButton(text, label, action) {
    const el = button(text, action, 'stt-icon');
    el.setAttribute('aria-label', label);
    el.title = label;
    return el;
}

function pressed(el, active) {
    el.setAttribute('aria-pressed', String(active));
}

function addHeading(parent, text) {
    parent.append(element('h3', text, 'stt-section-title'));
}

function block(parent, title) {
    const section = element('section', '', 'stt-section');
    addHeading(section, title);
    parent.append(section);
    return section;
}

function buildShell() {
    const dialog = element('dialog', '', 'stt-dialog');
    dialog.setAttribute('aria-labelledby', 'stt-title');
    dialog.innerHTML = `
        <div class="stt-shell">
            <header class="stt-header">
                <h1 id="stt-title">群星科研台</h1>
                <div class="stt-search">
                    <input type="search" aria-label="搜索科技、ID 或飞升" placeholder="搜索科技、ID 或飞升" autocomplete="off">
                    <div class="stt-results" hidden aria-label="搜索结果"></div>
                </div>
                <div class="stt-profile-tools">
                    <select aria-label="文明档案"></select>
                    <button type="button" class="stt-profile-menu" aria-label="管理文明档案" aria-expanded="false">档案</button>
                    <div class="stt-profile-actions" hidden></div>
                </div>
                <button type="button" class="stt-close stt-icon" aria-label="关闭科研台">×</button>
            </header>
            <div class="stt-navigation">
                <nav class="stt-tabs" aria-label="科技分类"></nav>
                <button type="button" class="stt-design-open">舰船设计器</button>
            </div>
            <div class="stt-alert" role="status" hidden></div>
            <div class="stt-main">
                <section class="stt-board" aria-label="科技图">
                    <div class="stt-boardbar">
                        <div class="stt-board-name"></div>
                        <div class="stt-board-actions">
                            <button type="button" class="stt-icon stt-minus" aria-label="缩小图面">−</button>
                            <button type="button" class="stt-icon stt-plus" aria-label="放大图面">+</button>
                            <button type="button" class="stt-fit" aria-label="适应图面">全览</button>
                        </div>
                    </div>
                    <div class="stt-graph-view">
                        <div class="stt-graph" aria-label="可拖动和缩放的科技图"></div>
                        <div class="stt-graph-checks" role="group" aria-label="勾选科技图节点"></div>
                    </div>
                    <div class="stt-asc-page" hidden></div>
                    <footer class="stt-board-footer">
                        <span><i class="stt-dot is-learned"></i>已掌握</span>
                        <span><i class="stt-dot is-repeated"></i>已循环</span>
                        <span><i class="stt-dot is-ready"></i>可点亮</span>
                        <span><i class="stt-dot"></i>前置待确认</span>
                        <span class="stt-line-key">虚线表示任选分支</span>
                    </footer>
                </section>
                <aside class="stt-inspector" aria-label="档案详情">
                    <div class="stt-inspector-top">
                        <div class="stt-inspector-title"></div>
                        <button type="button" class="stt-hide-detail stt-icon" aria-label="收起详情">×</button>
                    </div>
                    <div class="stt-detail"></div>
                    <footer class="stt-detail-actions"></footer>
                </aside>
            </div>
            <footer class="stt-batch" aria-label="已选节点操作">
                <div class="stt-batch-selection">
                    <strong>已选节点 <span class="stt-batch-count" aria-live="polite">0</span></strong>
                    <ul class="stt-batch-list" aria-label="已选节点列表"></ul>
                </div>
                <div class="stt-batch-actions">
                    <button type="button" class="stt-batch-clear" disabled>清空</button>
                    <button type="button" class="stt-batch-learn" title="登记选中的科技及可独立登记的里程碑" disabled>批量掌握</button>
                    <button type="button" class="stt-primary stt-batch-fill" disabled>填入已选</button>
                </div>
            </footer>
        </div>`;
    document.body.append(dialog);
    return dialog;
}

let dialog;
let numberOfOpenRequests = 0;
let initialLoad;
let catalogData;
let dataCatalog;
let settings;
let chatKey = '';
let chatRevision = 0;
let graph;
let view = 'INTRO';
let selection = null;
let focusId = '';
let ascendView = 'routes';
let statusById;
let progress;
let profileMenuOpen = false;
let searchResults = [];
let openingButton;
let noteTimer;
let elements;
const batchProjects = new Map();
const fleetStore = createFleetStore(getConversation);
let shipDesigner;
let fleetRequest;

function profile() {
    return settings.profiles.find(item => item.id === settings.activeId);
}

function getConversation() {
    const context = globalThis.SillyTavern.getContext();
    const { chatId, groupId, characterId, characters } = context;
    const character = characters?.[characterId]?.avatar ?? characterId;
    const key = chatId && (groupId || character != null)
        ? JSON.stringify([groupId ? 'group' : 'character', groupId || character, chatId])
        : '';
    return { context, key };
}

function syncFleet() {
    const { key } = getConversation();
    if (fleetRequest?.key === key) return fleetRequest.promise;
    shipDesigner?.setFleet('', []);
    const request = { key };
    request.promise = fleetStore.prepare(key)
        .then(fleet => {
            if (getConversation().key === key) shipDesigner?.setFleet(key, fleet);
        })
        .catch(error => {
            if (getConversation().key === key) {
                shipDesigner?.setFleet(key, [], error);
                console.warn(NAME, error);
            }
        })
        .finally(() => {
            if (fleetRequest === request) fleetRequest = undefined;
        });
    fleetRequest = request;
    return request.promise;
}

function syncConversation() {
    if (!catalogData) return;
    const { context, key } = getConversation();
    chatRevision++;
    if (key !== chatKey) {
        batchProjects.clear();
        hideSearch(true);
    }
    chatKey = key;
    clearTimeout(noteTimer);
    elements.alert.hidden = true;
    try {
        settings = restoreSettings(key ? context.chatMetadata[STORAGE_KEY] : undefined);
        if (!key) notice('打开一段会话后即可登记科研进度。', 0);
    } catch (error) {
        chatKey = '';
        settings = restoreSettings();
        notice('这段会话的科研档案无法读取。' + error.message, 0);
    }
    renderProfiles();
    refreshProgress();
    renderBatch();
}

function updateBatch(item, kind, checked) {
    const key = kind + ':' + item.id;
    if (checked) batchProjects.set(key, { item, kind });
    else batchProjects.delete(key);
    renderBatch();
}

function batchCheckbox(item, kind) {
    const checkbox = element('input', '', 'stt-batch-check');
    checkbox.type = 'checkbox';
    checkbox.dataset.batchKey = kind + ':' + item.id;
    checkbox.checked = batchProjects.has(checkbox.dataset.batchKey);
    checkbox.setAttribute('aria-label', '勾选' + item.name);
    checkbox.title = '勾选' + item.name;
    checkbox.addEventListener('change', () => updateBatch(item, kind, checkbox.checked));
    return checkbox;
}

function canRegisterNode(node) {
    return node.field !== 'A' && !node.derivedFrom;
}

function batchLearnableNodes() {
    return [...batchProjects.values()]
        .filter(({ item, kind }) => kind === 'node' && canRegisterNode(item) && !progress.learned.has(item.id))
        .map(({ item }) => item);
}

function renderBatchLearn() {
    elements.batchLearn.disabled = !chatKey || !batchLearnableNodes().length;
}

function learnBatch() {
    const nodes = batchLearnableNodes();
    if (!nodes.length) return;
    const changed = editConversation(() => {
        const current = profile();
        for (const node of nodes) {
            if (isRepeatableResearch(node)) setResearchCycles(current, node.id, 1);
            else current.learned.push(node.id);
        }
    });
    if (!changed) return;
    const result = '已批量登记 ' + nodes.length + ' 个节点。';
    notice(nodes.some(node => node.id === 'gateway_construction') ? result + GATEWAY_NOTICE : result);
}

function renderBatch() {
    elements.batchCount.textContent = String(batchProjects.size);
    elements.batchClear.disabled = !batchProjects.size;
    elements.batchFill.disabled = !batchProjects.size;
    renderBatchLearn();
    const list = elements.batchList;
    const scroll = list.scrollLeft;
    list.replaceChildren(...[...batchProjects.values()].map(({ item, kind }) => {
        const entry = element('li', '', 'stt-batch-chip');
        const name = button(item.name, () => {
            if (kind === 'node') selectTech(item.id, true);
            else selectAscension(item.id, kind);
        }, 'stt-batch-name');
        const remove = iconButton('×', '移除' + item.name, () => updateBatch(item, kind, false));
        entry.append(name, remove);
        return entry;
    }));
    list.scrollLeft = scroll;
    for (const checkbox of dialog.querySelectorAll('input.stt-batch-check')) {
        checkbox.checked = batchProjects.has(checkbox.dataset.batchKey);
    }
}

function editConversation(update) {
    const { context, key } = getConversation();
    if (!chatKey || key !== chatKey) return false;
    update(settings);
    context.chatMetadata[STORAGE_KEY] = structuredClone(settings);
    const revision = chatRevision;
    void context.saveMetadata().catch(error => {
        if (revision === chatRevision) notice('科研进度保存失败。' + error.message, 8000);
    });
    renderProfiles();
    refreshProgress();
    return true;
}

function recordButton(text, action, className) {
    const el = button(text, action, className);
    el.disabled = !chatKey;
    return el;
}

function notice(text, duration = 5500) {
    clearTimeout(noteTimer);
    elements.alert.hidden = false;
    elements.alert.textContent = text;
    if (duration) noteTimer = setTimeout(() => { elements.alert.hidden = true; }, duration);
}

function updateProgress() {
    progress = profileSets(profile());
    statusById = new Map(Array.from(dataCatalog.nodes, ([id, node]) => [id, evaluate(node, dataCatalog, progress).status]));
}

function setProfileMenu(open) {
    profileMenuOpen = open;
    elements.profileActions.hidden = !open;
    elements.profileMenu.setAttribute('aria-expanded', String(open));
}

function changeProfile(id) {
    if (!settings.profiles.some(item => item.id === id)) return;
    editConversation(current => { current.activeId = id; });
}

function renameOrCreate(mode) {
    const suffix = mode === 'copy' ? ' · 分支' : '';
    const placeholder = mode === 'new' ? '' : profile().name + suffix;
    const answer = window.prompt('文明档案名称', placeholder);
    const name = answer?.trim().slice(0, 80);
    if (!name) return;
    if (mode === 'rename') {
        editConversation(() => { profile().name = name; });
        return;
    }
    const record = newProfile(name, mode === 'copy' ? profile() : undefined);
    addProfiles([record], record.id);
}

function addProfiles(records, activeId, legacyImported = false) {
    return editConversation(current => {
        current.profiles.push(...records);
        current.activeId = activeId;
        if (legacyImported) current.legacyImported = true;
    });
}

function legacySettings() {
    return globalThis.SillyTavern.getContext().extensionSettings?.[STORAGE_KEY];
}

function importLegacyProfiles() {
    try {
        const legacy = legacySettings();
        if (!legacy?.profiles?.length || settings.legacyImported) return;
        const old = restoreSettings(legacy);
        const copies = old.profiles.map(record => newProfile(record.name, record));
        const oldActive = old.profiles.findIndex(record => record.id === old.activeId);
        if (addProfiles(copies, copies[oldActive].id, true)) {
            notice('旧版全局档案已复制到当前会话。');
        }
    } catch (error) {
        notice('旧版档案导入失败。' + error.message, 8000);
    }
}

function exportProfile() {
    const packet = { schema: settings.schema, format: STORAGE_KEY, profile: profile() };
    const blob = new Blob([JSON.stringify(packet, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = 'stellaris-profile-' + profile().name.replace(/[\\/:*?"<>|]/g, '-') + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importProfile(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    const revision = chatRevision;
    try {
        if (file.size > 512 * 1024) throw new Error('档案超过 512 KiB。');
        const data = JSON.parse(await file.text());
        if (revision !== chatRevision) return;
        if (data?.schema !== settings.schema || data.format !== STORAGE_KEY) throw new Error('请选择科研台导出的档案。');
        const imported = validateProfile(data.profile);
        const record = newProfile(imported.name.slice(0, 75) + '（导入）', imported);
        if (addProfiles([record], record.id)) notice('已导入到当前会话。');
    } catch (error) {
        if (revision === chatRevision) notice('导入失败。' + error.message, 8000);
    } finally {
        input.value = '';
    }
}

function renderProfiles() {
    elements.profileSelect.replaceChildren(...settings.profiles.map(record => {
        const option = element('option', record.name);
        option.value = record.id;
        return option;
    }));
    elements.profileSelect.value = settings.activeId;
    elements.profileSelect.disabled = !chatKey;
    elements.civilizationSelect.value = profile().civilizationType;
    elements.civilizationSelect.disabled = !chatKey;
    elements.profileMenu.disabled = !chatKey;
    elements.legacyImport.hidden = !chatKey || settings.legacyImported || !legacySettings()?.profiles?.length;
}

function getProject(kind, id) {
    return dataCatalog[PROJECT_COLLECTIONS[kind]].get(id);
}

function searchableText(value) {
    return value.normalize('NFKC').toLowerCase().trim();
}

function findItems(query) {
    const needle = searchableText(query);
    if (!needle) return [];
    const results = [];
    const sources = [['node', dataCatalog.nodes], ['route', dataCatalog.routes], ['perk', dataCatalog.perks]];
    for (const [kind, items] of sources) {
        for (const item of items.values()) {
            const id = searchableText(item.id);
            const name = searchableText(item.name);
            const cleanId = needle.replace(/^tech_/, '');
            const matches = [name, id, item.group ?? ''].some(label => searchableText(label).includes(cleanId));
            if (!matches) continue;
            const rank = name === needle || id === cleanId ? 0 : name.startsWith(needle) || id.startsWith(cleanId) ? 1 : 2;
            results.push({ kind, item, rank });
        }
    }
    return results.sort((a, b) => a.rank - b.rank || a.item.name.length - b.item.name.length).slice(0, 12);
}

function hideSearch(clear = false) {
    elements.results.hidden = true;
    if (clear) elements.search.value = '';
}

function chooseSearch(result) {
    if (!result) return;
    hideSearch(true);
    elements.search.blur();
    if (result.kind === 'node') selectTech(result.item.id, true);
    else selectAscension(result.item.id, result.kind);
}

function renderSearch() {
    if (!dataCatalog) return;
    searchResults = findItems(elements.search.value);
    elements.results.replaceChildren();
    elements.results.hidden = !elements.search.value.trim();
    for (const result of searchResults) {
        const row = button('', () => chooseSearch(result), 'stt-search-hit');
        const hit = element('div', '', 'stt-search-choice');
        const name = result.item.field === 'ME' ? result.item.id + ' · ' + result.item.name : result.item.name;
        const descriptor = result.kind === 'node' ? (FIELD_NAMES[result.item.field] ?? '') : result.kind === 'route' ? '飞升路线' : '飞升天赋';
        row.append(element('strong', name), element('span', descriptor + ' · ' + result.item.id));
        hit.append(batchCheckbox(result.item, result.kind), row);
        elements.results.append(hit);
    }
    if (!searchResults.length) elements.results.append(element('p', '没有匹配的档案。', 'stt-empty'));
}

function chooseView(next) {
    if (next === view) return;
    view = next;
    if (next === 'FOCUS' && focusId) selection = { kind: 'node', id: focusId };
    else selection = null;
    elements.inspector.dataset.open = next === 'FOCUS' ? 'true' : 'false';
    elements.tier.value = '';
    renderView();
}

function selectTech(id, locate = false) {
    if (!dataCatalog.nodes.has(id)) return;
    const visible = view !== 'ASC' && visibleNodes().some(node => node.id === id);
    selection = { kind: 'node', id };
    elements.inspector.dataset.open = 'true';
    if (locate || !visible) {
        view = 'FOCUS';
        focusId = id;
        elements.tier.value = '';
        renderView();
    } else {
        graph.select(id);
        renderDetail();
    }
}

function selectAscension(id, kind) {
    if (!getProject(kind, id)) return;
    selection = { kind, id };
    elements.inspector.dataset.open = 'true';
    view = 'ASC';
    ascendView = kind === 'perk' ? 'perks' : 'routes';
    renderView();
}

function visibleNodes() {
    if (view === 'FOCUS') return focusId ? connectedNodes(dataCatalog, focusId) : [];
    const nodes = dataCatalog.views.get(view) ?? [];
    if (!elements.tier.value || !['P', 'S', 'E'].includes(view)) return nodes;
    return nodes.filter(node => node.tier === Number(elements.tier.value));
}

function renderTabs() {
    const names = focusId ? [...MAIN_VIEWS, 'FOCUS'] : MAIN_VIEWS;
    elements.tabs.replaceChildren(...names.map(name => {
        const tab = button(VIEWS[name], () => chooseView(name));
        pressed(tab, view === name);
        return tab;
    }));
}

function renderBoardHeader(nodes) {
    const showingAscension = view === 'ASC';
    const focus = view === 'FOCUS' ? dataCatalog.nodes.get(focusId)?.name : '';
    const title = focus || VIEWS[view];
    const completed = nodes.filter(node => ['learned', 'achieved', 'repeated'].includes(statusById.get(node.id))).length;
    const count = showingAscension ? '文明飞升档案' : completed + ' / ' + nodes.length + ' 已登记';
    elements.boardName.replaceChildren(element('strong', title), element('span', count));
}

function renderView() {
    const showingAscension = view === 'ASC';
    const nodes = visibleNodes();
    renderTabs();
    renderBoardHeader(nodes);
    elements.tier.hidden = !['P', 'S', 'E'].includes(view);
    elements.graphView.hidden = showingAscension;
    elements.graphActions.hidden = showingAscension;
    elements.graphLegend.hidden = showingAscension;
    elements.ascension.hidden = !showingAscension;
    if (showingAscension) renderAscension();
    else graph.setNodes(nodes, view, statusById, selection?.id);
    renderDetail();
}

function refreshProgress() {
    const type = profile().civilizationType;
    if (dataCatalog?.civilizationType !== type) {
        dataCatalog = indexCatalog(catalogData, type);
        if (focusId && !dataCatalog.nodes.has(focusId)) {
            focusId = '';
            if (view === 'FOCUS') view = 'INTRO';
        }
        if (selection && !getProject(selection.kind, selection.id)) {
            selection = null;
            elements.inspector.dataset.open = 'false';
        }
        for (const [key, { item, kind }] of batchProjects) {
            const currentItem = getProject(kind, item.id);
            if (currentItem) batchProjects.set(key, { item: currentItem, kind });
            else batchProjects.delete(key);
        }
        const resultsWereHidden = elements.results.hidden;
        renderSearch();
        elements.results.hidden = resultsWereHidden;
        updateProgress();
        renderView();
        renderBatch();
        return;
    }
    updateProgress();
    renderBatchLearn();
    renderBoardHeader(visibleNodes());
    if (view === 'ASC') renderAscension();
    else graph.refresh(statusById);
    const hasFocusInInspector = elements.inspector.contains(document.activeElement);
    const restore = hasFocusInInspector ? document.activeElement.dataset.focusKey : '';
    renderDetail();
    if (restore) {
        Array.from(elements.inspector.querySelectorAll('[data-focus-key]')).find(el => el.dataset.focusKey === restore)?.focus();
    }
}

function hint(parent, text) {
    if (text) parent.append(element('p', text, 'stt-hint'));
}

function renderAscension() {
    const host = elements.ascension;
    host.replaceChildren();
    hint(host, dataCatalog.data.definitions.ASC.split('路线包括')[0]);
    const tabs = element('div', '', 'stt-asc-tabs');
    for (const [key, text] of [['routes', '文明路线'], ['perks', '飞升天赋']]) {
        const btn = button(text, () => {
            ascendView = key;
            selection = null;
            elements.inspector.dataset.open = 'false';
            renderAscension();
            renderDetail();
        });
        pressed(btn, ascendView === key);
        tabs.append(btn);
    }
    host.append(tabs);
    if (ascendView === 'perks') {
        const grid = element('div', '', 'stt-perk-grid');
        for (const perk of dataCatalog.perks.values()) {
            const saved = progress.perks.has(perk.id);
            const card = button('', () => selectAscension(perk.id, 'perk'), 'stt-asc-card');
            const wrapper = element('div', '', 'stt-asc-choice');
            card.append(element('strong', perk.name), element('span', saved ? '已采纳' : perk.type));
            pressed(card, selection?.id === perk.id);
            wrapper.append(batchCheckbox(perk, 'perk'), card);
            grid.append(wrapper);
        }
        host.append(grid);
        return;
    }
    const grid = element('div', '', 'stt-route-grid');
    for (const route of dataCatalog.routes.values()) {
        if (route.parent) continue;
        const article = element('article', '', 'stt-asc-family');
        const main = button('', () => selectAscension(route.id, 'route'), 'stt-asc-card');
        const wrapper = element('div', '', 'stt-asc-choice');
        const lvl = profile().stages[route.id] ?? 0;
        main.append(element('strong', route.name), element('span', lvl ? STAGES[lvl - 1] + '已登记' : '待立项'));
        pressed(main, selection?.id === route.id);
        wrapper.append(batchCheckbox(route, 'route'), main);
        article.append(wrapper);
        const sub = element('div', '', 'stt-subroutes');
        for (const child of dataCatalog.routes.values()) {
            if (child.parent !== route.id) continue;
            const branch = button(child.name, () => selectAscension(child.id, 'route'));
            const choice = element('div', '', 'stt-subroute-choice');
            pressed(branch, selection?.id === child.id);
            choice.append(batchCheckbox(child, 'route'), branch);
            sub.append(choice);
        }
        if (sub.childElementCount) article.append(sub);
        grid.append(article);
    }
    host.append(grid);
}

function detailTitle(title, subtitle, badge = '', status = '') {
    const host = elements.inspectorTitle;
    host.replaceChildren(element('div', subtitle, 'stt-detail-type'), element('h2', title));
    if (badge) host.append(element('span', badge, 'stt-status is-' + status));
}

function referenceButton(node, done) {
    const link = button(node.name, () => {
        selectTech(node.id);
        graph.focus(node.id, 0.82);
    }, 'stt-reference');
    if (done) link.classList.add('is-done');
    return link;
}

function conditionButton(label, key, done) {
    const el = recordButton((done ? '✓ ' : '○ ') + label, () => {
        editConversation(() => {
            profile().conditions = toggle(profile().conditions, key);
        });
    }, 'stt-condition');
    pressed(el, done);
    el.dataset.focusKey = key;
    return el;
}

function fillDraft(projects) {
    const input = document.querySelector('#send_textarea');
    if (!(input instanceof HTMLTextAreaElement) || input.disabled || input.readOnly) {
        notice('酒馆输入框目前不可编辑。打开一段聊天后可以填入。', 8000);
        return;
    }
    const { key } = getConversation();
    if (key !== chatKey) {
        syncConversation();
        notice('当前会话已切换，请重新选择要填入的节点。');
        return;
    }
    const draft = draftForBatch(projects, dataCatalog, progress);
    if (!draft) return;
    input.value = appendDraft(input.value, draft);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.close('draft');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollTop = input.scrollHeight;
}

function draftButton(item, kind) {
    return button('填入输入框', () => fillDraft([{ item, kind }]), 'stt-action stt-draft');
}

function renderTech(node) {
    const state = evaluate(node, dataCatalog, progress);
    const subtitle = [FIELD_NAMES[node.field], node.tier === null ? '' : 'T' + node.tier, node.id].filter(Boolean).join(' · ');
    const badge = state.status === 'repeated' ? '已循环 ' + state.cycles + ' 次' : STATUS[state.status];
    detailTitle(node.name, subtitle, badge, state.status);
    const host = elements.detail;
    hint(host, node.summary);
    if (state.groups.length || state.tier || state.conditions.length) {
        const needs = block(host, '前置与条件');
        for (const options of state.groups) {
            const row = element('div', '', 'stt-req-row');
            const met = options.some(option => option.done);
            row.append(element('span', met ? '✓' : '○', 'stt-check' + (met ? ' is-done' : '')));
            if (options.length > 1) row.append(element('span', '任选一项', 'stt-option-label'));
            for (const option of options) {
                if (option.id) row.append(referenceButton(dataCatalog.nodes.get(option.id), option.done));
                else row.append(conditionButton(option.external, externalKey(option), option.done));
            }
            needs.append(row);
        }
        if (state.tier) {
            const { level, count, required } = state.tier;
            const line = (count >= required ? '✓ ' : '○ ') + FIELD_NAMES[node.field] + ' T' + level + ' 累计 ' + count + ' / ' + required + ' 项';
            const label = element('p', line, 'stt-tier-check');
            if (count >= required) label.classList.add('is-done');
            needs.append(label);
        }
        for (const condition of state.conditions) needs.append(conditionButton(condition.label, condition.key, condition.done));
    }
    if (node.output) {
        const output = block(host, '交付');
        hint(output, node.output);
    }
    if (node.note && !node.requirements.includes(node.note)) hint(host, node.note);
    if (view !== 'FOCUS') host.append(button('查看目标路线', () => selectTech(node.id, true), 'stt-action stt-route-link'));
    const after = dataCatalog.children.get(node.id) ?? [];
    if (after.length) {
        const section = block(host, '直接后置');
        const links = element('div', '', 'stt-links');
        for (const nextId of after) links.append(referenceButton(dataCatalog.nodes.get(nextId), progress.learned.has(nextId)));
        section.append(links);
    }
    const lines = node.details.filter(line => line !== node.summary
        && !line.startsWith('依赖本节点的后置：')
        && !line.startsWith('科技释义：') && !line.startsWith('档案释义：'));
    if (lines.length) {
        const dossier = block(host, '档案');
        for (const line of lines) hint(dossier, line);
    }
    const actions = elements.detailActions;
    actions.append(draftButton(node, 'node'));
    if (!canRegisterNode(node)) return;
    if (state.cycles !== null) {
        const changeCycles = count => editConversation(() => setResearchCycles(profile(), node.id, count));
        if (state.cycles > 0) {
            const undo = recordButton('撤回一轮', () => changeCycles(state.cycles - 1), 'stt-action');
            undo.dataset.focusKey = 'undo-cycle';
            actions.append(undo);
        }
        const mark = recordButton('登记完成一轮', () => changeCycles(state.cycles + 1), 'stt-action stt-primary');
        mark.disabled ||= state.cycles === Number.MAX_SAFE_INTEGER;
        mark.dataset.focusKey = 'mark';
        actions.append(mark);
        return;
    }
    const learned = progress.learned.has(node.id);
    const text = learned ? '撤销登记' : node.field === 'M' ? '登记已达成' : '标记已掌握';
    const mark = recordButton(text, () => {
        const changed = editConversation(() => {
            profile().learned = toggle(profile().learned, node.id);
        });
        if (changed && node.id === 'gateway_construction' && !learned) notice(GATEWAY_NOTICE);
    }, 'stt-action ' + (learned ? '' : 'stt-primary'));
    mark.dataset.focusKey = 'mark';
    actions.append(mark);
}

function renderRoute(route) {
    const lvl = profile().stages[route.id] ?? 0;
    detailTitle(route.name, '文明飞升 · ' + route.id, lvl ? STAGES[lvl - 1] + '已登记' : '待立项', lvl ? 'achieved' : 'locked');
    const host = elements.detail;
    const chain = element('ol', '', 'stt-stage-chain');
    route.stages.forEach((stage, index) => {
        const item = element('li', '', index < lvl ? 'is-done' : '');
        item.append(element('strong', STAGES[index]), element('span', stage));
        chain.append(item);
    });
    host.append(chain);
    if (route.parent) {
        const parent = dataCatalog.routes.get(route.parent);
        host.append(button('返回' + parent.name, () => selectAscension(parent.id, 'route'), 'stt-reference'));
    }
    if (route.perks.length) {
        const section = block(host, '相关飞升天赋');
        for (const id of route.perks) {
            const perk = dataCatalog.perks.get(id);
            section.append(button(perk.name, () => selectAscension(id, 'perk'), 'stt-reference'));
        }
    }
    for (const line of route.details) hint(host, line);
    const actions = elements.detailActions;
    actions.append(draftButton(route, 'route'));
    if (lvl > 0) actions.append(recordButton('撤回阶段', () => changeStage(route.id, lvl - 1), 'stt-action'));
    if (lvl < 3) actions.append(recordButton('登记' + STAGES[lvl], () => changeStage(route.id, lvl + 1), 'stt-action stt-primary'));
}

function changeStage(id, level) {
    editConversation(() => {
        if (level) profile().stages[id] = level;
        else delete profile().stages[id];
    });
}

function renderPerk(perk) {
    const saved = progress.perks.has(perk.id);
    detailTitle(perk.name, '飞升天赋 · ' + perk.id, saved ? '已采纳' : perk.type, saved ? 'achieved' : 'locked');
    for (const line of perk.details) hint(elements.detail, line);
    elements.detailActions.append(draftButton(perk, 'perk'));
    elements.detailActions.append(recordButton(saved ? '撤销采纳' : '登记已采纳', () => {
        editConversation(() => {
            profile().perks = toggle(profile().perks, perk.id);
        });
    }, 'stt-action ' + (saved ? '' : 'stt-primary')));
}

function renderDetail() {
    const top = elements.detail.scrollTop;
    const previousId = elements.detail.dataset.id;
    elements.detail.replaceChildren();
    elements.detailActions.replaceChildren();
    if (!selection) {
        delete elements.detail.dataset.id;
        detailTitle('档案详情', '科研台');
        if (view === 'ME') hint(elements.detail, dataCatalog.data.definitions.ME);
        hint(elements.detail, view === 'ASC' ? '选择一条文明路线或天赋查看档案。' : '选择科技节点，查看前置条件与交付。');
        return;
    }
    const { kind, id } = selection;
    if (kind === 'node') renderTech(dataCatalog.nodes.get(id));
    else if (kind === 'route') renderRoute(dataCatalog.routes.get(id));
    else renderPerk(dataCatalog.perks.get(id));
    elements.detail.dataset.id = id;
    elements.detail.scrollTop = previousId === id ? top : 0;
}

function bindShell() {
    const find = selector => dialog.querySelector(selector);
    elements = {
        alert: find('.stt-alert'), search: find('.stt-search input'), results: find('.stt-results'),
        profileSelect: find('.stt-profile-tools > select'), profileMenu: find('.stt-profile-menu'),
        profileActions: find('.stt-profile-actions'), tabs: find('.stt-tabs'),
        graph: find('.stt-graph'), graphView: find('.stt-graph-view'), graphChecks: find('.stt-graph-checks'),
        graphActions: find('.stt-board-actions'), graphLegend: find('.stt-board-footer'),
        boardName: find('.stt-board-name'), ascension: find('.stt-asc-page'),
        inspector: find('.stt-inspector'), inspectorTitle: find('.stt-inspector-title'),
        detail: find('.stt-detail'), detailActions: find('.stt-detail-actions'),
        batchCount: find('.stt-batch-count'), batchList: find('.stt-batch-list'),
        batchClear: find('.stt-batch-clear'), batchLearn: find('.stt-batch-learn'), batchFill: find('.stt-batch-fill'),
    };
    const select = element('select', '', 'stt-tier');
    select.setAttribute('aria-label', '按阶位筛选');
    for (const rank of ['', '0', '1', '2', '3', '4', '5']) {
        const option = element('option', rank === '' ? '全部阶位' : 'T' + rank);
        option.value = rank;
        select.append(option);
    }
    elements.tier = select;
    find('.stt-boardbar').insertBefore(select, elements.graphActions);
    select.addEventListener('change', () => {
        if (selection && !visibleNodes().some(node => node.id === selection.id)) {
            selection = null;
            elements.inspector.dataset.open = 'false';
        }
        renderView();
    });
    const designOpen = find('.stt-design-open');
    const researchShell = find('.stt-shell');
    const returnToResearch = () => {
        researchShell.hidden = false;
        dialog.setAttribute('aria-labelledby', 'stt-title');
        if (dialog.open) {
            graph?.resize();
            designOpen.focus({ preventScroll: true });
        }
    };
    designOpen.addEventListener('click', () => {
        shipDesigner ??= createShipDesigner({
            dialog, store: fleetStore, getConversation, returnToResearch, element, button,
            getCivilization: () => settings ? profile().civilizationType : 'regular',
        });
        hideSearch();
        setProfileMenu(false);
        researchShell.hidden = true;
        dialog.setAttribute('aria-labelledby', 'stt-design-heading');
        void shipDesigner.open();
        void syncFleet();
    });
    find('.stt-close').addEventListener('click', () => dialog.close());
    find('.stt-hide-detail').addEventListener('click', () => {
        elements.inspector.dataset.open = 'false';
        find('.stt-close').focus({ preventScroll: true });
    });
    find('.stt-minus').addEventListener('click', () => graph?.zoom(0.78));
    find('.stt-plus').addEventListener('click', () => graph?.zoom(1.28));
    find('.stt-fit').addEventListener('click', () => graph?.fit());
    elements.batchClear.addEventListener('click', () => {
        batchProjects.clear();
        renderBatch();
    });
    elements.batchLearn.addEventListener('click', learnBatch);
    elements.batchFill.addEventListener('click', () => fillDraft([...batchProjects.values()]));
    elements.profileSelect.addEventListener('change', event => changeProfile(event.target.value));
    elements.profileMenu.addEventListener('click', () => setProfileMenu(!profileMenuOpen));
    const civilizationField = element('div', '', 'stt-civilization-field');
    const civilizationLabel = element('label', '文明类型');
    const civilizationSelect = element('select');
    civilizationSelect.id = 'stt-civilization-type';
    civilizationLabel.htmlFor = civilizationSelect.id;
    for (const [id, name] of Object.entries(CIVILIZATION_TYPES)) {
        const option = element('option', name);
        option.value = id;
        civilizationSelect.append(option);
    }
    elements.civilizationSelect = civilizationSelect;
    civilizationField.append(civilizationLabel, civilizationSelect);
    elements.profileActions.append(civilizationField);
    civilizationSelect.addEventListener('change', () => {
        const type = civilizationSelect.value;
        if (!Object.hasOwn(CIVILIZATION_TYPES, type)) return;
        if (editConversation(() => { profile().civilizationType = type; })) {
            setProfileMenu(false);
            elements.profileMenu.focus({ preventScroll: true });
        }
    });
    const file = element('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', importProfile);
    dialog.append(file);
    for (const [label, action] of [
        ['新建文明档案', () => renameOrCreate('new')],
        ['复制当前档案', () => renameOrCreate('copy')],
        ['重命名当前档案', () => renameOrCreate('rename')],
        ['导出当前档案', exportProfile],
        ['导入文明档案', () => file.click()],
    ]) {
        elements.profileActions.append(button(label, () => {
            setProfileMenu(false);
            action();
        }));
    }
    elements.legacyImport = button('复制旧版全局档案到此会话', () => {
        setProfileMenu(false);
        importLegacyProfiles();
    });
    elements.legacyImport.hidden = true;
    elements.profileActions.append(elements.legacyImport);
    elements.search.addEventListener('input', renderSearch);
    elements.search.addEventListener('focus', renderSearch);
    elements.search.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !elements.results.hidden) {
            event.preventDefault();
            chooseSearch(searchResults[0]);
        } else if (event.key === 'Escape' && !elements.results.hidden) {
            event.preventDefault();
            event.stopPropagation();
            hideSearch(true);
        }
    });
    dialog.addEventListener('click', event => {
        if (!event.target.closest('.stt-search')) hideSearch();
        if (!event.target.closest('.stt-profile-tools')) setProfileMenu(false);
    });
    dialog.addEventListener('close', () => {
        if (shipDesigner?.visible) shipDesigner.close();
        hideSearch();
        setProfileMenu(false);
        if (dialog.returnValue !== 'draft') openingButton?.focus();
    });
}

async function loadCatalog() {
    const response = await fetch(new URL('./data/tech-tree.json', import.meta.url));
    if (!response.ok) throw new Error('数据文件无法载入（' + response.status + '）。');
    const data = await response.json();
    graph = createGraph(elements.graph, elements.graphChecks, selectTech, node => batchCheckbox(node, 'node'));
    catalogData = data;
    syncConversation();
}

async function openPanel(event) {
    openingButton = event.currentTarget;
    if (!dialog) {
        dialog = buildShell();
        bindShell();
    }
    if (!dialog.open) {
        dialog.returnValue = '';
        dialog.showModal();
        elements.search.blur();
        dialog.querySelector('.stt-close').focus({ preventScroll: true });
    }
    if (dataCatalog) {
        syncConversation();
        graph.resize();
        return;
    }
    const request = ++numberOfOpenRequests;
    notice('正在载入科技树…', 0);
    try {
        initialLoad ??= loadCatalog();
        await initialLoad;
        if (request === numberOfOpenRequests && chatKey) elements.alert.hidden = true;
    } catch (error) {
        initialLoad = undefined;
        notice('载入失败。' + error.message + '关闭面板后可重试。', 0);
        console.error(NAME, error);
    }
}

function mount() {
    const { eventSource, eventTypes } = globalThis.SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        syncConversation();
        return syncFleet();
    });
    if (eventTypes.APP_READY) eventSource.on(eventTypes.APP_READY, syncFleet);
    if (eventTypes.WORLDINFO_ENTRIES_LOADED) {
        eventSource.on(eventTypes.WORLDINFO_ENTRIES_LOADED, async sources => {
            try {
                await fleetStore.includeSupplementalLore(sources);
            } catch (error) {
                console.warn(NAME, error);
            }
        });
    }
    void syncFleet();
    const menu = document.getElementById('extensionsMenu');
    const settingsArea = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (menu && !document.getElementById('stt-open-menu')) {
        const shortcut = button(NAME, openPanel, 'list-group-item flex-container');
        shortcut.id = 'stt-open-menu';
        menu.append(shortcut);
    }
    if (settingsArea && !document.getElementById('stt-open-settings')) {
        const settingsButton = button('打开' + NAME, openPanel, 'menu_button');
        settingsButton.id = 'stt-open-settings';
        settingsArea.append(settingsButton);
    }
    const composer = document.getElementById('leftSendForm');
    if (composer && !document.getElementById('stt-open-composer')) {
        const composerButton = iconButton('✧', '打开' + NAME, openPanel);
        composerButton.id = 'stt-open-composer';
        composer.append(composerButton);
    }
}

mount();
