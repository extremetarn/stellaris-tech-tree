#!/usr/bin/env python3
"""Build the extension dataset from the tagged SillyTavern worldbook."""

import argparse
import json
import re
from collections import Counter
from graphlib import TopologicalSorter
from pathlib import Path

GRAPH_HEADER = "ID\t名称\t阶位/类型\t前置式"
TOKEN = r"[A-Za-z0-9_-]+"
WORLD_REQUIREMENTS = {
    "配适": "相应专用配适方案",
}
RESEARCH_CONDITION_PREFIXES = ("专项获取：", "起研条件：")
# The graph column also contains specifications, deployment notes and optional variants.
# These unlabelled notes are actual prerequisites in the matching project descriptions.
RESEARCH_GATE_NOTES = {
    "gateway_activation",
    "dark_matter_power_core",
    "ME-28", "ME-30", "ME-34", "ME-36", "ME-37",
    "prosperous_unification",
}
RESEARCH_GATE_CLAUSES = {
    "ME-31": "原物料容器和检测科技",
    "ME-33": "对应船体、舰载供电与维修设施",
    "neutronium_gigaforge": "银河奇迹为科研入口",
}
ROUTES = {
    "ASC-GEN": ("基因飞升", None, ("ap_engineered_evolution",),
                ("适用人口与基因工程", "推进生体演化三阶段局势", "形成基因主传统与人口模板")),
    "ASC-PUR": ("纯净", "ASC-GEN", (),
                ("选定纯净", "推进谱系维护与相关传统", "稳定维护人口遗传模板")),
    "ASC-CLO": ("克隆", "ASC-GEN", (),
                ("选定克隆", "推进培养设施与相关传统", "形成持续培育和人口支持")),
    "ASC-MUT": ("突变", "ASC-GEN", (),
                ("选定突变", "推进可控表型与相关传统", "形成文明尺度的适应性改造")),
    "ASC-CYB": ("义体飞升", None,
                ("ap_the_flesh_is_weak", "ap_organo_machine_interfacing", "ap_organo_machine_interfacing_assimilator"),
                ("核对主体与相应义体天赋", "推进义体局势与增幅设施", "植入体融入文明人口与社会运转")),
    "ASC-SYN": ("合成飞升", None, ("ap_synthetic_evolution",),
                ("核对合成演化与适用人口", "推进合成传统和人口转移", "人口以合成载体延续")),
    "ASC-PSI": ("灵能飞升", None, ("ap_mind_over_matter", "ap_interdimensional_processing"),
                ("核对灵能入口和灵能理论", "推进群体觉醒、传统与虚境探索", "灵能进入文明日常")),
    "ASC-MAC": ("原生机械飞升", None, ("ap_synthetic_age",),
                ("核对原生机械资格与合成时代", "推进机械转型局势", "形成机械主传统")),
    "ASC-MOD": ("模块化", "ASC-MAC", (),
                ("选定模块化", "发展活体金属与模块工业", "实体机体可以持续换装和更新")),
    "ASC-NAN": ("纳米", "ASC-MAC", (),
                ("选定纳米路线", "发展纳米物料和分布式维护", "纳米群参与殖民地和大型建设")),
    "ASC-VIR": ("虚拟化", "ASC-MAC", (),
                ("选定虚拟化", "部署服务器、供能与备份", "文明人口在虚拟载体上运行")),
    "ap_become_the_crisis": ("天灾征途", None, ("ap_become_the_crisis",),
                             ("采纳天灾征途", "积累威慑并完成以太相引擎", "进入「始与终」并确认终局")),
    "ap_cosmogenesis": ("宇宙创生", None, ("ap_cosmogenesis",),
                         ("采纳宇宙创生", "积累超然逻辑并推进阶段课题", "地平线之针载文明迁入新宇宙")),
}


def rows_from(text):
    for line in text.splitlines():
        columns = line.split("\t")
        if len(columns) >= 4 and columns[0] != "ID":
            if not re.fullmatch(TOKEN, columns[0]) or not re.fullmatch(r"(?:[PSE][0-5]|ME|G|M|A)", columns[2]):
                raise ValueError(f"Invalid graph row: {line}")
            yield columns


def prerequisite_groups(expression, ids):
    if expression == "∅":
        return []
    groups = []
    for term in expression.split("+"):
        term = term.strip()
        if re.fullmatch(TOKEN, term):
            options = [term]
        elif re.fullmatch(r"\([^()]+\)", term):
            options = [value.strip() for value in term[1:-1].split("|")]
            if len(options) < 2 or len(set(options)) != len(options):
                raise ValueError(f"Invalid alternative group: {term}")
        else:
            raise ValueError(f"Invalid prerequisite term: {term}")
        group = []
        for option in options:
            if option in ids:
                group.append({"id": option})
            elif option in WORLD_REQUIREMENTS:
                group.append({"external": WORLD_REQUIREMENTS[option]})
            else:
                raise ValueError(f"Unknown prerequisite: {option}")
        groups.append(group)
    return groups


def body(content):
    return content.strip().splitlines()[1:-1]


