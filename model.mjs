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

const readyForResearch = '所有前置均已满足。';
const projectName = item => '「' + item.name + '」' + (/^ME-\d+$/.test(item.id) ? '〔' + item.id + '〕' : '');
const requirementWording = new Map([
    ['专项获取：不按常规科技抽取，核对事件、遗物、残骸、危机或路线授予。', '通过相关发现、遗物、残骸、危机或专项研究授权取得所需资料'],
    ['普通休眠星门、适用发现事件或本系统等效验证', '找到合适的休眠星门、取得相关新发现，或完成等效验证'],
    ['起研条件：{{user}} 可调用的科研与工业基础达到信息时代。', '让我们可调动的科研和工业能力达到信息时代的水准'],
    ['按档案核对样本、蓝图或高阶研究入口', '取得适用样本、蓝图或高阶研究渠道'],
    ['当地存在玛那和Botania式接口', '当地有可用玛那和相容的玛那接口'],
    ['当地存在Ars式Source', '当地有可用的源质'],
    ['当地已有经验证的ProjectE式等价交换', '当地有经过验证的等价交换工艺'],
    ['对应飞升或宿主世界的意识载体', '具备适用于相关飞升路线或本宇宙的意识载体'],
    ['配适=相应专用配适方案；另需原物料容器和检测科技', '备妥原物料容器，并具备必要的检测技术'],
    ['介质接口=相应独立接口；另需具体虚境项目', '落实相应的虚境项目'],
    ['文明里程碑。政体统一与公共服务实际覆盖均达到后登记', '完成政体统一，并达到公共服务覆盖要求'],
]);

function requirementProse(label, catalog) {
    return (requirementWording.get(label) ?? label)
        .replace(/^起研条件：可取得/, '备妥')
        .replace(/^起研条件：/, '')
        .replace(/\{\{user\}\}\s*/g, '我方')
        .replace(/ME-\d+/g, id => {
            const project = catalog.nodes.get(id);
            return project ? projectName(project) : id;
        })
        .replace(/[；;]/g, '。')
        .replace(/。$/, '');
}

function inspectPrerequisites(targets, catalog, state) {
    const inspections = new Map();
    function inspect(node) {
        if (inspections.has(node.id)) return;
        const { groups, conditions, tier } = evaluate(node, catalog, state);
        const missing = [];
        for (const group of groups) {
            if (group.some(option => option.done)) continue;
            const options = group.map(option => {
                if (!option.id) return '落实「' + option.external + '」';
                const dependency = catalog.nodes.get(option.id);
                inspect(dependency);
                return '掌握' + projectName(dependency);
            });
            missing.push(options.length === 1 ? options[0] : '从以下途径中择一完成（' + options.join('，或') + '）');
        }
        for (const condition of conditions) {
            if (!condition.done) missing.push(requirementProse(condition.label, catalog));
        }
        if (tier && tier.count < tier.required) {
            missing.push('再掌握 ' + (tier.required - tier.count) + ' 项' + FIELD_NAMES[node.field]
                + '第 ' + tier.level + ' 阶技术。目前已掌握 ' + tier.count + ' 项，立项要求 ' + tier.required + ' 项');
        }
        inspections.set(node.id, { node, missing });
    }
    for (const target of targets) inspect(target);
    return inspections;
}

function appendUpstream(lines, inspections, targets) {
    const targetIds = new Set(targets.map(target => target.id));
    const upstream = [...inspections.values()].filter(({ node }) => !targetIds.has(node.id));
    if (upstream.length) {
        lines.push('前期课题及开工条件如下，依所选途径推进。');
        for (const { node, missing } of upstream) {
            lines.push('- ' + projectName(node) + (missing.length ? '还有以下准备。' : '已可着手。'));
            lines.push(...missing.map(value => '  - ' + value + '。'));
        }
    }
}

function researchProject(item, kind) {
    return kind === 'node' && item.field !== 'A';
}

function projectInstruction(item, kind, ready) {
    const name = projectName(item);
    if (kind === 'route') return '拟订' + name + '的飞升方案，说明我方资格、目前进展和下一步工程。';
    if (kind === 'perk') return '评估采纳' + name + '的条件，以及它会给我们带来哪些变化。';
    if (item.field === 'A') return '调阅' + name + '的研究档案。';
    if (item.field === 'G') return (ready ? '立项开展' : '筹备') + name + '工程。';
    if (item.field === 'M') return (ready ? '推进' : '筹备') + name + '。';
    return ready ? '立项研究' + name + '。' : '筹备' + name + '的研究。';
}

export function draftFor(item, kind, catalog, state) {
    if (!researchProject(item, kind)) return projectInstruction(item, kind);
    const inspections = inspectPrerequisites([item], catalog, state);
    const { missing } = inspections.get(item.id);
    const lines = [projectInstruction(item, kind, !missing.length)];
    if (!missing.length) lines.push(readyForResearch);
    else lines.push('开工前还须完成以下准备。', ...missing.map(value => '- ' + value + '。'));
    appendUpstream(lines, inspections, [item]);
    return lines.join('\n');
}

export function draftForBatch(projects, catalog, state) {
    if (!projects.length) return '';
    if (projects.length === 1) {
        const [{ item, kind }] = projects;
        return draftFor(item, kind, catalog, state);
    }
    const targets = projects.filter(({ item, kind }) => researchProject(item, kind)).map(({ item }) => item);
    const inspections = inspectPrerequisites(targets, catalog, state);
    const allReady = targets.length === projects.length
        && targets.every(item => !inspections.get(item.id).missing.length);
    const lines = [allReady ? '接下来同时立项推进以下项目。' : '接下来安排以下工作。'];
    for (const { item, kind } of projects) {
        if (!researchProject(item, kind)) {
            lines.push('- ' + projectInstruction(item, kind));
        } else {
            const { missing } = inspections.get(item.id);
            lines.push('- ' + projectInstruction(item, kind, !missing.length));
            if (missing.length) lines.push(...missing.map(value => '  - ' + value + '。'));
            else if (!allReady) lines.push('  - ' + readyForResearch);
        }
    }
    if (allReady) lines.push('这些项目' + readyForResearch);
    appendUpstream(lines, inspections, targets);
    return lines.join('\n');
}

export function appendDraft(existing, draft) {
    if (!existing) return draft;
    if (existing.endsWith('\n\n')) return existing + draft;
    return existing + (existing.endsWith('\n') ? '\n' : '\n\n') + draft;
}
