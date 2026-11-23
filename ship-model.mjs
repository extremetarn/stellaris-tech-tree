import { DEFAULT_CIVILIZATION, supportsCivilization } from './civilizations.mjs';

export const DESIGN_SETTINGS = 'stellarisShipDesigns';
export const FLEET_LINK = 'stellarisChatFleet';
export const ROSTER_NAME = '当前服役舰船列表';
export const MAX_CLASS_NAME = 48;
export const MAX_QUANTITY = 9999;
export const MAX_EQUIPMENT_NAME = 80;
export const CUSTOM_EQUIPMENT_GROUP = '自定义设备';

let equipmentPromise;

export function loadEquipment() {
    equipmentPromise ??= fetch(new URL('./data/ship-equipment.json', import.meta.url))
        .then(response => {
            if (!response.ok) throw new Error('舰装目录无法载入（' + response.status + '）。');
            return response.json();
        })
        .then(parts => new Map(parts.map(part => [part.id, part])))
        .catch(error => {
            equipmentPromise = undefined;
            throw error;
        });
    return equipmentPromise;
}

export const EQUIPMENT_TYPES = {
    power: '供能', weapon: '武器', armor: '装甲', shield: '护盾', device: '设备',
};

// Hull allowances are design rules, independent of the World Book's per-part allowances.
export const HULL_GROUPS = [
    ['常规军舰', [
        ['corvette', '护卫舰', 30, 28, 'corvettes'],
        ['frigate', '雷击舰', 36, 32, null],
        ['destroyer', '驱逐舰', 55, 44, 'destroyers'],
        ['cruiser', '巡洋舰', 90, 68, 'cruisers'],
        ['battleship', '战列舰', 150, 100, 'battleships'],
    ]],
    ['大型舰', [
        ['titan', '泰坦', 210, 145, 'titans'],
        ['juggernaut', '主宰', 320, 230],
        ['colossus', '巨像', 275, 185],
        ['star_eater', '噬星舰', 370, 260, null],
    ]],
    ['方舟', [
        ['civilian_arkship', '民用方舟', 170, 125, 'civilian_arkship'],
        ['scientific_arkship', '科研方舟', 200, 145, 'science_arkship'],
        ['military_arkship', '军用方舟', 250, 185, 'military_arkship'],
    ]],
    ['生物舰', [
        ['mauler', '颚蚁', 35, 32, 'maulers', true],
        ['weaver', '织蛛', 58, 46, 'weavers', true],
        ['harbinger', '孵后', 105, 80, 'harbingers', true],
        ['stinger', '刺蜂', 155, 108, 'stingers', true],
        ['behemoth', '巨兽', 360, 245, null, true],
    ]],
    ['特种舰', [
        ['riddle_escort', '密语护航舰', 68, 54, 'cosmogenesis_escort'],
        ['enigma_battlecruiser', '神秘战巡舰', 185, 125, 'cosmogenesis_battlecruiser'],
        ['paradox_titan', '悖论泰坦舰', 295, 195, 'cosmogenesis_FE_titan'],
        ['cipher_mauler', '密文颚蚁', 68, 54, 'cosmogenesis_mauler', true],
        ['quandary_weaver', '困境织蛛', 100, 76, 'cosmogenesis_weaver', true],
        ['maze_harbinger', '迷宫孵后', 185, 125, 'cosmogenesis_harbinger', true],
        ['cryptic_stinger', '神秘刺蜂', 295, 195, 'cosmogenesis_stinger', true],
    ]],
    ['民用与支援舰', [
        ['science_ship', '科研船', 26, 26, null],
        ['construction_ship', '工程船', 45, 36, null],
        ['colony_ship', '殖民船', 65, 48, 'colonization_1'],
        ['transport_ship', '运输舰', 40, 32, null],
    ]],
].map(([name, rows]) => ({
    name, hulls: rows.map(([id, name, load, heat, tech = id, bio = false]) => ({ id, name, load, heat, tech, bio })),
}));

export const HULLS = new Map(HULL_GROUPS.flatMap(group => group.hulls.map(hull => [hull.id, hull])));

export function hullAvailable(hull, type) {
    return Boolean(hull && supportsCivilization(hull.tech, type));
}

export function equipmentFits(part, hull) {
    switch (part?.fit) {
        case 'fixed': return false;
        case 'bio': return hull.bio;
        case 'mechanical': return !hull.bio;
        case 'titan': return ['titan', 'paradox_titan', 'cryptic_stinger'].includes(hull.id);
        case 'juggernaut': return hull.id === 'juggernaut';
        case 'colossus': return hull.id === 'colossus';
        default: return Boolean(part);
    }
}

export function equipmentAvailable(part, hull, civilization) {
    return equipmentFits(part, hull)
        && (!part.research.length || part.research.some(id => supportsCivilization(id, civilization)));
}

// These secondary links add modes or integration options to existing components.
const supplementaryResearch = new Set([
    'torpedoes_1', 'combat_computers_bio_integration', 'hyper_drive_bio_integration', 'sensors_bio_integration',
]);

function missingEquipmentResearch(part, unlocked) {
    if (part.custom) return [];
    const required = part.research.filter((id, index) => index === 0 || !supplementaryResearch.has(id));
    return required.some(unlocked) ? [] : required;
}

