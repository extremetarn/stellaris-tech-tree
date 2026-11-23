"""Extract ship equipment specifications from the Stellaris V4.0 world book."""
import argparse
import json
from pathlib import Path
import re

CATEGORIES = {
    "<weapon_technique>": "weapon",
    "<armor_technique>": "armor",
    "<shield_technique>": "shield",
    "<ship_equipment_technique>": "device",
}
STAT = re.compile(r"^(额定速度|硬度|护盾强度|武器威力|拦截强度|航空打击强度|特性)｜(.+?)。?$")
RESEARCH_ID = re.compile(r"〔([a-zA-Z0-9_]+)／")
FIXED = ("深空防御平台", "专用深空捕获平台", "固定设施配套")


def equipment(uid, content):
    tag, title, overview, budget, *lines, _ = content.strip().splitlines()
    name, english = title[1:-1].split("｜", 1)
    _, family, research_tier, *_ = overview.split(" · ")
    item = {
        "id": str(uid), "name": name, "english": english,
        "category": CATEGORIES[tag], "family": family,
        "tier": int(research_tier.removeprefix("科研 T")),
        "specs": {},
    }

    power = re.fullmatch(r"供能额度｜负载上限 \+(\d+)，散热占用 (\d+)。", budget)
    if power:
        added_load, heat = map(int, power.groups())
        item["category"] = "power"
        item["specs"][""] = {"capacity": added_load, "heat": heat}
    else:
        if not budget.startswith("负载消耗｜"):
            raise ValueError(f"{name} 缺少负载或供能规格")
        for option in budget.removeprefix("负载消耗｜").removesuffix("。").split("／"):
            size, load = option.rsplit(" ", 1) if " " in option else ("", option)
            item["specs"][size] = {"load": int(load)}

    stats, details, research = [], [], []
    mount = ""
    for line in lines:
        match = STAT.fullmatch(line)
        if match:
            stats.append(list(match.groups()))
        elif line.startswith(("对应科研 ", "同型部件的其它科研关联为")):
            research.extend(RESEARCH_ID.findall(line))
        elif line.startswith("装舰位置为"):
            mount = line.removeprefix("装舰位置为").removesuffix("。")
        elif line and not line.startswith("制造规格包括"):
            details.append(line)
    item.update(stats=stats, effect="".join(details), mount=mount, research=list(dict.fromkeys(research)))
    if any(term in mount or family == term for term in FIXED):
        item["fit"] = "fixed"
    elif family in ("活体舰组织", "活体近战") or name.endswith("代谢系统"):
        item["fit"] = "bio"
    elif name.endswith(("反应堆", "反应堆增压器")):
        item["fit"] = "mechanical"
    elif "主宰" in mount:
        item["fit"] = "juggernaut"
    elif "泰坦" in mount:
        item["fit"] = "titan"
    elif family == "天体任务载荷":
        item["fit"] = "colossus"
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worldbook", type=Path)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "data/ship-equipment.json")
    args = parser.parse_args()
    entries = json.loads(args.worldbook.read_text(encoding="utf-8-sig"))["entries"]
    parts = []
    for entry in entries.values():
        content = entry.get("content", "").strip()
        if content.split("\n", 1)[0] in CATEGORIES:
            parts.append(equipment(entry["uid"], content))
    if not parts or len({part["id"] for part in parts}) != len(parts):
        raise ValueError("舰装目录为空或条目 UID 重复")
    data = json.dumps(sorted(parts, key=lambda part: int(part["id"])), ensure_ascii=False, separators=(",", ":"))
    args.output.write_text(data + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
