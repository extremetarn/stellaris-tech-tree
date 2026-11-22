export const STORAGE_KEY = 'stellarisTechTree';
export const SAVE_SCHEMA = 1;

export const VIEWS = {
    INTRO: '信息时代',
    P: '物理',
    S: '社会',
    E: '工程',
    ME: 'ME',
    G: '巨构',
    ASC: '飞升之路',
    FOCUS: '目标路线',
};

export const FIELD_NAMES = {
    P: '物理学',
    S: '社会学',
    E: '工程学',
    ME: '物质与能量数据化',
    G: '巨构专项',
    M: '里程碑',
    A: '档案',
};

export const STATUS = {
    learned: '已掌握',
    ready: '可点亮',
    locked: '前置待确认',
    achieved: '已达成',
    reference: '档案',
};

export function indexCatalog(data) {
    if (data.schema !== 1) throw new Error('科技数据版本不受支持。');
    const nodes = new Map(data.nodes.map(node => [node.id, node]));
    const perks = new Map(data.perks.map(perk => [perk.id, perk]));
    const routes = new Map(data.ascension.map(route => [route.id, route]));
    const views = new Map([['INTRO', data.introIds.map(id => nodes.get(id))]]);
    const tierNodes = new Map();
    const children = new Map();
    for (const node of nodes.values()) {
        if (!views.has(node.field)) views.set(node.field, []);
        views.get(node.field).push(node);
        if (node.tier !== null) {
            const key = node.field + node.tier;
            if (!tierNodes.has(key)) tierNodes.set(key, []);
            tierNodes.get(key).push(node.id);
        }
        for (const parent of prerequisites(node)) {
            if (!children.has(parent)) children.set(parent, []);
            children.get(parent).push(node.id);
        }
    }
    return { data, nodes, perks, routes, views, tierNodes, children };
}

export function prerequisites(node) {
    return [...new Set(node.requires.flatMap(group => group.flatMap(option => option.id ? [option.id] : [])))];
}

export function connectedNodes(catalog, id) {
    const ancestors = new Set();
    function addAncestors(current) {
        if (ancestors.has(current)) return;
        ancestors.add(current);
        for (const parent of prerequisites(catalog.nodes.get(current))) addAncestors(parent);
    }
    addAncestors(id);
    for (const child of catalog.children.get(id) ?? []) ancestors.add(child);
    return Array.from(ancestors, key => catalog.nodes.get(key));
}

export function profileSets(profile) {
    return {
        learned: new Set(profile.learned),
        conditions: new Set(profile.conditions),
        perks: new Set(profile.perks),
    };
}

export function externalKey(option) {
    return 'external:' + option.external;
}

export function conditionKey(node, condition) {
    return node.id + ':' + condition;
}

export function evaluate(node, catalog, state) {
    const completed = id => state.learned.has(catalog.nodes.get(id)?.derivedFrom ?? id);
    const groups = node.requires.map(options => options.map(option => ({
        ...option,
        done: option.id ? completed(option.id) : state.conditions.has(externalKey(option)),
    })));
    const conditions = node.requirements.map(label => ({
        label,
        key: conditionKey(node, label),
        done: state.conditions.has(conditionKey(node, label)),
    }));
    const tier = node.tierGate === null ? null : {
        level: node.tierGate,
        count: (catalog.tierNodes.get(node.field + node.tierGate) ?? []).filter(completed).length,
        required: 6,
    };
    const ready = groups.every(group => group.some(option => option.done))
        && conditions.every(condition => condition.done)
        && (!tier || tier.count >= tier.required);
    let status = ready ? 'ready' : 'locked';
    if (node.field === 'A') status = 'reference';
    else if (node.derivedFrom) status = completed(node.id) ? 'achieved' : 'locked';
    else if (completed(node.id)) status = node.field === 'M' ? 'achieved' : 'learned';
    return { status, ready, groups, conditions, tier };
}

export function newProfile(name, source) {
    return {
        id: globalThis.crypto?.randomUUID?.() ?? 'archive-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        name,
        learned: [...(source?.learned ?? [])],
        conditions: [...(source?.conditions ?? [])],
        perks: [...(source?.perks ?? [])],
        stages: { ...source?.stages },
    };
}

function readStrings(values) {
    if (!Array.isArray(values) || values.length > 5000 || values.some(value => typeof value !== 'string' || value.length > 1000)) {
        throw new Error('档案状态格式有误。');
    }
    return [...new Set(values)];
}