def catalog(entries):
    details, perks, routes, giant_by_name = {}, {}, {}, {}
    for entry in entries:
        content = entry["content"]
        lines = body(content)
        if not lines:
            continue
        title = lines[0]
        if re.match(r"<(?:physics|society|engineering)_research>|<milestone>|<megastructure_research>", content):
            match = re.search(r"｜(" + TOKEN + r")】", title)
            if match:
                details[match[1].removeprefix("tech_")] = lines
        elif content.startswith("<me_technique>"):
            match = re.search(r"\b(ME-\d{2})\b", title)
            if match:
                details[match[1]] = lines
        elif content.startswith("<megastructure>"):
            name = entry["comment"].split(" · ", 1)[-1]
            giant_by_name[name] = lines
        elif content.startswith("<ascension_perk>"):
            match = re.match(r"【飞升天赋 ([^｜]+)｜[^｜]+｜(ap_[A-Za-z0-9_]+)】", title)
            if not match or match[2] in perks:
                raise ValueError(f"Invalid or duplicate ascension perk: {title}")
            perks[match[2]] = {
                "id": match[2], "name": match[1], "details": lines[1:],
                "type": next((line.split("｜", 1)[1].split("。")[0] for line in lines if line.startswith("归类｜")), "飞升天赋"),
            }
        elif content.startswith("<ascension_path>"):
            match = re.match(r"【飞升路线 (ASC-[A-Z]+) ·", title)
            if not match or match[1] in routes:
                raise ValueError(f"Invalid or duplicate ascension route: {title}")
            routes[match[1]] = [title.split("】", 1)[1], *lines[1:]]
    return details, perks, routes, giant_by_name


def build(path):
    entries = list(json.loads(path.read_text(encoding="utf-8"))["entries"].values())
    source_graph = next(e["content"] for e in entries if e["content"].startswith("<technology_graph>"))
    starter = next(e["content"] for e in entries if e["content"].startswith("<information_age_technology_graph>"))
    overview = next(e["content"] for e in entries if e["content"].startswith("<technology_tree_overview>"))
    if GRAPH_HEADER not in source_graph:
        raise ValueError("Expected a tagged full diagram with tab-delimited prerequisites")
    rows = list(rows_from(source_graph))
    ids = {row[0] for row in rows}
    if len(ids) != len(rows):
        raise ValueError(f"Duplicate IDs: {Counter(row[0] for row in rows) - Counter(ids)}")
    start_rows = list(rows_from(starter))
    full_rows = {row[0]: row[:4] for row in rows}
    if any(full_rows.get(row[0]) != row[:4] for row in start_rows):
        raise ValueError("A starter node is missing or disagrees with the full diagram")
    details, perks, route_details, giant_by_name = catalog(entries)
    nodes = []
    for node_id, name, rank, expression, *notes in rows:
        field = rank[0] if rank[:1] in "PSE" else rank
        tier = int(rank[1]) if field in "PSE" else None
        lines = details.get(node_id, giant_by_name.get(name, []) if field == "G" else [])
        external_note = notes[0] if notes and notes[0] != "—" else ""
        requirements = [line for line in lines if line.startswith(RESEARCH_CONDITION_PREFIXES)]
        if external_note and (node_id in RESEARCH_GATE_NOTES or external_note.startswith(RESEARCH_CONDITION_PREFIXES)):
            requirements.append(external_note)
        if node_id in RESEARCH_GATE_CLAUSES:
            requirements.append(RESEARCH_GATE_CLAUSES[node_id])
        flavor = next((line for line in lines if re.match(r"(科技|档案)释义：", line)), "")
        summary = flavor.partition("：")[2] or (lines[1] if len(lines) > 1 else "")
        group = next((line.split(" · ")[1] for line in lines if re.match(r"^(物理学|社会学|工程学) · ", line)), "")
        nodes.append({
            "id": node_id, "name": name, "field": field, "tier": tier, "group": group,
            "requires": prerequisite_groups(expression, ids),
            "tierGate": tier - 1 if tier in (2, 3, 4, 5) and not requirements else None,
            "requirements": list(dict.fromkeys(requirements)), "note": external_note,
            "output": notes[1] if len(notes) > 1 and notes[1] != "—" else "",
            "summary": summary, "details": lines[1:],
            "derivedFrom": "gateway_construction" if node_id == "lgate_activation" else None,
        })
    deps = {n["id"]: [v["id"] for g in n["requires"] for v in g if "id" in v] for n in nodes}
    list(TopologicalSorter(deps).static_order())
    ascension = []
    for route_id, (name, parent, entry_perks, stages) in ROUTES.items():
        lines = route_details[route_id] if route_id.startswith("ASC-") else perks[route_id]["details"]
        if parent and parent not in ROUTES or any(p not in perks for p in entry_perks):
            raise ValueError(f"An ascension route contains an unresolved reference: {route_id}")
        ascension.append({
            "id": route_id, "name": name, "parent": parent, "perks": entry_perks,
            "stages": stages, "details": lines,
        })
    return {
        "schema": 1, "worldbook": path.name, "nodes": nodes,
        "introIds": [row[0] for row in start_rows],
        "definitions": {
            "ME": next(line.split("｜", 1)[1] for line in overview.splitlines() if line.startswith("ME ")),
            "ASC": next(line.split("｜", 1)[1] for line in overview.splitlines() if line.startswith("特殊·飞升之路")),
        },
        "ascension": ascension, "perks": list(perks.values()),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("worldbook", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "tech-tree.json")
    args = parser.parse_args()
    data = build(args.worldbook)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f'{len(data["nodes"])} technology records, {len(data["introIds"])} starter records, '
          f'{len(data["ascension"])} ascension routes and {len(data["perks"])} perks')
