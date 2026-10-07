"""
GET /reports      staff: every report, filtered by quarter, status, date or text
GET /reports/me   citizen: their own reports
"""
from boto3.dynamodb.conditions import Attr

from common import PENDING, Key, api, caller, decode_cursor, encode_cursor, page_size, query, respond, status_value, table, text, with_photo

# Fields a citizen never sees on their own reports.
MODERATION_FIELDS = ("is_fraudulent", "flag_count", "flagged_by", "flag_reason", "status_history")


# The key attributes of each index: a page that stops part-way through a read
# restarts right after its last report.
INDEX_KEYS = {"GSI-citizen": "citizen_id", "GSI-status": "status", "GSI-quarter": "quarter", "GSI-created": "record_type"}
BATCH, MAX_READS = 100, 10


def page(operation, **kwargs) -> dict:
    """
    One page of up to `Limit` reports. DynamoDB applies Limit before filters,
    so reads happen in batches of 100 until the page is full; if a batch
    overfills it, the cursor points just after the last report returned.
    """
    wanted, index = kwargs.pop("Limit"), kwargs["IndexName"]
    items, last_key = [], None
    for _ in range(MAX_READS):
        result = operation(**kwargs, Limit=BATCH if "FilterExpression" in kwargs else wanted)
        items += result.get("Items", [])
        last_key = result.get("LastEvaluatedKey")
        if len(items) >= wanted:
            if len(items) > wanted:
                items = items[:wanted]
                last = items[-1]
                last_key = {k: last[k] for k in ("report_id", INDEX_KEYS[index], "created_at")}
            break
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    reports = [with_photo(item) for item in items]
    for report in reports:
        report.pop("status_history", None)
    cursor = encode_cursor(last_key)
    return {"reports": reports, "count": len(reports), "next_cursor": cursor, "has_more": bool(cursor)}


def my_reports(event):
    who = caller(event, "Citizen")
    params = query(event)
    kwargs = {"IndexName": "GSI-citizen", "KeyConditionExpression": Key("citizen_id").eq(who.id),
              "ScanIndexForward": False, "Limit": page_size(params)}
    if params.get("status"):
        kwargs["FilterExpression"] = Attr("status").eq(status_value(params["status"]))
    if params.get("cursor"):
        kwargs["ExclusiveStartKey"] = decode_cursor(params["cursor"])
    body = page(table("reports").query, **kwargs)
    for report in body["reports"]:
        for field in MODERATION_FIELDS:
            report.pop(field, None)
    return respond(200, body)


def all_reports(event):
    caller(event, "Employee")
    params = query(event)
    status = status_value(params["status"]) if params.get("status") else None
    quarter = text(params.get("quarter"), "quarter", 80, required=False)
    reports = table("reports")
    kwargs = {"Limit": page_size(params)}

    since = text(params.get("from"), "from", 30, required=False)

    # Every path is an index query sorted by created_at, so pages come back in
    # date order from first to last (a scan would return them in no order).
    filters = []
    if quarter:
        index, key = "GSI-quarter", Key("quarter").eq(quarter)
        if status:
            filters.append(Attr("status").eq(status))
    elif status:
        index, key = "GSI-status", Key("status").eq(status)
    else:
        index, key = "GSI-created", Key("record_type").eq("REPORT")
    if since:
        key &= Key("created_at").gte(since)
    operation = reports.query
    kwargs.update(IndexName=index, KeyConditionExpression=key, ScanIndexForward=params.get("sort") == "oldest")

    if params.get("fraudulent_only"):
        filters.append(Attr("is_fraudulent").eq(True))
    elif not params.get("include_fraudulent"):
        filters.append(Attr("is_fraudulent").eq(False))
    if params.get("search"):
        filters.append(Attr("search_text").contains(text(params["search"], "search", 100).lower()))
    if filters:
        combined = filters[0]
        for extra in filters[1:]:
            combined &= extra
        kwargs["FilterExpression"] = combined
    if params.get("cursor"):
        kwargs["ExclusiveStartKey"] = decode_cursor(params["cursor"])

    return respond(200, page(operation, **kwargs))


def unassigned_reports(event):
    """Admin only: PENDING reports no employee covers — the "not assigned to anyone" queue (Item 4)."""
    caller(event, "Admin")
    params = query(event)
    kwargs = {"IndexName": "GSI-status", "KeyConditionExpression": Key("status").eq(PENDING),
              "ScanIndexForward": params.get("sort") == "oldest", "Limit": page_size(params),
              "FilterExpression": Attr("assigned_to").not_exists()}
    if params.get("cursor"):
        kwargs["ExclusiveStartKey"] = decode_cursor(params["cursor"])
    return respond(200, page(table("reports").query, **kwargs))


@api
def handler(event, context):
    resource = event.get("resource")
    if resource == "/reports/me":
        return my_reports(event)
    if resource == "/reports/unassigned":
        return unassigned_reports(event)
    return all_reports(event)
