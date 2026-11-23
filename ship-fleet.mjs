import {
    classLabel, customEquipmentEntry, designEntry, DESIGN_SETTINGS, FLEET_LINK, hullAvailable, HULLS,
    MAX_CLASS_NAME, normalizeName, ROSTER_NAME, totalDesign,
} from './ship-model.mjs';

const WORLD_KEY = 'world_info';
const OWNED_BY = 'sttFleetFor';

function bookName(key) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(key)) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    }
    return '群星舰队-' + hash.toString(16).padStart(16, '0');
}

function fleetEntries(book) {
    return Object.values(book.entries).filter(entry => entry.sttDesign?.id);
}

function nextUid(entries) {
    let uid = 0;
    while (Object.hasOwn(entries, uid)) uid++;
    return uid;
}

function refreshFleetEntries(book, template) {
    const deployed = fleetEntries(book);
    const existing = Object.values(book.entries).find(entry => entry.sttRoster);
    const uid = existing?.uid ?? nextUid(book.entries);
    const ships = deployed.map(entry => classLabel(entry.sttDesign));
    book.entries[uid] = {
        ...structuredClone(template),
        uid, comment: ROSTER_NAME, constant: true, addMemo: true, order: 920,
        preventRecursion: true, ignoreBudget: true, sttRoster: true,
        content: `【${ROSTER_NAME}】\n${ships.length ? ships.map(ship => '- ' + ship).join('\n') : '本会话暂无已登记的服役舰船。'}`,
    };
    // A definition shared by several deployed classes needs only one green entry.
    const key = entry => JSON.stringify([entry.sttCustomEquipment, entry.content]);
    const needed = new Map();
    for (const { sttDesign } of deployed) {
        for (const { customEquipment: part } of sttDesign.parts) {
            if (!part?.custom) continue;
            const entry = customEquipmentEntry(part);
            needed.set(key(entry), entry);
        }
    }
    for (const entry of Object.values(book.entries)) {
        if (entry.sttCustomEquipment && !needed.delete(key(entry))) delete book.entries[entry.uid];
    }
    for (const entry of needed.values()) {
        const uid = nextUid(book.entries);
        book.entries[uid] = { ...structuredClone(template), uid, addMemo: true, ...entry };
    }
}

