"""
Auto-assignment: match a new report to the employees responsible for its quarter.

Eligibility is by coverage zone (the quarter must be in the employee's `zones`);
among the eligible, the nearest to the report (by their base point) win. Heavy
categories get a two-person crew, everything else one.
"""
import math

from common import IN_PROGRESS, Key, PENDING, query_all, table

# Categories heavy enough to need a two-person crew; every other category is one.
TEAM_SIZE = {"ILLEGAL_DUMPING": 2, "BURNING_WASTE": 2}


def metres_between(lat1, lng1, lat2, lng2) -> float:
    """Equirectangular approximation: plenty accurate at city distances."""
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return math.hypot(x, y) * 6_371_000


def team_size(category) -> int:
    return TEAM_SIZE.get(str(category or "").upper(), 1)


def active_employees() -> list[dict]:
    """Every active employee; the table holds at most a council's worth."""
    items, kwargs = [], {"FilterExpression": "is_active = :t", "ExpressionAttributeValues": {":t": True}}
    while True:
        result = table("employees").scan(**kwargs)
        items += result.get("Items", [])
        if "LastEvaluatedKey" not in result:
            return items
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def choose_assignees(quarter: str, category, lat: float, lng: float, pool: list[dict] | None = None) -> list[dict]:
    """The nearest 1–2 active employees whose zones include this quarter, or []."""
    employees = pool if pool is not None else active_employees()
    eligible = [e for e in employees if quarter in (e.get("zones") or [])]
    if not eligible:
        return []

    def distance(e) -> float:
        if e.get("base_lat") is None or e.get("base_lng") is None:
            return float("inf")
        return metres_between(lat, lng, float(e["base_lat"]), float(e["base_lng"]))

    eligible.sort(key=distance)
    return eligible[: team_size(category)]


def pending_unassigned_in(zones: set[str]) -> list[dict]:
    """Pending reports with no assignee whose quarter one of these zones covers."""
    if not zones:
        return []
    rows = query_all(table("reports"), IndexName="GSI-status", KeyConditionExpression=Key("status").eq(PENDING))
    return [r for r in rows if not r.get("assigned_to") and r.get("quarter") in zones]
