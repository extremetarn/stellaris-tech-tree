import cytoscape from './vendor/cytoscape.esm.min.mjs';
import { FIELD_NAMES, prerequisites } from './model.mjs';

const COLORS = {
    P: '#81bdff', S: '#84e1a8', E: '#f6b77c', ME: '#c19dff',
    G: '#ffcf7d', M: '#9ce2eb', A: '#a7b0c5',
};
const CARD_WIDTH = 148;
const CARD_HEIGHT = 54;

const STYLE = [
    {
        selector: 'node',
        style: {
            width: CARD_WIDTH, height: CARD_HEIGHT, shape: 'round-rectangle',
            label: 'data(label)', 'font-family': 'system-ui, sans-serif',
            'font-size': 14, 'font-weight': 600, color: '#bed0e2',
            'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
            'text-max-width': 130, 'line-height': 1.16,
            'background-color': '#142132', 'border-width': 1, 'border-color': '#3a4b64',
        },
    },
    { selector: 'node[status = "ready"]', style: { 'border-color': 'data(accent)', color: '#e2edfb' } },
    { selector: 'node[status = "learned"], node[status = "achieved"]', style: {
        'background-color': '#193c38', 'border-width': 2, 'border-color': '#72e6c5', color: '#dcfff4',
    } },
    { selector: 'node[status = "locked"]', style: { 'background-color': '#142030', color: '#a4b3c9' } },
    { selector: 'node[status = "reference"]', style: { 'border-style': 'dashed' } },
    { selector: 'node.current', style: {
        'border-color': '#a3dcff', 'border-width': 3, color: '#ffffff',
        'underlay-color': '#6cbfff', 'underlay-opacity': 0.18, 'underlay-padding': 5,
        'z-index': 5,
    } },
    { selector: 'node.neighbor', style: { color: '#f0f7ff', 'border-color': '#819cbb', 'border-width': 2 } },
    { selector: 'node.column, node.lane', style: {
        width: 180, height: 30, 'background-opacity': 0, 'border-width': 0,
        'text-max-width': 180, 'font-size': 13, 'font-weight': 700, color: '#8ca7c4',
        events: 'no',
    } },
    { selector: 'node.lane', style: { width: 104, 'text-max-width': 104, color: 'data(accent)' } },
    {
        selector: 'edge',
        style: {
            width: 1, 'curve-style': 'bezier', opacity: 0.59,
            'line-color': '#4b637b', 'target-arrow-color': '#4b637b',
            'target-arrow-shape': 'triangle', 'arrow-scale': 0.85, events: 'no',
        },
    },
    { selector: 'edge[optional = 1]', style: { 'line-style': 'dashed' } },
    { selector: 'edge.lit', style: { width: 2.5, opacity: 0.94, 'line-color': '#89c7f4', 'target-arrow-color': '#89c7f4' } },
];

function depthById(nodes) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const depths = new Map();
    function depth(id) {
        if (depths.has(id)) return depths.get(id);
        const parents = prerequisites(byId.get(id)).filter(key => byId.has(key));
        const rank = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
        depths.set(id, rank);
        return rank;
    }
    for (const node of nodes) depth(node.id);
    return depths;
}

function coordinates(nodes, view) {
    const depths = depthById(nodes);
    const rankOf = node => ['P', 'S', 'E'].includes(view) ? node.tier : depths.get(node.id);
    const groups = new Map();
    for (const node of nodes) {
        const key = view === 'INTRO' ? node.field + ':' + rankOf(node) : String(rankOf(node));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(node);
    }
    const nodesWithCoordinates = [];
    const headings = [];
    const lanes = new Map([['P', 115], ['S', 320], ['E', 525], ['M', 730]]);
    for (const [key, list] of groups) {
        const rank = rankOf(list[0]);
        const x = rank * (view === 'INTRO' ? 205 : 232) + (view === 'INTRO' ? 215 : 100);
        const lane = view === 'INTRO' ? (lanes.get(list[0].field) ?? 730) : 108;
        let groupStart = 0;
        list.forEach((node, index) => {
            if (view !== 'INTRO' && index && node.group && node.group !== list[index - 1].group && list.length > 12) {
                groupStart += 9;
            }
            nodesWithCoordinates.push({ node, x, y: lane + index * 76 + groupStart });
        });
        if (key === String(rank) && ['P', 'S', 'E'].includes(view)) {
            headings.push({ id: 'heading-' + rank, label: 'T' + rank, x, y: 39, cls: 'column' });
        }
    }
    if (view === 'INTRO') {
        for (const [id, y] of lanes) headings.push({ id: 'lane-' + id, label: FIELD_NAMES[id], x: 65, y, cls: 'lane', accent: COLORS[id] });
    }
    return { nodesWithCoordinates, headings };
}

