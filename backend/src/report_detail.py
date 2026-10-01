"""GET /reports/{report_id}: staff see any report with its moderation trail; citizens only their own."""
from common import ApiError, Key, api, caller, is_true, msg, path_param, plain, respond, table, with_photo


@api
def handler(event, context):
    who = caller(event, "Citizen", "Employee")
    item = table("reports").get_item(Key={"report_id": path_param(event, "report_id")}).get("Item")
    # 404 rather than 403 for someone else's report: IDs reveal nothing.
    if not item or not (who.is_staff or item["citizen_id"] == who.id):
        raise ApiError(404, "NOT_FOUND", msg("not_found", who.lang))

    report = with_photo(item)
    if not who.is_staff:
        for field in ("is_fraudulent", "flag_count", "flagged_by", "flag_reason"):
            report.pop(field, None)
        # Citizens see when their report moved, not who moved it.
        report["status_history"] = [{"status": h["status"], "at": h["at"]} for h in report.get("status_history", [])]
        return respond(200, {"report": report})

    if item.get("reporter_type") == "guest":
        guest = table("guests").get_item(Key={"guest_id": item["guest_id"]}).get("Item") or {}
        report["guest"] = {"label": item["username"], "flag_count": guest.get("flag_count", 0),
                           "is_blocked": is_true(guest.get("is_blocked")),
                           "total_reports": guest.get("report_count", 0), "first_seen": guest.get("created_at")}
    else:
        citizen = table("citizens").get_item(Key={"citizen_id": item["citizen_id"]}).get("Item") or {}
        report["citizen"] = {"citizen_id": item["citizen_id"], "username": citizen.get("username", item["username"]),
                             "flag_count": citizen.get("flag_count", 0), "is_suspended": is_true(citizen.get("is_suspended")),
                             "total_reports": citizen.get("report_count", 0), "member_since": citizen.get("created_at")}
    report["flags"] = table("flags").query(IndexName="GSI-report", KeyConditionExpression=Key("report_id").eq(item["report_id"]))["Items"]
    return respond(200, plain({"report": report}))