export function createFleetStore(getConversation) {
    let pending = Promise.resolve();
    let apiPromise;

    function enqueue(task) {
        const result = pending.then(task, task);
        pending = result.catch(() => {});
        return result;
    }

    function current(expectedKey) {
        const active = getConversation();
        if (!active.key || (expectedKey && active.key !== expectedKey)) {
            throw new Error('会话已切换或尚未打开。');
        }
        return active;
    }

    function library() {
        const designs = getConversation().context.extensionSettings?.[DESIGN_SETTINGS]?.designs;
        return Array.isArray(designs) ? structuredClone(designs) : [];
    }

    function customEquipment() {
        const equipment = getConversation().context.extensionSettings?.[DESIGN_SETTINGS]?.customEquipment;
        return Array.isArray(equipment) ? structuredClone(equipment) : [];
    }

    async function saveLibrary(context, updates) {
        const { saveSettings } = await import('/script.js');
        const event = context.eventTypes.SETTINGS_UPDATED;
        const previous = context.extensionSettings[DESIGN_SETTINGS];
        const value = { ...previous, ...updates };
        let saved = false;
        const confirmed = () => { saved = true; };
        if (event) context.eventSource.on(event, confirmed);
        context.extensionSettings[DESIGN_SETTINGS] = value;
        try {
            await saveSettings();
            if (event && !saved) throw new Error('酒馆未确认设计库保存。');
        } catch (error) {
            if (context.extensionSettings[DESIGN_SETTINGS] === value) {
                if (previous === undefined) delete context.extensionSettings[DESIGN_SETTINGS];
                else context.extensionSettings[DESIGN_SETTINGS] = previous;
            }
            throw error;
        } finally {
            if (event) context.eventSource.removeListener(event, confirmed);
        }
    }

    function saveCustomEquipment(id, part) {
        return enqueue(async () => {
            const { context } = getConversation();
            const equipment = customEquipment().filter(item => item.id !== id);
            if (part) equipment.unshift(part);
            await saveLibrary(context, { customEquipment: equipment });
        });
    }

    async function lorerequest(context, endpoint, payload) {
        const response = await fetch('/api/worldinfo/' + endpoint, {
            method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`聊天知识书${endpoint === 'edit' ? '保存' : '读取'}失败（HTTP ${response.status}）。`);
        return await response.json();
    }

    async function writeBook(context, name, data, api) {
        const result = await lorerequest(context, 'edit', { name, data });
        if (result.ok !== true) throw new Error('酒馆未确认知识书保存。');
        api.worldInfoCache.set(name, data);
        try {
            await context.eventSource.emit(context.eventTypes.WORLDINFO_UPDATED, name, data);
        } catch (error) {
            console.warn('群星科研台 · 知识书已写入，编辑器刷新失败', error);
        }
    }

    function worldInfoApi() {
        apiPromise ??= import('/scripts/world-info.js').catch(error => {
            apiPromise = undefined;
            throw error;
        });
        return apiPromise;
    }

    async function ensureBook(expectedKey) {
        const api = await worldInfoApi();
        const { context, key } = current(expectedKey);
        const metadata = context.chatMetadata;
        const previous = metadata[FLEET_LINK];
        const name = previous?.key === key ? previous.name : bookName(key);
        const read = () => (context.loadWorldInfo ?? api.loadWorldInfo)(name);
        let book = await read();
        current(key);
        if (!book || !book.entries || Array.isArray(book.entries)) throw new Error('聊天知识书无法读取。');
        if (book[OWNED_BY] !== key) {
            if (book[OWNED_BY] || Object.keys(book.entries).length) throw new Error('聊天知识书名称冲突。');
            const inherited = previous?.name && previous.key !== key
                ? await (context.loadWorldInfo ?? api.loadWorldInfo)(previous.name)
                : null;
            current(key);
            book = { [OWNED_BY]: key, entries: {} };
            if (previous?.key && inherited?.[OWNED_BY] === previous.key && inherited.entries) {
                for (const entry of fleetEntries(inherited)) {
                    const uid = nextUid(book.entries);
                    book.entries[uid] = { ...entry, uid };
                }
            }
            refreshFleetEntries(book, api.newWorldInfoEntryTemplate);
            await writeBook(context, name, book, api);
            try {
                await (context.updateWorldInfoList ?? api.updateWorldInfoList)();
            } catch (error) {
                console.warn('群星科研台 · 知识书列表刷新失败', error);
            }
        }

        const live = current(key).context;
        const activeMetadata = live.chatMetadata;
        const native = activeMetadata[WORLD_KEY];
        const bindNative = !native || (previous?.name === native && previous.key !== key);
        if (activeMetadata[FLEET_LINK]?.key !== key || activeMetadata[FLEET_LINK]?.name !== name || bindNative) {
            const oldLink = activeMetadata[FLEET_LINK];
            activeMetadata[FLEET_LINK] = { key, name };
            if (bindNative) activeMetadata[WORLD_KEY] = name;
            try {
                await live.saveMetadata();
            } catch (error) {
                if (oldLink === undefined) delete activeMetadata[FLEET_LINK];
                else activeMetadata[FLEET_LINK] = oldLink;
                if (native === undefined) delete activeMetadata[WORLD_KEY];
                else activeMetadata[WORLD_KEY] = native;
                throw error;
            }
            if (bindNative && getConversation().key === key) {
                document.querySelectorAll('.chat_lorebook_button').forEach(button => button.classList.add('world_set'));
            }
        }
        return { name, book, api };
    }

    function list(book) {
        return fleetEntries(book).map(entry => structuredClone(entry.sttDesign));
    }

    function prepare(key) {
        if (!key) return Promise.resolve([]);
        return enqueue(async () => list((await ensureBook(key)).book));
    }

    function activate(key, design, equipment, civilization, saveDesign) {
        return enqueue(async () => {
            const hull = HULLS.get(design.hullId);
            const copy = { ...structuredClone(design), name: normalizeName(design.name) };
            if (!copy.name || copy.name.length > MAX_CLASS_NAME || /[\p{Cc}\p{Cf}{}]/u.test(copy.name)
                || /^\/.*\/[a-z]*$/iu.test(copy.name)) {
                throw new Error('请输入 1–48 个字的舰级名。');
            }
            if (!hullAvailable(hull, civilization)) throw new Error('当前文明无法使用这种舰体。');
            if (!copy.parts.length) throw new Error('请至少配置一件舰装。');
            const totals = totalDesign(copy, equipment, civilization);
            if (totals.errors.length) throw new Error(totals.errors.join(' '));

            const { name, api } = await ensureBook(key);
            const { context } = current(key);
            const book = await lorerequest(context, 'get', { name });
            const live = current(key).context;
            if (book[OWNED_BY] !== key) throw new Error('聊天知识书已变更，请重试。');
            const allDesigns = library();
            const fold = value => normalizeName(value).toLocaleLowerCase();
            const conflicting = [...list(book), ...(saveDesign ? allDesigns : [])].some(other =>
                other.id !== copy.id && fold(other.name) === fold(copy.name));
            if (conflicting) throw new Error('已有同名舰级，请换一个名字。');
            const existing = fleetEntries(book).find(entry => entry.sttDesign.id === copy.id);
            const uid = existing?.uid ?? nextUid(book.entries);
            book.entries[uid] = {
                ...structuredClone(api.newWorldInfoEntryTemplate),
                uid, addMemo: true, ...designEntry(copy, equipment),
            };
            refreshFleetEntries(book, api.newWorldInfoEntryTemplate);
            await writeBook(live, name, book, api);
            let libraryError;
            if (saveDesign) {
                try {
                    await saveLibrary(live, { designs: [copy, ...allDesigns.filter(other => other.id !== copy.id)] });
                } catch (error) {
                    libraryError = error;
                }
            }
            return { design: copy, fleet: list(book), libraryError };
        });
    }

    function retire(key, id) {
        return enqueue(async () => {
            const { name, api } = await ensureBook(key);
            const { context } = current(key);
            const book = await lorerequest(context, 'get', { name });
            const live = current(key).context;
            if (book[OWNED_BY] !== key) throw new Error('聊天知识书已变更，请重试。');
            const entry = fleetEntries(book).find(item => item.sttDesign.id === id);
            if (entry) {
                delete book.entries[entry.uid];
                refreshFleetEntries(book, api.newWorldInfoEntryTemplate);
                await writeBook(live, name, book, api);
            }
            return list(book);
        });
    }

    async function includeSupplementalLore(sources) {
        const { context, key } = getConversation();
        const link = context.chatMetadata?.[FLEET_LINK];
        if (!key || link?.key !== key || !link.name || context.chatMetadata[WORLD_KEY] === link.name) return;
        if (Object.values(sources).some(entries => entries.some?.(entry => entry.world === link.name))) return;
        const api = await worldInfoApi();
        const book = await (context.loadWorldInfo ?? api.loadWorldInfo)(link.name);
        if (getConversation().key === key && book?.[OWNED_BY] === key) {
            sources.chatLore.push(...Object.values(book.entries).map(entry => ({ ...entry, world: link.name })));
        }
    }

    return { prepare, activate, retire, library, customEquipment, saveCustomEquipment, includeSupplementalLore };
}