export function validateProfile(profile) {
    if (!profile || typeof profile.id !== 'string' || typeof profile.name !== 'string'
        || !profile.id || profile.id.length > 160 || !profile.name.trim() || profile.name.length > 80) {
        throw new Error('档案名称或 ID 无效。');
    }
    const stages = Object.entries(profile.stages ?? {});
    if (stages.some(([key, level]) => !/^(ASC-[A-Z]+|ap_[a-z0-9_]+)$/.test(key) || !Number.isInteger(level) || level < 1 || level > 3)) {
        throw new Error('飞升阶段的记录无效。');
    }
    return {
        id: profile.id,
        name: profile.name.trim(),
        learned: readStrings(profile.learned),
        conditions: readStrings(profile.conditions ?? []),
        perks: readStrings(profile.perks ?? []),
        stages: Object.fromEntries(stages),
    };
}

export function restoreSettings(saved) {
    if (saved && saved.schema !== SAVE_SCHEMA) throw new Error('此档案版本需要更新后的扩展。');
    const profiles = (saved?.profiles ?? []).map(validateProfile);
    if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('文明档案 ID 重复。');
    if (!profiles.length) profiles.push(newProfile('默认文明'));
    return {
        schema: SAVE_SCHEMA,
        activeId: profiles.some(profile => profile.id === saved?.activeId) ? saved.activeId : profiles[0].id,
        profiles,
        legacyImported: saved?.legacyImported === true,
    };
}

export function toggle(list, value) {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

function prerequisiteDraft(target, catalog, state) {
    const upstream = new Map();
    const seen = new Set([target.id]);
    const label = node => '「' + node.name + '」〔' + node.id + '〕';

    function inspect(node) {
        const { groups, conditions, tier } = evaluate(node, catalog, state);
        const missing = [];
        for (const group of groups) {
            if (group.some(option => option.done)) continue;
            const options = group.map(option => {
                if (!option.id) return '确认条件「' + option.external + '」';
                const dependency = catalog.nodes.get(option.id);
                if (!seen.has(dependency.id)) {
                    seen.add(dependency.id);
                    const blockers = inspect(dependency);
                    upstream.set(dependency.id, '- ' + label(dependency) + '｜'
                        + (blockers.length ? blockers.join('。') : '自身前置均已满足') + '。');
                }
                return '掌握' + label(dependency);
            });
            missing.push(options.length === 1 ? options[0] : '任选一项（' + options.join(' 或 ') + '）');
        }
        for (const condition of conditions) {
            if (!condition.done) missing.push('确认「' + condition.label.replace(/。$/, '') + '」');
        }
        if (tier && tier.count < tier.required) {
            missing.push(FIELD_NAMES[node.field] + ' T' + tier.level + ' 已掌握 ' + tier.count + '/' + tier.required
                + ' 项，还差 ' + (tier.required - tier.count) + ' 项同阶科技');
        }
        return missing;
    }

    const missing = inspect(target);
    if (!missing.length) return '所有前置均已满足。';

    const lines = ['目标节点还缺以下前置与条件。', ...missing.map(value => '- ' + value + '。')];
    if (upstream.size) {
        lines.push('未掌握的上游节点按研究顺序列在下方。任选组按所选分支推进。', ...upstream.values());
    }
    return lines.join('\n');
}

export function draftFor(item, kind, catalog, state) {
    const name = '「' + item.name + '」';
    if (kind === 'route') return '灰风，准备规划' + name + '的文明飞升路线。先核对目标文明的资格、当前转型阶段和下一步要完成的工程。';
    if (kind === 'perk') return '灰风，帮我核对飞升天赋' + name + '的采纳条件和它对当前文明的影响。';
    if (item.field === 'A') return '灰风，帮我核对' + name + '的档案。';
    const opening = {
        G: '灰风，准备规划' + name + '巨构专项。',
        M: '灰风，接下来处理' + name + '里程碑。',
    }[item.field] ?? ('灰风，准备立项研究' + name + '。');
    return opening + '\n' + prerequisiteDraft(item, catalog, state);
}

export function appendDraft(existing, draft) {
    if (!existing) return draft;
    if (existing.endsWith('\n\n')) return existing + draft;
    return existing + (existing.endsWith('\n') ? '\n' : '\n\n') + draft;
}
