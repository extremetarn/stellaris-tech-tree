import {
    classLabel, CUSTOM_EQUIPMENT_GROUP, designPart, designUnlockError, equipmentAvailable, equipmentUnlocked,
    hullAvailable, hullUnlocked, HULL_GROUPS, HULLS,
    makeCustomEquipment, MAX_CLASS_NAME, MAX_EQUIPMENT_NAME, MAX_QUANTITY, newDesign, normalizeName, specLabel, totalDesign,
} from './ship-model.mjs';
import { createBlueprint, equipmentGroup, SHIP_SYSTEMS } from './ship-blueprint.mjs';

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

export function createShipDesigner({ dialog, store, getConversation, getResearch, returnToResearch, element, button }) {
    const page = element('section', '', 'stt-design-page');
    page.hidden = true;
    page.innerHTML = `
        <header class="stt-design-header">
            <div class="stt-design-heading">
                <button type="button" data-back>‹ 科研台</button>
                <h2 id="stt-design-heading">舰船设计器</h2>
            </div>
            <button type="button" class="stt-design-title" data-setup-toggle title="舰级设置" aria-expanded="false" aria-controls="stt-ship-setup">
                <strong data-class-name></strong><span aria-hidden="true">⌄</span>
            </button>
            <div class="stt-design-header-actions">
                <button type="button" data-library>设计库</button>
                <button type="button" data-close aria-label="关闭舰船设计器" class="stt-icon">×</button>
            </div>
        </header>
        <div class="stt-design-message" role="status" hidden></div>
        <div class="stt-design-editor" data-edit>
            <section class="stt-design-stage" data-stage aria-label="舰体蓝图">
                <div class="stt-blueprint"><img alt=""><div data-points></div></div>
            </section>
            <canvas class="stt-blueprint-lines" data-lines aria-hidden="true"></canvas>
            <div class="stt-design-overlays" data-overlays hidden>
                <section class="stt-design-system" data-system id="stt-blueprint-systems" aria-label="系统设备">
                    <div class="stt-design-chips" data-chips aria-label="设备分类"></div>
                    <div class="stt-design-installed-panel" data-installed-panel>
                        <header><h3>已装设备</h3><button type="button" data-dismiss class="stt-icon" aria-label="收起系统设备">×</button></header>
                        <div class="stt-design-installed" data-installed></div>
                    </div>
                </section>
                <section class="stt-design-add-panel" data-add id="stt-blueprint-add" aria-labelledby="stt-add-group" hidden>
                    <header><h3 data-add-title id="stt-add-group"></h3><button type="button" data-hide-catalog class="stt-icon" aria-label="收起加装列表">×</button></header>
                    <div class="stt-design-catalog-tools">
                        <input type="search" data-search placeholder="搜索本分类" aria-label="搜索舰装" autocomplete="off">
                        <button type="button" data-create-custom hidden>新建设备</button>
                    </div>
                    <div class="stt-design-catalog" data-catalog></div>
                </section>
            </div>
            <section class="stt-design-setup" data-setup id="stt-ship-setup" aria-label="舰级设置" hidden>
                <div class="stt-design-fields">
                    <label>舰种<select data-hull></select></label>
                    <label>舰级名称<input type="text" data-name placeholder="例如 海风级" autocomplete="off"></label>
                </div>
                <footer><small data-session></small><button type="button" data-new>新建设计</button><button type="button" data-done>完成</button></footer>
            </section>
        </div>
        <div class="stt-design-library" data-saved hidden>
            <section><h3>跨会话设计</h3><div data-designs></div></section>
            <section><h3>当前服役舰船列表</h3><div data-fleet></div></section>
        </div>
        <section class="stt-design-custom" data-custom-editor aria-labelledby="stt-custom-heading" hidden>
            <form>
                <h3 id="stt-custom-heading"></h3>
                <label>设备名称<input type="text" data-custom-name required autocomplete="off"></label>
                <div class="stt-design-fields stt-custom-budgets">
                    <label>负载<input type="number" data-custom-load required step="1" inputmode="numeric"></label>
                    <label>散热<input type="number" data-custom-heat required step="1" inputmode="numeric"></label>
                    <label>负载上限增量<input type="number" data-custom-capacity required step="1" inputmode="numeric"></label>
                </div>
                <label>原创设定<textarea data-custom-effect rows="7"></textarea></label>
                <footer>
                    <button type="button" data-delete-custom hidden>删除模板</button>
                    <button type="button" data-cancel-custom>取消</button>
                    <button type="submit" data-save-custom class="stt-primary">保存设备</button>
                </footer>
            </form>
        </section>
        <footer class="stt-design-footer">
            <div class="stt-design-footer-summary">
                <div class="stt-design-readouts">
                    <span data-load>负载 <strong></strong></span>
                    <span data-heat>散热 <strong></strong></span>
                </div>
                <span data-validation></span>
            </div>
            <button type="button" data-save class="stt-primary">保存并服役</button>
        </footer>`;
    page.setAttribute('aria-labelledby', 'stt-design-heading');
    dialog.append(page);
    const $ = selector => page.querySelector(selector);
    const ui = {
        back: $('[data-back]'), close: $('[data-close]'), library: $('[data-library]'),
        session: $('[data-session]'), message: $('.stt-design-message'), title: $('[data-setup-toggle]'),
        edit: $('[data-edit]'), saved: $('[data-saved]'), image: $('.stt-blueprint img'),
        stage: $('[data-stage]'), points: $('[data-points]'), lines: $('[data-lines]'),
        overlay: $('[data-overlays]'), system: $('[data-system]'), chips: $('[data-chips]'),
        className: $('[data-class-name]'), load: $('[data-load]'), heat: $('[data-heat]'),
        setup: $('[data-setup]'), hull: $('[data-hull]'), name: $('[data-name]'), fresh: $('[data-new]'),
        installed: $('[data-installed]'), installedPanel: $('[data-installed-panel]'),
        search: $('[data-search]'), add: $('[data-add]'), addTitle: $('[data-add-title]'),
        catalog: $('[data-catalog]'), designs: $('[data-designs]'), fleet: $('[data-fleet]'),
        customEditor: $('[data-custom-editor]'), customForm: $('[data-custom-editor] form'),
        customHeading: $('#stt-custom-heading'), customName: $('[data-custom-name]'),
        customLoad: $('[data-custom-load]'), customHeat: $('[data-custom-heat]'),
        customCapacity: $('[data-custom-capacity]'), customEffect: $('[data-custom-effect]'),
        createCustom: $('[data-create-custom]'), deleteCustom: $('[data-delete-custom]'),
        cancelCustom: $('[data-cancel-custom]'), saveCustom: $('[data-save-custom]'),
        footer: $('.stt-design-footer'), validation: $('[data-validation]'), save: $('[data-save]'),
    };
    const blueprint = createBlueprint({
        stage: ui.stage, image: ui.image, points: ui.points, overlay: ui.overlay,
        system: ui.system, chips: ui.chips, installed: ui.installedPanel, catalog: ui.add, lines: ui.lines,
        button, select: id => selectSystem(activeSystem === id ? '' : id),
    });
    ui.name.maxLength = MAX_CLASS_NAME;
    ui.customName.maxLength = MAX_EQUIPMENT_NAME;
    for (const input of [ui.customLoad, ui.customHeat, ui.customCapacity]) {
        input.min = '0';
        input.max = String(MAX_QUANTITY);
    }
    let design = newDesign();
    let savedDesign;
    let equipment = new Map();
    let catalogLoaded = false;
    let loading = false;
    let busy = false;
    let fleet = [];
    let fleetKey = '';
    let tab = 'editor';
    let limit = PAGE_SIZE;
    let activeSystem = '';
    let activeGroup = '';
    let customEditing;
    let messageTimer;

    function option(value, label) {
        const row = element('option', label);
        row.value = value;
        return row;
    }

    function message(text = '', error = false) {
        clearTimeout(messageTimer);
        ui.message.textContent = text;
        ui.message.hidden = !text;
        ui.message.classList.toggle('is-error', error);
        if (text && !error) messageTimer = setTimeout(() => { ui.message.hidden = true; }, 5000);
    }

    function budget(target, used, max) {
        target.querySelector('strong').textContent = `${used} / ${max}`;
        target.classList.toggle('is-over', used > max);
    }

    function renderTotals() {
        const hull = HULLS.get(design.hullId);
        const research = getResearch();
        const totals = totalDesign(design, equipment, research.civilization);
        const { key } = getConversation();
        const fleetReady = Boolean(key && fleetKey === key);
        const savedLock = savedDesign && designUnlockError(savedDesign, equipment, research);
        const lock = savedLock || designUnlockError(design, equipment, research);
        ui.hull.disabled = ui.name.disabled = ui.stage.inert = ui.overlay.inert = Boolean(savedLock);
        ui.session.textContent = fleetReady ? '会话知识书已连接' : key ? '会话知识书待连接' : '未打开会话';
        ui.className.textContent = hull.name + ' · ' + (normalizeName(design.name) || '未命名舰级');
        budget(ui.load, totals.usedLoad, totals.maxLoad);
        ui.load.title = `舰体 ${totals.baseLoad} · 供能 +${totals.addedLoad}`;
        budget(ui.heat, totals.usedHeat, totals.maxHeat);
        ui.heat.title = '已装设备占用散热';
        ui.validation.textContent = lock || totals.errors[0] || (!key ? '打开会话后即可保存并服役。'
            : !fleetReady ? '保存时将连接会话知识书。'
                : !design.parts.length ? '点舰体上的波纹点加装设备。'
                    : !normalizeName(design.name) ? '点舰级名称进行命名。' : '');
        ui.validation.classList.toggle('is-error', Boolean(totals.errors.length || lock));
        ui.save.disabled = busy || !key || Boolean(lock) || !catalogLoaded || !normalizeName(design.name)
            || !design.parts.length || totals.errors.length > 0;
        ui.save.textContent = busy ? '正在保存…' : '保存并服役';
    }

    function renderHull() {
        const research = getResearch();
        const hull = HULLS.get(design.hullId);
        ui.hull.replaceChildren();
        for (const group of HULL_GROUPS) {
            const allowed = group.hulls.filter(hull => hullAvailable(hull, research.civilization));
            if (!allowed.length) continue;
            const groupOption = element('optgroup');
            groupOption.label = group.name;
            groupOption.append(...allowed.map(hull => {
                const unlocked = hullUnlocked(hull, research.unlocked);
                const choice = option(hull.id, hull.name + (unlocked ? '' : '（未解锁）'));
                choice.disabled = !unlocked;
                return choice;
            }));
            ui.hull.append(groupOption);
        }
        if (!hullAvailable(hull, research.civilization)) {
            const unavailable = option(hull.id, hull.name + '（当前文明不可用）');
            unavailable.disabled = true;
            ui.hull.prepend(unavailable);
        }
        ui.hull.value = hull.id;
        blueprint.setHull(hull);
    }

    function setSetup(open) {
        ui.setup.hidden = !open;
        ui.title.setAttribute('aria-expanded', String(open));
    }

    function selectSystem(id) {
        activeSystem = id;
        activeGroup = '';
        ui.overlay.scrollTop = 0;
        ui.overlay.hidden = !id;
        blueprint.setSelected(id);
        setSetup(false);
        renderSelection();
    }

    function selectGroup(name) {
        activeGroup = activeGroup === name ? '' : name;
        limit = PAGE_SIZE;
        ui.search.value = '';
        for (const control of ui.chips.children) {
            const active = control.textContent === activeGroup;
            control.setAttribute('aria-pressed', String(active));
            control.setAttribute('aria-expanded', String(active));
        }
        renderCatalog();
        if (activeGroup) ui.catalog.scrollTop = 0;
        blueprint.requestLayout();
    }

    function renderSelection() {
        ui.chips.replaceChildren();
        if (activeSystem) {
            const hull = HULLS.get(design.hullId);
            const research = getResearch();
            const available = new Set();
            if (catalogLoaded) {
                for (const part of equipment.values()) {
                    if (part.category === activeSystem && equipmentAvailable(part, hull, research.civilization)
                        && equipmentUnlocked(part, research.unlocked)) {
                        available.add(equipmentGroup(part));
                    }
                }
                available.add(CUSTOM_EQUIPMENT_GROUP);
            }
            const groups = SHIP_SYSTEMS[activeSystem].groups.map(([name]) => name);
            if (catalogLoaded) groups.push(CUSTOM_EQUIPMENT_GROUP);
            for (const name of groups) {
                if (catalogLoaded && !available.has(name)) continue;
                const chip = button(name, () => selectGroup(name));
                chip.setAttribute('aria-pressed', String(activeGroup === name));
                chip.setAttribute('aria-expanded', String(activeGroup === name));
                chip.setAttribute('aria-controls', 'stt-blueprint-add');
                ui.chips.append(chip);
            }
            if (activeGroup && !available.has(activeGroup) && catalogLoaded) activeGroup = '';
        }
        renderInstalled();
        renderCatalog();
        blueprint.requestLayout();
    }

    function renderInstalled() {
        ui.installed.replaceChildren();
        if (!activeSystem) return;
        if (!catalogLoaded) {
            ui.installed.append(element('p', '正在载入舰装…', 'stt-design-empty'));
            return;
        }
        const hull = HULLS.get(design.hullId);
        const research = getResearch();
        for (const [index, row] of design.parts.entries()) {
            const part = designPart(row, equipment);
            if ((part?.category ?? 'device') !== activeSystem) continue;
            const spec = part?.specs[row.size];
            const card = element('div', '', 'stt-design-installed-row');
            const info = element('div');
            const label = (part?.name ?? '无法读取的舰装') + (row.size ? ' · ' + row.size : '');
            info.append(element('strong', label));
            const primary = part?.stats[0]?.join(' ');
            info.append(element('small', primary || (spec ? specLabel(spec) : '请重新选择舰装')));
            if (part && !equipmentAvailable(part, hull, research.civilization)) info.append(element('small', '当前舰体不相容', 'is-error'));
            else if (part && !equipmentUnlocked(part, research.unlocked)) info.append(element('small', '科技未解锁', 'is-error'));
            const quantity = element('div', '', 'stt-design-quantity');
            quantity.setAttribute('role', 'group');
            quantity.setAttribute('aria-label', label + '数量');
            const count = element('output');
            const decrease = button('−', () => changeQuantity(-1));
            const increase = button('＋', () => changeQuantity(1));
            decrease.setAttribute('aria-label', '减少' + label + '数量');
            increase.setAttribute('aria-label', '增加' + label + '数量');
            function updateQuantity() {
                count.value = String(row.quantity);
                decrease.disabled = row.quantity <= 1;
                increase.disabled = row.quantity >= MAX_QUANTITY;
            }
            function changeQuantity(delta) {
                row.quantity = Math.max(1, Math.min(MAX_QUANTITY, row.quantity + delta));
                updateQuantity();
                renderTotals();
            }
            updateQuantity();
            quantity.append(decrease, count, increase);
            const remove = button('×', () => {
                design.parts.splice(index, 1);
                renderInstalled();
                renderTotals();
            }, 'stt-icon');
            remove.setAttribute('aria-label', '移除' + label);
            const actions = element('div', '', 'stt-design-installed-actions');
            actions.append(quantity, remove);
            card.append(info, actions);
            ui.installed.append(card);
        }
        if (!ui.installed.childElementCount) ui.installed.append(element('p', '此系统尚未装配。', 'stt-design-empty'));
        blueprint.requestLayout();
    }

    function addPart(part, size) {
        const existing = design.parts.find(row => row.id === part.id && row.size === size
            && (!part.custom || JSON.stringify(row.customEquipment) === JSON.stringify(part)));
        if (existing) existing.quantity = Math.min(MAX_QUANTITY, (existing.quantity || 0) + 1);
        else {
            const row = { id: part.id, size, quantity: 1 };
            if (part.custom) row.customEquipment = structuredClone(part);
            design.parts.push(row);
        }
        message();
        renderInstalled();
        renderTotals();
    }

    function renderCatalog() {
        ui.add.hidden = !activeSystem || !activeGroup;
        if (ui.add.hidden) return;
        ui.addTitle.textContent = activeGroup;
        const custom = activeGroup === CUSTOM_EQUIPMENT_GROUP;
        ui.createCustom.hidden = !custom;
        if (!catalogLoaded) {
            ui.catalog.replaceChildren(element('p', '正在载入舰装…', 'stt-design-empty'));
            return;
        }
        const needle = ui.search.value.normalize('NFKC').trim().toLocaleLowerCase();
        const hull = HULLS.get(design.hullId);
        const research = getResearch();
        const source = custom ? store.customEquipment() : equipment.values();
        const parts = Array.from(source).filter(part => part.category === activeSystem
            && (custom || equipmentGroup(part) === activeGroup) && equipmentAvailable(part, hull, research.civilization)
            && equipmentUnlocked(part, research.unlocked)
            && (!needle || [part.name, part.english, part.family, part.effect, ...part.stats.flat()]
                .some(value => value?.normalize('NFKC').toLocaleLowerCase().includes(needle))));
        if (!custom) {
            parts.sort((left, right) => (needle && Number(!left.name.startsWith(needle)) - Number(!right.name.startsWith(needle)))
                || left.tier - right.tier || left.name.localeCompare(right.name, 'zh-Hans'));
        }
        ui.catalog.replaceChildren();
        if (!parts.length) {
            const empty = custom && !needle ? '此系统暂无自定义设备。' : '没有匹配且相容的舰装。';
            ui.catalog.append(element('p', empty, 'stt-design-empty'));
        }
        for (const part of parts.slice(0, limit)) {
            const card = element('article', '', 'stt-design-part');
            const main = element('div');
            main.append(element('strong', part.name));
            if (!custom) main.append(element('small', `${part.family} · T${part.tier}`));
            if (part.stats.length) {
                main.append(element('p', part.stats.map(([name, value]) => `${name} ${value}`).join(' · ')));
            }
            if (part.effect || part.mount) {
                const details = element('details');
                details.append(element('summary', '说明'));
                if (part.effect) details.append(element('p', part.effect, custom ? 'stt-custom-effect' : ''));
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
            if (custom) {
                const edit = button('编辑', () => openCustomEditor(part), 'stt-custom-edit');
                edit.setAttribute('aria-label', '编辑' + part.name);
                actions.append(edit);
            }
            const add = button('＋', () => addPart(part, size.value), 'stt-icon');
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
        renderSelection();
        renderTotals();
    }

    function selectTab(next) {
        tab = next;
        const editing = tab === 'editor';
        const library = tab === 'library';
        ui.edit.hidden = !editing;
        ui.footer.hidden = !editing;
        ui.saved.hidden = !library;
        ui.customEditor.hidden = editing || library;
        ui.title.hidden = !editing;
        ui.library.hidden = !editing && !library;
        ui.library.textContent = editing ? '设计库' : '设计台';
        if (editing) renderDesign();
        else if (library) {
            selectSystem('');
            renderLibrary();
        }
    }

    function openCustomEditor(part) {
        if (busy) return;
        customEditing = part;
        const spec = part?.specs[''];
        const system = SHIP_SYSTEMS[activeSystem];
        ui.customHeading.textContent = (part ? '编辑自定义设备' : '新建自定义设备') + ' · ' + system.label;
        ui.customName.value = part?.name ?? '';
        ui.customLoad.value = spec?.load ?? 0;
        ui.customHeat.value = spec?.heat ?? 0;
        ui.customCapacity.value = spec?.capacity ?? 0;
        ui.customCapacity.parentElement.hidden = activeSystem !== 'power';
        ui.customEffect.value = part?.effect ?? '';
        ui.deleteCustom.hidden = !part;
        message();
        selectTab('custom');
        ui.customName.focus({ preventScroll: true });
    }

    function finishCustomEditor() {
        customEditing = undefined;
        selectTab('editor');
        ui.createCustom.focus({ preventScroll: true });
    }

    async function saveCustomEquipment(id, part) {
        if (busy) return;
        busy = true;
        for (const field of ui.customForm.elements) field.disabled = true;
        try {
            await store.saveCustomEquipment(id, part);
            if (!page.hidden && tab === 'custom') {
                ui.search.value = '';
                limit = PAGE_SIZE;
                finishCustomEditor();
                message(part ? '自定义设备已保存。' : '自定义设备模板已删除。');
            }
        } catch (error) {
            if (!page.hidden) message(error.message, true);
        } finally {
            busy = false;
            for (const field of ui.customForm.elements) field.disabled = false;
            renderTotals();
            if (tab === 'library') renderLibrary();
        }
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
        const research = getResearch();
        const saved = store.library().filter(item => HULLS.has(item.hullId));
        ui.designs.replaceChildren();
        for (const item of saved) {
            const lock = catalogLoaded ? designUnlockError(item, equipment, research) : '';
            const edit = button('编辑', () => {
                savedDesign = item;
                design = structuredClone(item);
                limit = PAGE_SIZE;
                ui.search.value = '';
                selectSystem('');
                message();
                selectTab('editor');
            });
            edit.disabled = busy || !key || !catalogLoaded || Boolean(lock);
            const row = libraryRow(item, edit);
            if (lock) {
                row.classList.add('is-locked');
                row.firstElementChild.append(element('small', '未解锁 · ' + lock, 'stt-design-lock'));
            }
            const active = fleet.some(ship => ship.id === item.id && JSON.stringify(ship) === JSON.stringify(item));
            const deploy = button(active ? '已服役' : '在本会话服役', () => performActivation(item, false));
            deploy.disabled = busy || !key || !catalogLoaded || active || Boolean(lock);
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
        const snapshot = structuredClone(item);
        void act(key => store.activate(key, snapshot, equipment, save), result => {
            fleet = result.fleet;
            if (save && design.id === snapshot.id) {
                if (!result.libraryError) savedDesign = result.design;
                if (JSON.stringify(design) === JSON.stringify(snapshot)) {
                    design = structuredClone(result.design);
                    ui.name.value = design.name;
                    renderInstalled();
                }
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
            equipment = await loadEquipment();
            catalogLoaded = true;
            refreshResearch();
        } catch (error) {
            message(error.message + '，返回设计台可重试。', true);
        } finally {
            loading = false;
        }
    }

    function setFleet(key, items, error) {
        fleetKey = error ? '' : key;
        fleet = items;
        if (page.hidden) return;
        if (error) message(error.message, true);
        refreshResearch();
    }

    function refreshResearch() {
        if (page.hidden) return;
        if (tab === 'editor') renderDesign();
        else if (tab === 'library') renderLibrary();
    }

    function close() {
        selectSystem('');
        if (tab === 'custom') finishCustomEditor();
        page.hidden = true;
        returnToResearch();
    }

    function dismissSystem() {
        const id = activeSystem;
        selectSystem('');
        blueprint.focus(id);
    }

    function dismissCatalog() {
        const control = ui.chips.querySelector('[aria-pressed="true"]');
        selectGroup(activeGroup);
        control?.focus({ preventScroll: true });
    }

    ui.back.addEventListener('click', close);
    ui.close.addEventListener('click', () => dialog.close());
    ui.library.addEventListener('click', () => {
        selectTab(tab === 'editor' ? 'library' : 'editor');
        if (tab === 'editor' && !catalogLoaded && !loading) void open();
    });
    ui.title.addEventListener('click', () => {
        const open = ui.setup.hidden;
        selectSystem('');
        setSetup(open);
        if (open) ui.hull.focus({ preventScroll: true });
    });
    $('[data-done]').addEventListener('click', () => {
        setSetup(false);
        ui.title.focus({ preventScroll: true });
    });
    $('[data-dismiss]').addEventListener('click', dismissSystem);
    $('[data-hide-catalog]').addEventListener('click', dismissCatalog);
    ui.createCustom.addEventListener('click', () => openCustomEditor());
    ui.cancelCustom.addEventListener('click', finishCustomEditor);
    ui.deleteCustom.addEventListener('click', () => {
        if (customEditing && window.confirm('删除自定义设备模板「' + customEditing.name + '」？')) {
            void saveCustomEquipment(customEditing.id, null);
        }
    });
    ui.customForm.addEventListener('submit', event => {
        event.preventDefault();
        try {
            const part = makeCustomEquipment({
                id: customEditing?.id, category: activeSystem, name: ui.customName.value,
                load: ui.customLoad.valueAsNumber, heat: ui.customHeat.valueAsNumber,
                capacity: ui.customCapacity.valueAsNumber, effect: ui.customEffect.value,
            });
            void saveCustomEquipment(part.id, part);
        } catch (error) {
            message(error.message, true);
        }
    });
    ui.stage.addEventListener('click', event => {
        if (!event.target.closest('.stt-blueprint-point')) selectSystem('');
    });
    page.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (tab === 'custom') {
            if (!busy) finishCustomEditor();
        } else if (!ui.setup.hidden) {
            setSetup(false);
            ui.title.focus({ preventScroll: true });
        } else if (activeGroup) dismissCatalog();
        else if (activeSystem) dismissSystem();
        else return;
        event.preventDefault();
        event.stopPropagation();
    });
    ui.hull.addEventListener('change', () => {
        design.hullId = ui.hull.value;
        renderDesign();
    });
    ui.name.addEventListener('input', () => {
        design.name = ui.name.value;
        renderTotals();
    });
    ui.fresh.addEventListener('click', () => {
        const hull = HULLS.get(design.hullId);
        const research = getResearch();
        const keepHull = hullAvailable(hull, research.civilization) && hullUnlocked(hull, research.unlocked);
        design = newDesign(keepHull ? hull.id : 'corvette');
        savedDesign = undefined;
        message();
        renderDesign();
        ui.name.focus();
    });
    ui.search.addEventListener('input', () => {
        limit = PAGE_SIZE;
        ui.catalog.scrollTop = 0;
        renderCatalog();
        blueprint.requestLayout();
    });
    ui.save.addEventListener('click', () => performActivation(design, true));
    return { open, setFleet, refreshResearch, close, get visible() { return !page.hidden; } };
}
