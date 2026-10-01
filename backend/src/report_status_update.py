"""PATCH /reports/{report_id}/status: move a report Pending -> In Progress -> Done."""
from botocore.exceptions import ClientError

from common import (DONE, IN_PROGRESS, TRANSITIONS, ApiError, api, body, caller, conditional_failed, msg, notify,
                    now, path_param, respond, status_value, table, text, with_photo)


@api
def handler(event, context):
    who = caller(event, "Employee")
    data = body(event)
    target = status_value(data.get("status"))
    note = text(data.get("note"), "note", 500, required=False)
    reports = table("reports")
    report = reports.get_item(Key={"report_id": path_param(event, "report_id")}).get("Item")
    if not report:
        raise ApiError(404, "NOT_FOUND", msg("not_found", who.lang))

    current = report["status"]
    if data.get("expected_current") and data["expected_current"] != current:
        raise ApiError(409, "STALE_STATE", "This report was updated by someone else. Refresh and try again.")
    if target not in TRANSITIONS[current]:
        raise ApiError(400, "INVALID_TRANSITION", f"A {current} report cannot move to {target}.",
                       {"allowed": sorted(TRANSITIONS[current])})

    timestamp = now()
    entry = {"status": target, "from_status": current, "at": timestamp, "by": who.id,
             "by_username": who.username, "by_role": who.role, "note": note}
    update = "SET #s = :target, updated_at = :now, status_history = list_append(status_history, :entry)"
    if target == DONE:
        update += ", resolved_by = :me, resolved_at = :now"
    elif current == DONE and target == IN_PROGRESS:
        update += " REMOVE resolved_by, resolved_at"
    values = {":target": target, ":now": timestamp, ":entry": [entry], ":current": current}
    if target == DONE:
        values[":me"] = who.id
    try:
        # The condition stops two crew members changing the same report at once.
        result = reports.update_item(
            Key={"report_id": report["report_id"]}, UpdateExpression=update, ConditionExpression="#s = :current",
            ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues=values, ReturnValues="ALL_NEW")
    except ClientError as exc:
        if conditional_failed(exc):
            raise ApiError(409, "CONCURRENT_UPDATE", "Another employee changed this report first. Refresh and try again.")
        raise

    # Status emails go only to citizens who added and verified an email address.
    citizen = table("citizens").get_item(Key={"citizen_id": report["citizen_id"]}).get("Item") or {}
    if citizen.get("email") and citizen.get("email_verified") is True:
        notify("REPORT_STATUS_CHANGED", {"email": citizen["email"], "username": citizen.get("username"),
                                         "language": citizen.get("language", "en"), "status": target,
                                         "quarter": report.get("quarter")})
    return respond(200, {"report": with_photo(result["Attributes"])})
