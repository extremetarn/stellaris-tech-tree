export const SHIP_SYSTEMS = {
    weapon: { label: '武器', groups: [
        ['直射武器', ['能量直射', '动能主炮', '动能速射']],
        ['导弹与鱼雷', ['导弹与鱼雷']],
        ['航空与近防', ['舰载航空', '点防与拦截']],
        ['末日武器', ['天体任务载荷']],
        ['舰轴与特种武器', ['舰轴主武器', '活体近战']],
    ] },
    armor: { label: '装甲', groups: [
        ['舰体装甲', ['实体装甲', '晶体镀层']],
        ['装甲辅助', ['装甲辅助']],
    ] },
    shield: { label: '护盾', groups: [
        ['场式护盾', ['场式护盾']],
        ['护盾辅助', ['护盾辅助']],
    ] },
    power: { label: '供能', groups: [
        ['舰用供能', ['舰用供能']],
        ['能源辅助', ['能源辅助']],
    ] },
    device: { label: '推进与设备', groups: [
        ['亚光速推进', ['亚光速推进', '深空推进', '亚光速辅助']],
        ['超光速航行', ['超光速航行']],
        ['传感与火控', ['传感与探测', '舰载火控']],
        ['辅助设备', []],
    ] },
};

export function equipmentGroup(part) {
    const groups = SHIP_SYSTEMS[part.category].groups;
    return (groups.find(([, families]) => families.includes(part.family)) ?? groups.at(-1))[0];
}

