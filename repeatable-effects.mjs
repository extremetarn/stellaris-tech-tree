import { profileSets, recordedResearchCycles, restoreSettings, STORAGE_KEY } from './model.mjs';
import { supportsCivilization } from './civilizations.mjs';

export const REPEATABLE_LORE_NAME = '循环科技与当前加成';

const EQUIPMENT_TARGETS = {
    shield: '内置场式护盾',
    armor: '内置实体装甲与晶体镀层',
    energy: '内置能量直射与能量型舰轴武器',
    kinetic: '内置动能主炮、动能速射与动能型舰轴武器',
    explosive: '内置导弹与鱼雷',
    strikeCraft: '内置舰载航空设备',
};

const EQUIPMENT_RULES = [
    ['improved_shield_output', '护盾数律分析', 5, 'shield', '护盾强度'],
    ['improved_armor_output', '物质压缩', 5, 'armor', '装甲耐久'],
    ['weapon_type_energy_damage', '聚焦阵列', 5, 'energy', '武器威力'],
    ['weapon_type_energy_fire_rate', '快速冷却剂', 5, 'energy', '射速'],
    ['weapon_type_kinetic_damage', '高密度弹药', 5, 'kinetic', '武器威力'],
    ['weapon_type_kinetic_fire_rate', '装载效率', 5, 'kinetic', '射速'],
    ['weapon_type_explosive_damage', '热力学当量控制', 5, 'explosive', '武器威力'],
    ['weapon_type_explosive_fire_rate', '小型预点火装置', 5, 'explosive', '射速'],
    ['weapon_type_strike_craft_fire_damage', '突触拦截器', 10, 'strikeCraft', '航空打击强度'],
    ['weapon_type_strike_craft_fire_rate', '迭代式飞行员培训', 10, 'strikeCraft', '射速'],
].map(([key, name, rate, group, stat]) => ({
    id: 'repeatable_' + key, name, rate, group, stat, unit: '%', target: EQUIPMENT_TARGETS[group],
}));

const WORLD_RULES = [
    ['improved_tile_mineral_output', '提取模式', 5, '%', '矿物产出', '矿物生产岗位'],
    ['improved_military_station_damage', '同步开火模式', 10, '%', '伤害', '防御平台'],
    ['improved_military_station_health', '强化核心层', 10, '%', '船体耐久', '防御平台'],
    ['reduced_building_time', '组装算法', 10, '%', '建造速度', '基础设施', 5],
    ['improved_tile_energy_output', '超导应用', 5, '%', '能源产出', '能源生产岗位'],
    ['reduced_building_cost', '引力分析', -5, '%', '建造成本', '建筑', 5],
    ['improved_tile_food_output', '转基因作物', 5, '%', '食物产出', '农业岗位'],
    ['improved_core_system_cap', '行政效率', 5, '%', '月度凝聚力', '文明经济'],
    ['improved_army_damage', '主动适应', 10, '%', '伤害', '地面部队'],
    ['improved_army_health', '神经抑制器', 10, '%', '耐久', '地面部队'],
    ['improved_leader_life_span', '细胞活力', 5, ' 年', '寿命', '领袖'],
    ['naval_cap', '舰队管理规程', 20, '', '海军容量', '文明全海军', 5],
    ['command_limit', '司令幕僚', 20, '', '舰队指挥上限', '单支舰队', 5],
    ['improved_starbase_capacity', '星际扩张', 1, '', '恒星基地容量', '文明恒星基地', 5],
].map(([key, name, rate, unit, stat, target, limit]) => ({
    id: 'repeatable_' + key, name, rate, unit, stat, target, limit,
}));

const FAMILY_GROUPS = new Map([
    ['场式护盾', 'shield'], ['实体装甲', 'armor'], ['晶体镀层', 'armor'],
    ['能量直射', 'energy'], ['动能主炮', 'kinetic'], ['动能速射', 'kinetic'],
    ['导弹与鱼雷', 'explosive'], ['舰载航空', 'strikeCraft'],
]);