export function createGraph(container, overlay, onSelect, createCheckbox) {
    const cy = cytoscape({
        container, style: STYLE, elements: [], layout: { name: 'preset' },
        minZoom: 0.15, maxZoom: 2.6, boxSelectionEnabled: false, autoungrabify: true,
        autounselectify: true, hideEdgesOnViewport: false,
    });
    let current = '';
    let firstNode = '';
    let canFit = false;
    let checkboxFrame = null;
    const checkboxes = new Map();

    cy.on('tap', 'node.tech', event => onSelect(event.target.id()));
    cy.on('viewport resize', queueCheckboxPositions);
    new ResizeObserver(() => cy.resize()).observe(container);

    function queueCheckboxPositions() {
        if (checkboxFrame !== null) return;
        checkboxFrame = requestAnimationFrame(() => {
            checkboxFrame = null;
            const width = container.clientWidth;
            const height = container.clientHeight;
            const zoom = cy.zoom();
            const size = Math.min(24, CARD_HEIGHT * zoom / 2, Math.max(22, 20 * zoom));
            overlay.style.setProperty('--stt-node-check-size', size + 'px');
            for (const [id, checkbox] of checkboxes) {
                const { x, y } = cy.getElementById(id).renderedPosition();
                const left = x - (CARD_WIDTH / 2 - 5) * zoom;
                const top = y - (CARD_HEIGHT / 2 - 4) * zoom;
                checkbox.hidden = !width || !height || left > width || top > height || left + size < 0 || top + size < 0;
                if (!checkbox.hidden) checkbox.style.transform = 'translate(' + left + 'px,' + top + 'px)';
            }
        });
    }

    function focus(id, zoomFloor = 0) {
        const node = cy.getElementById(id);
        if (node.empty()) return;
        if (zoomFloor && cy.zoom() < zoomFloor) cy.zoom(zoomFloor);
        cy.center(node);
    }

    function fit() {
        if (!canFit) return;
        cy.fit(cy.elements(), 35);
        if (cy.zoom() > 1.13) cy.zoom({ level: 1.13, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    }

    function select(id) {
        if (id === current) return;
        current = id;
        cy.batch(() => {
            cy.elements('.current, .neighbor, .lit').removeClass('current neighbor lit');
            if (!id) return;
            const node = cy.getElementById(id);
            node.addClass('current');
            node.neighborhood('node.tech').addClass('neighbor');
            node.connectedEdges().addClass('lit');
        });
    }

    function setNodes(nodes, view, states, activeId) {
        const { nodesWithCoordinates, headings } = coordinates(nodes, view);
        current = '';
        firstNode = nodesWithCoordinates[0]?.node.id ?? '';
        const included = new Set(nodes.map(node => node.id));
        const points = nodesWithCoordinates.map(({ node, x, y }) => ({
            data: {
                id: node.id, label: node.field === 'ME' ? node.id + '\n' + node.name : node.name,
                status: states.get(node.id), accent: COLORS[node.field],
            },
            position: { x, y }, classes: 'tech',
        }));
        for (const { id, label, x, y, cls, accent } of headings) {
            points.push({ data: { id, label, accent }, position: { x, y }, classes: cls });
        }
        const edges = [];
        for (const node of nodes) {
            const incoming = new Map();
            for (const group of node.requires) {
                for (const parent of group) {
                    if (!included.has(parent.id)) continue;
                    const optional = Number(group.length > 1);
                    incoming.set(parent.id, Math.min(optional, incoming.get(parent.id) ?? 1));
                }
            }
            for (const [source, optional] of incoming) {
                edges.push({ data: { id: source + '→' + node.id, source, target: node.id, optional } });
            }
        }
        cy.batch(() => {
            cy.elements().remove();
            cy.add([...points, ...edges]);
        });
        checkboxes.clear();
        const controls = document.createDocumentFragment();
        for (const { node } of nodesWithCoordinates) {
            const checkbox = createCheckbox(node);
            checkbox.hidden = true;
            checkboxes.set(node.id, checkbox);
            controls.append(checkbox);
        }
        overlay.replaceChildren(controls);
        select(activeId);
        canFit = points.length > 0;
        cy.resize();
        fit();
        if (activeId && view === 'FOCUS') focus(activeId, 0.8);
        else if (cy.zoom() < 0.52) focus(firstNode, container.clientWidth < 600 ? 0.72 : 0.62);
        queueCheckboxPositions();
    }

    function refresh(states) {
        cy.batch(() => cy.nodes('.tech').forEach(node => node.data('status', states.get(node.id()))));
    }

    function zoom(delta) {
        cy.zoom({
            level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * delta)),
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
    }
    return { setNodes, select, refresh, focus, zoom, fit, resize: () => cy.resize() };
}
