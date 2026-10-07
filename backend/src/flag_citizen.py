"""
POST /reports/{report_id}/flag         staff: mark a report false; the reporter gets a flag
GET  /citizens/flagged                 admin: citizens at or over the flag threshold
GET  /citizens/{citizen_id}            admin: one citizen and their flag history
POST /citizens/{citizen_id}/suspend    admin
POST /citizens/{citizen_id}/reinstate  admin

At 5 flags a citizen becomes eligible for suspension, which an admin decides.
A guest has no one to appeal to, so a guest is blocked automatically instead.
"""
import os

from botocore.exceptions import ClientError

from common import (FLAG_THRESHOLD, ApiError, Key, api, body, caller, client, decode_cursor, encode_cursor,
                    is_true, logger, msg, new_id, notify, now, page_size, path_param, plain, query, respond, table, text)

REASONS = {"NOT_WASTE", "DUPLICATE", "WRONG_LOCATION", "STAGED", "ALREADY_COLLECTED", "OTHER"}


def add_flag(table_name: str, key: dict) -> dict:
    return table(table_name).update_item(
        Key=key, UpdateExpression="ADD flag_count :one SET last_flagged_at = :now",
        ExpressionAttributeValues={":one": 1, ":now": now()}, ReturnValues="ALL_NEW")["Attributes"]


def auto_suspend_citizen(citizen_id: str, citizen: dict, flag_count: int, timestamp: str) -> None:
    """At the flag threshold the system suspends the citizen itself, no admin needed (Item 3)."""
    table("citizens").update_item(
        Key={"citizen_id": citizen_id},
        UpdateExpression="SET is_suspended = :yes, suspended_at = :now, suspended_by = :sys, suspended_reason = :why",
        ExpressionAttributeValues={":yes": "true", ":now": timestamp, ":sys": "system",
                                   ":why": f"Automatically suspended after reaching {flag_count} flags."})
    try:
        pool = os.environ.get("CITIZEN_USER_POOL_ID", os.environ.get("USER_POOL_ID", ""))
        client("cognito-idp").admin_disable_user(
            UserPoolId=pool, Username=citizen.get("cognito_username") or citizen_id)
    except ClientError:
        logger.exception("could not disable Cognito user %s", citizen_id)
    if citizen.get("email") and citizen.get("email_verified") is True:
        notify("CITIZEN_SUSPENDED", {"email": citizen["email"], "username": citizen.get("username"),
                                     "language": citizen.get("language", "en"), "flag_count": flag_count})


def flag_report(event):
    who = caller(event, "Employee")
    data = body(event)
    reason = str(data.get("reason") or "").upper()
    if reason not in REASONS:
        raise ApiError(400, "INVALID_REASON", "Unknown reason.", {"allowed": sorted(REASONS)})
    note = text(data.get("note"), "note", 500, required=False)
    if reason == "OTHER" and not note:
        raise ApiError(400, "NOTE_REQUIRED", "Add a note when the reason is Other.", {"field": "note"})

    report = table("reports").get_item(Key={"report_id": path_param(event, "report_id")}).get("Item")
    if not report:
        raise ApiError(404, "NOT_FOUND", msg("not_found", who.lang))
    existing = table("flags").query(IndexName="GSI-report", KeyConditionExpression=Key("report_id").eq(report["report_id"]))
    if any(f["flagged_by"] == who.id for f in existing["Items"]):
        raise ApiError(409, "ALREADY_FLAGGED", "You have already flagged this report.")

    timestamp = now()
    table("flags").put_item(Item={
        "flag_id": new_id("flg"), "citizen_id": report["citizen_id"], "report_id": report["report_id"],
        "reason": reason, "note": note, "flagged_by": who.id, "flagged_by_username": who.username,
        "flagged_at": timestamp})
    table("reports").update_item(
        Key={"report_id": report["report_id"]},
        UpdateExpression="SET is_fraudulent = :yes, flagged_by = :me, flag_reason = :reason, updated_at = :now ADD flag_count :one",
        ExpressionAttributeValues={":yes": True, ":me": who.id, ":reason": reason, ":now": timestamp, ":one": 1})

    if report.get("reporter_type") == "guest":
        guest = add_flag("guests", {"guest_id": report["guest_id"]})
        count = int(guest["flag_count"])
        if count >= FLAG_THRESHOLD:
            table("guests").update_item(Key={"guest_id": report["guest_id"]},
                                        UpdateExpression="SET is_blocked = :yes, blocked_at = :now",
                                        ExpressionAttributeValues={":yes": "true", ":now": timestamp})
        return respond(200, {"guest": {"label": report["username"], "flag_count": count,
                                       "threshold": FLAG_THRESHOLD, "is_blocked": count >= FLAG_THRESHOLD}})

    citizen = add_flag("citizens", {"citizen_id": report["citizen_id"]})
    count = int(citizen["flag_count"])
    suspended = is_true(citizen.get("is_suspended"))
    if count >= FLAG_THRESHOLD and not suspended:
        auto_suspend_citizen(report["citizen_id"], citizen, count, timestamp)
        suspended = True
    return respond(200, {"citizen": {"citizen_id": report["citizen_id"], "username": citizen.get("username"),
                                     "flag_count": count, "threshold": FLAG_THRESHOLD,
                                     "suspension_eligible": count >= FLAG_THRESHOLD,
                                     "is_suspended": suspended}})


