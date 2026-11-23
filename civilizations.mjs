export const DEFAULT_CIVILIZATION = 'regular';

export const CIVILIZATION_TYPES = {
    regular: '常规文明',
    nomad: '游牧文明',
    corporate: '企业文明',
    nomad_corporate: '游牧企业',
    hive: '蜂巢意识',
    wilderness: '荒野文明',
    machine: '机械智能',
    individual_machine: '独立个体机械',
    assimilator: '驱动同化者',
    servitor: '失控机仆',
};

const all = Object.keys(CIVILIZATION_TYPES);
const nomads = ['nomad', 'nomad_corporate'];
const settled = all.filter(type => !nomads.includes(type));
const corporations = ['corporate', 'nomad_corporate'];
const hives = ['hive', 'wilderness'];
const machineIntelligences = ['machine', 'assimilator', 'servitor'];
const machines = [...machineIntelligences, 'individual_machine'];
const organicIndividualists = ['regular', 'nomad', ...corporations];
const organics = [...organicIndividualists, ...hives];
const individualists = [...organicIndividualists, 'individual_machine'];

// Apply type restrictions by project ID. Ethics, origins, shipsets and other
// qualifications remain in the project dossier.
const compatibleTypes = new Map([
    [nomads, [
        'arkship_construction', 'civilian_arkship', 'science_arkship', 'military_arkship',
        'planetary_engineering', 'waystation_1', 'nomads_mechanized_mining',
        'ap_defender_of_the_galaxy_nomads', 'ap_eternal_vigilance_nomads', 'ap_wanderlust',
    ]],
    [settled, [
        'starbase_1', 'colonization_1', 'cryostasis_1', 'planetary_defenses',
        'ap_defender_of_the_galaxy', 'ap_eternal_vigilance', 'ap_master_builders',
        'ap_world_shaper', 'ap_detox',
    ]],
    [corporations, ['xeno_tourism_agency', 'ap_universal_transactions']],
    [hives, ['node_culling_1', 'ap_organo_machine_interfacing', 'ap_hive_worlds']],
    [['hive'], ['hive_node']],
    [['wilderness'], ['wilderness_node', 'wilderness_terraform']],
    [[...hives, ...machineIntelligences], [
        'autonomous_agents', 'unity_of_purpose', 'collective_production_methods',
    ]],
    [organics, ['ap_engineered_evolution', 'ap_mind_over_matter']],
    [organicIndividualists, ['robotic_workers', 'ap_the_flesh_is_weak', 'ap_synthetic_evolution']],
    [individualists, ['ap_xeno_compatibility']],
    [machines, ['robomodding_m', 'ap_machine_worlds', 'ap_interdimensional_processing']],
    [machines.filter(type => type !== 'assimilator'), ['ap_synthetic_age']],
    [machineIntelligences, ['ap_mechromancy']],
    [['assimilator'], ['pk_nanobots', 'ap_organo_machine_interfacing_assimilator']],
    [[...individualists, ...machineIntelligences], ['ap_lord_of_war']],
    [all.filter(type => !machineIntelligences.includes(type)), ['ap_one_vision']],
    [settled.filter(type => !corporations.includes(type)), ['ap_imperial_prerogative']],
    [settled.filter(type => individualists.includes(type)), ['ap_consecrated_worlds']],
    [settled.filter(type => individualists.includes(type) || type === 'servitor'), ['ap_arcology_project']],
    [all.filter(type => type !== 'wilderness'), ['ap_voidborn']],
].flatMap(([types, ids]) => ids.map(id => [id, types])));

export function supportsCivilization(id, type) {
    return compatibleTypes.get(id)?.includes(type) ?? true;
}