// Coordinates are percentages of each source image, ordered bow, port, starboard, core, drive.
const POINTS = {
    battleship:            [[50, 22], [42, 43], [59, 53], [50, 61], [58, 78]],
    behemoth:              [[50, 30], [26, 45], [75, 46], [50, 54], [58, 69]],
    cipher_mauler:         [[50, 31], [28, 47], [73, 48], [50, 56], [56, 69]],
    civilian_arkship:       [[50, 24], [35, 48], [64, 49], [50, 57], [50, 78]],
    colony_ship:           [[50, 27], [34, 47], [67, 53], [50, 60], [57, 72]],
    colossus:              [[50, 26], [23, 50], [76, 50], [68, 33], [56, 76]],
    construction_ship:     [[50, 27], [28, 44], [72, 47], [50, 55], [59, 70]],
    corvette:              [[50, 26], [43, 51], [57, 59], [50, 63], [54, 73]],
    cruiser:               [[50, 23], [36, 49], [65, 52], [50, 61], [59, 76]],
    cryptic_stinger:       [[50, 20], [43, 39], [58, 51], [45, 58], [50, 75]],
    destroyer:             [[50, 22], [40, 47], [60, 47], [50, 55], [58, 72]],
    enigma_battlecruiser:  [[50, 25], [25, 46], [75, 53], [50, 47], [50, 74]],
    frigate:               [[50, 21], [46, 40], [55, 54], [48, 64], [53, 77]],
    harbinger:             [[50, 43], [26, 40], [75, 43], [47, 58], [59, 69]],
    juggernaut:            [[50, 27], [27, 41], [72, 42], [56, 33], [72, 67]],
    mauler:                [[50, 29], [37, 42], [64, 45], [50, 53], [53, 70]],
    maze_harbinger:        [[50, 38], [25, 42], [75, 43], [50, 57], [57, 71]],
    military_arkship:      [[50, 23], [35, 43], [65, 48], [50, 54], [53, 70]],
    paradox_titan:         [[50, 20], [40, 43], [62, 52], [50, 59], [53, 73]],
    quandary_weaver:       [[50, 24], [28, 45], [73, 51], [50, 49], [61, 68]],
    riddle_escort:         [[50, 27], [35, 49], [65, 51], [50, 53], [52, 68]],
    science_ship:          [[20, 44], [34, 53], [52, 41], [70, 51], [83, 56]],
    scientific_arkship:    [[50, 28], [40, 52], [61, 58], [50, 46], [51, 71]],
    star_eater:            [[50, 19], [27, 44], [73, 45], [57, 63], [53, 76]],
    stinger:               [[50, 21], [43, 46], [60, 55], [50, 60], [53, 72]],
    titan:                 [[47, 18], [45, 41], [55, 48], [49, 61], [55, 76]],
    transport_ship:        [[50, 25], [39, 44], [62, 53], [50, 58], [57, 72]],
    weaver:                [[50, 33], [32, 47], [68, 49], [50, 57], [51, 70]],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createBlueprint({ stage, image, points, overlay, system, chips, installed, catalog, lines, button, select }) {
    let frame;
    let selected = '';
    const markers = new Map();
    const context = lines.getContext('2d');

    function setHull(hull) {
        if (image.dataset.hull === hull.id) return;
        image.dataset.hull = hull.id;
        image.alt = hull.name + '线稿蓝图';
        image.src = new URL(`./assets/blueprints/${hull.id}.webp`, import.meta.url).href;
        Object.keys(SHIP_SYSTEMS).forEach((id, index) => {
            const [x, y] = POINTS[hull.id][index];
            const marker = markers.get(id);
            marker.style.setProperty('--stt-x', x + '%');
            marker.style.setProperty('--stt-y', y + '%');
        });
        requestLayout();
    }

    function setSelected(id) {
        selected = id;
        for (const [key, marker] of markers) {
            marker.setAttribute('aria-expanded', String(id === key));
        }
        requestLayout();
    }

    function requestLayout() {
        if (frame != null) return;
        frame = requestAnimationFrame(() => {
            frame = undefined;
            draw();
        });
    }

    function draw() {
        const surface = lines.getBoundingClientRect();
        if (!surface.width || !surface.height) return;
        const ratio = Math.min(devicePixelRatio || 1, 2);
        const { width, height } = surface;
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(height * ratio);
        if (lines.width !== pixelWidth || lines.height !== pixelHeight) {
            lines.width = pixelWidth;
            lines.height = pixelHeight;
        }
        if (context) {
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, width, height);
        }
        if (!selected || overlay.hidden) return;

        const relative = element => {
            const box = element.getBoundingClientRect();
            return { x: box.left - surface.left, y: box.top - surface.top, w: box.width, h: box.height };
        };
        const marker = relative(markers.get(selected));
        const origin = [marker.x + marker.w / 2, marker.y + marker.h / 2];
        const narrow = getComputedStyle(overlay).position !== 'absolute';
        const right = selected !== 'armor' && origin[0] >= width * 0.40;
        const activeChip = chips.querySelector('[aria-pressed="true"]');

        if (!narrow) {
            const figure = relative(image);
            const wideHull = ['science_ship', 'behemoth', 'colossus'].includes(image.dataset.hull);
            const innerEdge = width / 2 + (right ? 1 : -1) * figure.w * (wideHull ? 0.37 : 0.31);
            const panelWidth = clamp((right ? width - innerEdge : innerEdge) - 35, 165, 382);
            const left = right ? innerEdge + 16 : innerEdge - panelWidth - 16;
            overlay.style.setProperty('--stt-panel-width', panelWidth + 'px');
            overlay.style.setProperty('--stt-panel-left', left + 'px');
            overlay.style.setProperty('--stt-group-limit', Math.floor(height * (catalog.hidden ? 0.75 : 0.44)) + 'px');
            overlay.style.setProperty('--stt-catalog-limit', Math.floor(height * 0.46) + 'px');
            const groupHeight = system.offsetHeight;
            const catalogHeight = catalog.hidden ? 0 : catalog.offsetHeight;
            const above = origin[1] > height * 0.53;
            const gap = catalogHeight ? 22 : 0;
            const groupTop = clamp(origin[1] - groupHeight * 0.68,
                10 + (above ? catalogHeight + gap : 0),
                height - 10 - groupHeight - (above ? 0 : catalogHeight + gap));
            overlay.style.setProperty('--stt-system-top', groupTop + 'px');
            overlay.style.setProperty('--stt-catalog-top', (above
                ? groupTop - gap - catalogHeight : groupTop + groupHeight + gap) + 'px');
        }

        if (!context) return;
        context.strokeStyle = '#74ddea';
        context.fillStyle = '#a2edf2';
        context.lineWidth = 1.35;
        context.lineJoin = 'round';
        function path(...vertices) {
            context.beginPath();
            context.moveTo(...vertices[0]);
            for (const vertex of vertices.slice(1)) context.lineTo(...vertex);
            context.stroke();
        }
        function end(x, y) {
            context.beginPath();
            context.arc(x, y, 2.2, 0, 2 * Math.PI);
            context.fill();
        }

        const branches = [relative(chips), relative(installed)];
        if (narrow) {
            const panel = relative(system);
            const top = Math.max(panel.y, relative(overlay).y);
            const rail = origin[0] < width / 2 ? 8 : width - 8;
            const target = clamp(origin[0], panel.x + 15, panel.x + panel.w - 15);
            path(origin, [rail, origin[1]], [rail, top], [target, top]);
            end(target, top);
            if (!catalog.hidden && activeChip) {
                const chip = relative(activeChip);
                const box = relative(catalog);
                const drawer = relative(overlay);
                if (chip.y >= drawer.y && box.y < drawer.y + drawer.h) {
                    const startX = chip.x + chip.w / 2;
                    const targetX = clamp(startX, box.x + 10, box.x + box.w - 10);
                    const side = box.x - 5;
                    path([startX, chip.y + chip.h], [startX, chip.y + chip.h + 3],
                        [side, chip.y + chip.h + 3], [side, box.y - 4],
                        [targetX, box.y - 4], [targetX, box.y]);
                    end(targetX, box.y);
                }
            }
            return;
        }

        const edge = box => right ? box.x : box.x + box.w;
        const trunk = edge(relative(system)) + (right ? -12 : 12);
        const chipY = branches[0].y + Math.min(branches[0].h / 2, 19);
        const installedY = branches[1].y + Math.min(branches[1].h / 2, 20);
        path(origin, [trunk, origin[1]], [trunk, installedY], [edge(branches[1]), installedY]);
        end(edge(branches[1]), installedY);
        if (branches[0].h) {
            path([trunk, origin[1]], [trunk, chipY], [edge(branches[0]), chipY]);
            end(edge(branches[0]), chipY);
        }
        if (!catalog.hidden && activeChip) {
            const chip = relative(activeChip);
            const box = relative(catalog);
            const above = box.y < chip.y;
            const from = [chip.x + chip.w / 2, above ? chip.y : chip.y + chip.h];
            const targetY = above ? box.y + box.h : box.y;
            const targetX = clamp(from[0], box.x + 10, box.x + box.w - 10);
            const midway = (from[1] + targetY) / 2;
            path(from, [from[0], midway], [targetX, midway], [targetX, targetY]);
            end(targetX, targetY);
        }
    }

    for (const [id, { label }] of Object.entries(SHIP_SYSTEMS)) {
        const marker = button('', () => select(id), 'stt-blueprint-point');
        marker.setAttribute('aria-label', label);
        marker.setAttribute('aria-expanded', 'false');
        marker.setAttribute('aria-controls', 'stt-blueprint-systems');
        marker.title = label;
        points.append(marker);
        markers.set(id, marker);
    }
    const resize = new ResizeObserver(requestLayout);
    [stage, image, system, catalog].forEach(element => resize.observe(element));
    overlay.addEventListener('scroll', requestLayout, { passive: true });
    image.addEventListener('load', requestLayout);
    return { setHull, setSelected, requestLayout, focus: id => markers.get(id)?.focus({ preventScroll: true }) };
}
