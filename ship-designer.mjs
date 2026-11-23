import {
    classLabel, equipmentAvailable, EQUIPMENT_TYPES, hullAvailable, HULL_GROUPS, HULLS,
    MAX_CLASS_NAME, MAX_QUANTITY, newDesign, normalizeName, specLabel, totalDesign,
} from './ship-model.mjs';

const PAGE_SIZE = 18;
let catalogPromise;

function loadEquipment() {
    catalogPromise ??= fetch(new URL('./data/ship-equipment.json', import.meta.url))
        .then(response => {
            if (!response.ok) throw new Error('舰装目录无法载入（' + response.status + '）。');
            return response.json();
        })
        .then(parts => new Map(parts.map(part => [part.id, part])))
        .catch(error => {
            catalogPromise = undefined;
            throw error;
        });
    return catalogPromise;
}

export function createShipDesigner({ dialog, store, getConversation, getCivilization, returnToResearch, element, button }) {
    const page = element('section', '', 'stt-design-page');
    page.hidden = true;
    page.innerHTML = `
        <header class="stt-design-header">
            <button type="button" data-back>← 科研台</button>
            <h2 id="stt-design-heading">舰船设计器</h2>
            <button type="button" data-close aria-label="关闭舰船设计器" class="stt-icon">×</button>
        </header>
        <nav class="stt-design-nav" aria-label="舰船设计器页面">
            <button type="button" data-designer>设计台</button>
            <button type="button" data-library>设计库</button>
            <span data-session></span>
        </nav>
        <div class="stt-design-message" role="status" hidden></div>
        <div class="stt-design-grid" data-edit>
            <section class="stt-design-board" aria-label="舰体蓝图与额度">
                <header>
                    <span data-hull-name></span>
                    <h3 data-class-name></h3>
                </header>
                <div class="stt-blueprint"><img alt=""></div>
                <div class="stt-design-budgets">
                    <div class="stt-budget" data-load>
                        <div><strong>负载</strong><span></span></div>
                        <meter aria-label="负载额度" min="0"></meter>
                        <small></small>
                    </div>
                    <div class="stt-budget" data-heat>
                        <div><strong>散热</strong><span></span></div>
                        <meter aria-label="散热额度" min="0"></meter>
                        <small></small>
                    </div>
                </div>
            </section>
            <div class="stt-design-workbench">
                <div class="stt-design-fields">
                    <label>舰种<select data-hull></select></label>
                    <label>舰级名称<input type="text" data-name placeholder="例如 海风级" autocomplete="off"></label>
                </div>
                <section class="stt-design-section">
                    <div class="stt-design-section-title"><h3>已装舰装</h3><button type="button" data-new>新建设计</button></div>
                    <div class="stt-design-installed" data-installed></div>
                </section>
                <section class="stt-design-section">
                    <h3>舰装目录</h3>
                    <div class="stt-design-filters">
                        <input type="search" data-search placeholder="搜索舰装、型号或效果" aria-label="搜索舰装" autocomplete="off">
                        <select data-category aria-label="舰装分类"></select>
                    </div>
                    <div class="stt-design-catalog" data-catalog></div>
                </section>
            </div>
        </div>
        <div class="stt-design-library" data-saved hidden>
            <section><h3>跨会话设计</h3><div data-designs></div></section>
            <section><h3>当前服役舰船列表</h3><div data-fleet></div></section>
        </div>
        <footer class="stt-design-footer">
            <div class="stt-design-footer-summary">
                <strong data-compact-budgets></strong>
                <span data-validation></span>
            </div>
            <button type="button" data-save class="stt-primary">保存并服役</button>
        </footer>`;
    page.setAttribute('aria-labelledby', 'stt-design-heading');
    dialog.append(page);
    const $ = selector => page.querySelector(selector);
    const ui = {
        back: $('[data-back]'), close: $('[data-close]'), designer: $('[data-designer]'),
        library: $('[data-library]'), session: $('[data-session]'), message: $('.stt-design-message'),
        edit: $('[data-edit]'), saved: $('[data-saved]'), image: $('.stt-blueprint img'),
        hullName: $('[data-hull-name]'), className: $('[data-class-name]'), load: $('[data-load]'),
        heat: $('[data-heat]'), hull: $('[data-hull]'), name: $('[data-name]'), fresh: $('[data-new]'),
        installed: $('[data-installed]'), search: $('[data-search]'), category: $('[data-category]'),
        catalog: $('[data-catalog]'), designs: $('[data-designs]'), fleet: $('[data-fleet]'),
        footer: $('.stt-design-footer'), compactBudgets: $('[data-compact-budgets]'), validation: $('[data-validation]'), save: $('[data-save]'),
    };
    ui.name.maxLength = MAX_CLASS_NAME;
    let design = newDesign();
    let equipment = new Map();
    let catalogLoaded = false;
    let loading = false;
    let busy = false;
    let fleet = [];
    let fleetKey = '';
    let tab = 'editor';
    let limit = PAGE_SIZE;

    function option(value, label) {
        const row = element('option', label);
        row.value = value;
        return row;
    }

    function message(text = '', error = false) {
        ui.message.textContent = text;
        ui.message.hidden = !text;
        ui.message.classList.toggle('is-error', error);
    }

    function budget(target, used, max, caption) {
        const value = target.querySelector('span');
        const meter = target.querySelector('meter');
        value.textContent = `${used} / ${max}`;
        meter.max = max || 1;
        meter.value = Math.min(used, meter.max);
        meter.setAttribute('aria-valuetext', `${used} / ${max}`);
        target.querySelector('small').textContent = caption;
        target.classList.toggle('is-over', used > max);
    }

    function renderTotals() {
        const hull = HULLS.get(design.hullId);
        const totals = totalDesign(design, equipment, getCivilization());
        const { key } = getConversation();
        const fleetReady = Boolean(key && fleetKey === key);
        const available = hullAvailable(hull, getCivilization());
        ui.session.textContent = fleetReady ? '会话知识书已连接' : key ? '会话知识书待连接' : '未打开会话';
        ui.className.textContent = normalizeName(design.name) || '未命名舰级';
        budget(ui.load, totals.usedLoad, totals.maxLoad, `舰体 ${totals.baseLoad} · 供能 +${totals.addedLoad}`);
        budget(ui.heat, totals.usedHeat, totals.maxHeat, '供能设备占用散热');
        ui.compactBudgets.textContent = `负载 ${totals.usedLoad}/${totals.maxLoad} · 散热 ${totals.usedHeat}/${totals.maxHeat}`;
        ui.validation.textContent = totals.errors[0] || (!available ? '当前文明无法使用这种舰体。'
            : !key ? '打开会话后即可保存并服役。' : !fleetReady ? '保存时将连接会话知识书。'
                : !normalizeName(design.name) ? '请输入舰级名称。'
                    : !design.parts.length ? '从舰装目录添加装备。' : '可保存并在本会话服役。');
        ui.validation.classList.toggle('is-error', Boolean(totals.errors.length || !available));
        ui.save.disabled = busy || !key || !available || !catalogLoaded || !normalizeName(design.name)
            || !design.parts.length || totals.errors.length > 0;
        ui.save.textContent = busy ? '正在保存…' : '保存并服役';
    }

    function renderHull() {
        const type = getCivilization();
        const hull = HULLS.get(design.hullId);
        ui.hull.replaceChildren();
        for (const group of HULL_GROUPS) {
            const allowed = group.hulls.filter(hull => hullAvailable(hull, type));
            if (!allowed.length) continue;
            const groupOption = element('optgroup');
            groupOption.label = group.name;
            groupOption.append(...allowed.map(hull => option(hull.id, hull.name)));
            ui.hull.append(groupOption);
        }
        if (!hullAvailable(hull, type)) {
            const unavailable = option(hull.id, hull.name + '（当前文明不可用）');
            unavailable.disabled = true;
            ui.hull.prepend(unavailable);
        }
        ui.hull.value = hull.id;
        ui.hullName.textContent = hull.name;
        if (ui.image.dataset.hull !== hull.id) {
            ui.image.dataset.hull = hull.id;
            ui.image.alt = hull.name + '线稿蓝图';
            ui.image.src = new URL(`./assets/blueprints/${hull.id}.webp`, import.meta.url).href;
        }
    }

    function renderInstalled() {
        if (!catalogLoaded) {
            ui.installed.replaceChildren();
            return;
        }
        const hull = HULLS.get(design.hullId);
        ui.installed.replaceChildren();
        if (!design.parts.length) ui.installed.append(element('p', '尚未装配舰装。', 'stt-design-empty'));
        for (const [index, row] of design.parts.entries()) {
            const part = equipment.get(row.id);
            const spec = part?.specs[row.size];
            const card = element('div', '', 'stt-design-installed-row');
            const info = element('div');
            const label = (part?.name ?? '无法读取的舰装') + (row.size ? ' · ' + row.size : '');
            info.append(element('strong', label));
            info.append(element('small', spec ? specLabel(spec) : '请重新选择舰装'));
            if (part && !equipmentAvailable(part, hull, getCivilization())) info.append(element('small', '当前舰体不相容', 'is-error'));
            const count = element('input');
            count.type = 'number';
            count.inputMode = 'numeric';
            count.min = '1';
            count.max = String(MAX_QUANTITY);
            count.step = '1';
            count.value = String(row.quantity);
            count.setAttribute('aria-label', label + '数量');
            count.addEventListener('input', () => {
                row.quantity = count.valueAsNumber;
                renderTotals();
            });
            count.addEventListener('change', () => {
                if (!Number.isInteger(row.quantity)) row.quantity = 1;
                row.quantity = Math.max(1, Math.min(MAX_QUANTITY, row.quantity));
                count.value = String(row.quantity);
                renderTotals();
            });
            const remove = button('×', () => {
                design.parts.splice(index, 1);
                renderInstalled();
                renderTotals();
            }, 'stt-icon');
            remove.setAttribute('aria-label', '移除' + label);
            card.append(info, count, remove);
            ui.installed.append(card);
        }
    }

    function addPart(part, size) {
        const existing = design.parts.find(row => row.id === part.id && row.size === size);
        if (existing) existing.quantity = Math.min(MAX_QUANTITY, (existing.quantity || 0) + 1);
        else design.parts.push({ id: part.id, size, quantity: 1 });
        message();
        renderInstalled();
        renderTotals();
    }

    function renderCatalog() {
        if (!catalogLoaded) return;
        const needle = ui.search.value.normalize('NFKC').trim().toLocaleLowerCase();
        const category = ui.category.value;
        const hull = HULLS.get(design.hullId);
        const parts = Array.from(equipment.values()).filter(part => equipmentAvailable(part, hull, getCivilization())
            && (!category || category === part.category)
            && (!needle || [part.name, part.english, part.family, part.effect, ...part.stats.flat()]
                .some(value => value.normalize('NFKC').toLocaleLowerCase().includes(needle))));
        parts.sort((left, right) => (needle && Number(!left.name.startsWith(needle)) - Number(!right.name.startsWith(needle)))
            || left.tier - right.tier || left.name.localeCompare(right.name, 'zh-Hans'));
        ui.catalog.replaceChildren();
        if (!parts.length) ui.catalog.append(element('p', '没有匹配且相容的舰装。', 'stt-design-empty'));
        for (const part of parts.slice(0, limit)) {
            const card = element('article', '', 'stt-design-part');
            const main = element('div');
            main.append(element('strong', part.name), element('small', `${part.family} · T${part.tier}`));
            if (part.stats.length) {
                main.append(element('p', part.stats.map(([name, value]) => `${name} ${value}`).join(' · ')));
            }
            if (part.effect || part.mount) {
                const details = element('details');
                details.append(element('summary', '说明'));
                if (part.effect) details.append(element('p', part.effect));
                if (part.mount) details.append(element('p', '装舰位置 · ' + part.mount));
                main.append(details);
            }
            const actions = element('div', '', 'stt-design-part-actions');
            const variants = Object.entries(part.specs);
            const size = element('select');
            size.setAttribute('aria-label', part.name + '规格');
            size.append(...variants.map(([key, spec]) => option(key, (key ? key + ' · ' : '') + specLabel(spec))));
            if (variants.length === 1) {
                actions.append(element('small', (variants[0][0] ? variants[0][0] + ' · ' : '') + specLabel(variants[0][1])));
            } else actions.append(size);
            const add = button('添加', () => addPart(part, size.value));
            add.setAttribute('aria-label', '添加' + part.name);
            actions.append(add);
            card.append(main, actions);
            ui.catalog.append(card);
        }
        if (parts.length > limit) ui.catalog.append(button('显示更多', () => { limit += PAGE_SIZE; renderCatalog(); }));
    }

    function renderDesign() {
        renderHull();
        ui.name.value = design.name;
        renderInstalled();
        renderCatalog();
        renderTotals();
    }

    function selectTab(next) {
        tab = next;
        const editing = tab === 'editor';
        ui.edit.hidden = !editing;
        ui.footer.hidden = !editing;
        ui.saved.hidden = editing;
        ui.designer.setAttribute('aria-pressed', String(editing));
        ui.library.setAttribute('aria-pressed', String(!editing));
        if (editing) renderDesign();
        else renderLibrary();
    }

    function libraryRow(item, action) {
        const row = element('article', '', 'stt-design-library-row');
        const label = element('div');
        label.append(element('strong', item.name), element('small', HULLS.get(item.hullId).name));
        row.append(label, action);
        return row;
    }

    function renderLibrary() {
        const { key } = getConversation();
        const type = getCivilization();
        const saved = store.library().filter(item => hullAvailable(HULLS.get(item.hullId), type));
        ui.designs.replaceChildren();
        for (const item of saved) {
            const row = libraryRow(item, button('编辑', () => {
                design = structuredClone(item);
                limit = PAGE_SIZE;
                ui.search.value = '';
                ui.category.value = '';
                message();
                selectTab('editor');
            }));
            const active = fleet.some(ship => ship.id === item.id && JSON.stringify(ship) === JSON.stringify(item));
            const deploy = button(active ? '已服役' : '在本会话服役', () => performActivation(item, false));
            deploy.disabled = busy || !key || !catalogLoaded || active;
            row.append(deploy);
            ui.designs.append(row);
        }
        if (!saved.length) ui.designs.append(element('p', '暂无可用的已保存设计。', 'stt-design-empty'));

        ui.fleet.replaceChildren();
        for (const item of fleet) {
            if (!HULLS.has(item.hullId)) continue;
            const retire = button('退役', () => performRetirement(item));
            retire.disabled = busy;
            ui.fleet.append(libraryRow(item, retire));
        }
        if (!fleet.length) {
            ui.fleet.append(element('p', key ? '本会话暂无已登记的服役舰船。' : '请先打开会话。', 'stt-design-empty'));
        }
    }

    async function act(task, onSuccess) {
        if (busy) return;
        const { key } = getConversation();
        if (!key) return;
        busy = true;
        message();
        renderTotals();
        if (tab !== 'editor') renderLibrary();
        try {
            const result = await task(key);
            if (getConversation().key !== key) return;
            fleetKey = key;
            onSuccess(result);
        } catch (error) {
            if (getConversation().key === key) message(error.message, true);
        } finally {
            busy = false;
            renderTotals();
            if (tab !== 'editor') renderLibrary();
        }
    }

    function performActivation(item, save) {
        const type = getCivilization();
        const snapshot = structuredClone(item);
        void act(key => store.activate(key, snapshot, equipment, type, save), result => {
            fleet = result.fleet;
            if (save && design.id === snapshot.id && JSON.stringify(design) === JSON.stringify(snapshot)) {
                design = result.design;
                ui.name.value = design.name;
            }
            if (result.libraryError) {
                message(classLabel(result.design) + ' 已在本会话服役。跨会话设计库保存失败，请再点一次「保存并服役」。', true);
            } else {
                message(classLabel(result.design) + (save ? ' 已保存并在本会话服役。' : ' 已在本会话服役。'));
            }
        });
    }

    function performRetirement(item) {
        void act(key => store.retire(key, item.id), result => {
            fleet = result;
            message(classLabel(item) + ' 已退出本会话服役。');
        });
    }

    async function open() {
        page.hidden = false;
        ui.back.focus({ preventScroll: true });
        selectTab(tab);
        if (catalogLoaded || loading) return;
        try {
            loading = true;
            ui.catalog.textContent = '正在载入舰装目录…';
            equipment = await loadEquipment();
            catalogLoaded = true;
            ui.catalog.textContent = '';
            renderDesign();
            if (tab !== 'editor') renderLibrary();
        } catch (error) {
            ui.catalog.replaceChildren(element('p', error.message, 'stt-design-empty'), button('重试', open));
        } finally {
            loading = false;
        }
    }

    function setFleet(key, items, error) {
        fleetKey = error ? '' : key;
        fleet = items;
        if (page.hidden) return;
        if (error) message(error.message, true);
        renderHull();
        renderTotals();
        if (tab !== 'editor') renderLibrary();
    }

    function close() {
        page.hidden = true;
        returnToResearch();
    }

    ui.back.addEventListener('click', close);
    ui.close.addEventListener('click', () => dialog.close());
    ui.designer.addEventListener('click', () => selectTab('editor'));
    ui.library.addEventListener('click', () => selectTab('library'));
    ui.hull.addEventListener('change', () => {
        design.hullId = ui.hull.value;
        limit = PAGE_SIZE;
        renderDesign();
    });
    ui.name.addEventListener('input', () => {
        design.name = ui.name.value;
        renderTotals();
    });
    ui.fresh.addEventListener('click', () => {
        design = newDesign(hullAvailable(HULLS.get(design.hullId), getCivilization()) ? design.hullId : 'corvette');
        message();
        ui.name.value = '';
        ui.name.focus();
        renderDesign();
    });
    ui.category.append(option('', '全部舰装'), ...Object.entries(EQUIPMENT_TYPES).map(([id, name]) => option(id, name)));
    for (const [input, event] of [[ui.search, 'input'], [ui.category, 'change']]) {
        input.addEventListener(event, () => { limit = PAGE_SIZE; renderCatalog(); });
    }
    ui.save.addEventListener('click', () => performActivation(design, true));
    return { open, setFleet, close, get visible() { return !page.hidden; } };
}