def summary(citizen: dict) -> dict:
    citizen = plain(citizen)
    citizen.pop("cognito_username", None)
    citizen["is_suspended"] = is_true(citizen.get("is_suspended"))
    citizen["suspension_eligible"] = citizen.get("flag_count", 0) >= FLAG_THRESHOLD
    return citizen


def list_flagged(event):
    params = query(event)
    # GSI-suspended: partition "true"/"false", sorted by flag count, most flagged first.
    kwargs = {"IndexName": "GSI-suspended", "ScanIndexForward": False, "Limit": page_size(params),
              "KeyConditionExpression": Key("is_suspended").eq("true" if params.get("suspended") else "false")
              & Key("flag_count").gte(FLAG_THRESHOLD)}
    if params.get("cursor"):
        kwargs["ExclusiveStartKey"] = decode_cursor(params["cursor"])
    result = table("citizens").query(**kwargs)
    return respond(200, {"citizens": [summary(c) for c in result["Items"]], "threshold": FLAG_THRESHOLD,
                         "next_cursor": encode_cursor(result.get("LastEvaluatedKey"))})


def get_citizen(citizen_id: str) -> dict:
    citizen = table("citizens").get_item(Key={"citizen_id": citizen_id}).get("Item")
    if not citizen:
        raise ApiError(404, "NOT_FOUND", "That citizen could not be found.")
    return citizen


def citizen_detail(citizen_id: str):
    flags = table("flags").query(IndexName="GSI-citizen", KeyConditionExpression=Key("citizen_id").eq(citizen_id),
                                 ScanIndexForward=False)["Items"]
    return respond(200, plain({"citizen": summary(get_citizen(citizen_id)), "flags": flags, "threshold": FLAG_THRESHOLD}))


def set_suspended(event, who, citizen_id: str, suspend: bool):
    citizen = get_citizen(citizen_id)
    data = body(event)
    if is_true(citizen.get("is_suspended")) == suspend:
        raise ApiError(409, "ALREADY_SUSPENDED" if suspend else "NOT_SUSPENDED",
                       "That account is already suspended." if suspend else "That account is not suspended.")
    flag_count = int(citizen.get("flag_count", 0))
    # The threshold is a guardrail: an admin can go below it, but only on purpose.
    if suspend and flag_count < FLAG_THRESHOLD and not data.get("override_threshold"):
        raise ApiError(400, "BELOW_THRESHOLD", f"This citizen has {flag_count} flags; the threshold is {FLAG_THRESHOLD}.",
                       {"flag_count": flag_count, "threshold": FLAG_THRESHOLD})

    if suspend:
        update = "SET is_suspended = :yes, suspended_at = :now, suspended_by = :me, suspended_reason = :why"
        values = {":yes": "true", ":now": now(), ":me": who.id, ":why": text(data.get("reason"), "reason", 500, required=False)}
    else:
        update = ("SET is_suspended = :no, reinstated_at = :now, reinstated_by = :me, reinstated_note = :note "
                  "REMOVE suspended_at, suspended_by, suspended_reason")
        values = {":no": "false", ":now": now(), ":me": who.id,
                  ":note": text(data.get("note"), "note", 500, required=False)}
        if data.get("reset_flags"):
            update = update.replace("SET ", "SET flag_count = :zero, ", 1)
            values[":zero"] = 0
    result = table("citizens").update_item(Key={"citizen_id": citizen_id}, UpdateExpression=update,
                                           ExpressionAttributeValues=values, ReturnValues="ALL_NEW")["Attributes"]

    # Disabling the Cognito user also stops any session that is still open.
    action = client("cognito-idp").admin_disable_user if suspend else client("cognito-idp").admin_enable_user
    try:
        pool = os.environ.get("CITIZEN_USER_POOL_ID", os.environ.get("USER_POOL_ID", ""))
        action(UserPoolId=pool, Username=citizen.get("cognito_username") or citizen_id)
    except ClientError:
        logger.exception("could not update Cognito user %s", citizen_id)

    if suspend and citizen.get("email") and citizen.get("email_verified") is True:
        notify("CITIZEN_SUSPENDED", {"email": citizen["email"], "username": citizen.get("username"),
                                     "language": citizen.get("language", "en"), "flag_count": flag_count})
    return respond(200, {"citizen": summary(result)})


@api
def handler(event, context):
    resource = event.get("resource", "")
    if resource == "/reports/{report_id}/flag":
        return flag_report(event)
    who = caller(event, "Admin")
    if resource == "/citizens/flagged":
        return list_flagged(event)
    citizen_id = path_param(event, "citizen_id")
    if resource.endswith("/suspend"):
        return set_suspended(event, who, citizen_id, True)
    if resource.endswith("/reinstate"):
        return set_suspended(event, who, citizen_id, False)
    return citizen_detail(citizen_id)