// Worldbook equipment UIDs for mixed-family spinal weapons, excluding fixed Ion Cannons.
const SPINAL_GROUPS = new Map([
    ...['1830', '1880', '2099', '2100', '2101', '2102', '2109', '2110', '2111', '2112'].map(id => [id, 'energy']),
    ...['1840', '1841', '1947', '1948', '1949', '1950'].map(id => [id, 'kinetic']),
]);

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false });
const multiplier = bonus => '×' + number.format(1 + bonus / 100);
const signed = value => (value >= 0 ? '+' : '') + number.format(value);

function cyclesLabel(effect) {
    const registered = effect.cycles + ' 轮';
    return effect.limit ? registered + '（生效 ' + effect.effectiveCycles + ' 轮，上限 ' + effect.limit + ' 轮）' : registered;
}

export function repeatableEffects(profile) {
    if (!profile) return [];
    const progress = profileSets(profile);
    return [...EQUIPMENT_RULES, ...WORLD_RULES].flatMap(rule => {
        const cycles = recordedResearchCycles(rule.id, progress);
        if (!cycles || !supportsCivilization(rule.id, profile.civilizationType)) return [];
        const effectiveCycles = Math.min(cycles, rule.limit ?? cycles);
        return [{ ...rule, cycles, effectiveCycles, bonus: effectiveCycles * rule.rate }];
    });
}

export function equipmentReadouts(part, effects) {
    const rows = part.stats.map(([stat, value]) => ({ stat, text: stat + ' ' + value }));
    if (part.custom || part.fit === 'fixed') return rows;
    const group = part.family === '舰轴主武器' ? SPINAL_GROUPS.get(part.id) : FAMILY_GROUPS.get(part.family);
    if (!group) return rows;
    for (const effect of effects) {
        if (effect.group !== group) continue;
        const index = rows.findIndex(row => row.stat === effect.stat);
        const value = part.stats[index]?.[1];
        const base = value === undefined ? NaN : Number(value);
        const text = Number.isFinite(base)
            ? effect.stat + ' ' + value + ' → ' + number.format(base * (1 + effect.bonus / 100)) + '（' + signed(effect.bonus) + '%）'
            : effect.stat + ' ' + multiplier(effect.bonus) + '（' + signed(effect.bonus) + '%）';
        const row = { stat: effect.stat, text, source: effect.name + ' · ' + cyclesLabel(effect) };
        if (index === -1) rows.push(row);
        else rows[index] = row;
    }
    return rows;
}

export function repeatableLore(profile) {
    const lines = [`【${REPEATABLE_LORE_NAME}】`, '当前文明档案 · ' + profile.name];
    const effects = repeatableEffects(profile);
    if (!effects.length) return [...lines, '当前没有生效的循环科技加成。'].join('\n');
    lines.push('设备基础值取自主世界书。百分比按有效轮数在基础值上累加并结算一次，固定增量直接加入基准。射速与单击威力各自计算。原创设备以其独立条目为准。');
    for (const effect of effects) {
        const total = signed(effect.bonus) + effect.unit;
        const rule = effect.unit === '%' ? '基础值 ' + multiplier(effect.bonus) : '基准 ' + total;
        lines.push('- ' + [effect.name, cyclesLabel(effect), effect.stat + ' ' + total, effect.target + ' · ' + rule].join(' · '));
    }
    return lines.join('\n');
}

export function conversationRepeatableLore(context) {
    try {
        const { activeId, profiles } = restoreSettings(context.chatMetadata?.[STORAGE_KEY]);
        return repeatableLore(profiles.find(profile => profile.id === activeId));
    } catch {
        return `【${REPEATABLE_LORE_NAME}】\n当前会话的科研档案暂不可读取。`;
    }
}