export function equipmentUnlocked(part, unlocked) {
    return !missingEquipmentResearch(part, unlocked).length;
}

export function hullUnlocked(hull, unlocked) {
    return !hull.tech || unlocked(hull.tech);
}

function newId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
}

export function newDesign(hullId = 'corvette') {
    return {
        id: newId(), hullId, name: '', parts: [],
    };
}

export function normalizeName(name) {
    return String(name ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function makeCustomEquipment({ id, category, name, load, heat, capacity, effect }) {
    name = name.trim();
    if (!name || name.length > MAX_EQUIPMENT_NAME || /^\/.*\/[a-z]*$/iu.test(name)) {
        throw new Error('请输入 1–' + MAX_EQUIPMENT_NAME + ' 个字符的设备名称，供绿灯条目按名称触发。');
    }
    if (!Object.hasOwn(EQUIPMENT_TYPES, category)) throw new Error('无法识别设备所属系统。');
    if (![load, heat, capacity].every(value => Number.isInteger(value) && value >= 0 && value <= MAX_QUANTITY)) {
        throw new Error('负载、散热和负载上限增量须为 0–' + MAX_QUANTITY + ' 的整数。');
    }
    const spec = { load, heat };
    if (category === 'power' && capacity) spec.capacity = capacity;
    return {
        id: id ?? 'custom-' + newId(), name, category, custom: true,
        effect, stats: [], research: [], specs: { '': spec },
    };
}

export function designPart(row, equipment) {
    return row.customEquipment ?? equipment.get(row.id);
}

export function designUnlockError(design, equipment, research) {
    const hull = HULLS.get(design.hullId);
    if (!hullAvailable(hull, research.civilization)) return '当前文明无法使用这种舰体。';
    const missing = new Set();
    if (!hullUnlocked(hull, research.unlocked)) missing.add(research.name(hull.tech));
    for (const row of design.parts) {
        const part = designPart(row, equipment);
        if (!part) continue;
        const required = missingEquipmentResearch(part, research.unlocked);
        if (required.length) missing.add(required.map(research.name).join(' 或 '));
    }
    return missing.size ? '尚未掌握 ' + [...missing].join('、') : '';
}

export function totalDesign(design, equipment, civilization = DEFAULT_CIVILIZATION) {
    const hull = HULLS.get(design.hullId);
    const totals = { usedLoad: 0, baseLoad: hull?.load ?? 0, addedLoad: 0, usedHeat: 0, maxHeat: hull?.heat ?? 0 };
    const items = [];
    const errors = [];
    for (const row of design.parts) {
        const part = designPart(row, equipment);
        const spec = part && Object.hasOwn(part.specs, row.size) ? part.specs[row.size] : null;
        const quantity = row.quantity;
        if (!spec || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            errors.push('有舰装规格或数量无效。');
            continue;
        }
        items.push({ part, size: row.size, quantity, spec });
        totals.usedLoad += (spec.load ?? 0) * quantity;
        totals.addedLoad += (spec.capacity ?? 0) * quantity;
        totals.usedHeat += (spec.heat ?? 0) * quantity;
        if (!hull || !equipmentAvailable(part, hull, civilization)) errors.push(`${part.name}与当前舰体不相容。`);
    }
    totals.maxLoad = totals.baseLoad + totals.addedLoad;
    if (totals.usedLoad > totals.maxLoad) errors.push('舰装超过负载额度。');
    if (totals.usedHeat > totals.maxHeat) errors.push('舰装超过散热额度。');
    return { ...totals, items, errors: [...new Set(errors)] };
}

export function classLabel(design) {
    return `${HULLS.get(design.hullId)?.name ?? '舰船'}-${design.name}`;
}

export function specLabel(spec) {
    if (spec.capacity == null) return `负载 ${spec.load}` + (spec.heat ? ` · 散热 ${spec.heat}` : '');
    return (spec.load ? `负载 ${spec.load} · ` : '') + `负载上限 +${spec.capacity} · 散热 ${spec.heat ?? 0}`;
}

export function designEntry(design, equipment) {
    const lines = [
        `【${classLabel(design)}】`,
        `舰种 ${HULLS.get(design.hullId)?.name ?? '舰船'} · 舰级 ${design.name} · 当前会话服役`,
    ];
    for (const row of design.parts) {
        const part = designPart(row, equipment);
        const name = part?.name ?? '设备 ' + row.id;
        lines.push(`- ${name}${row.size ? ' [' + row.size + ']' : ''} ×${row.quantity}`);
    }
    return {
        key: [design.name], comment: classLabel(design), content: lines.join('\n'),
        constant: false, matchWholeWords: false, excludeRecursion: true,
        sttLoadoutOnly: true, sttDesign: structuredClone(design),
    };
}

export function customEquipmentEntry(part) {
    const lines = [
        `【${part.name}】`,
        `${CUSTOM_EQUIPMENT_GROUP} · ${EQUIPMENT_TYPES[part.category]} · ${specLabel(part.specs[''])}`,
    ];
    if (part.effect.trim()) lines.push(part.effect);
    return {
        key: [part.name], comment: part.name, content: lines.join('\n'),
        constant: false, matchWholeWords: false, excludeRecursion: true, sttCustomEquipment: part.id,
    };
}
