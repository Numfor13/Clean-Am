"""
GET   /public/stats    anyone: report counts for the public pages (no personal data)
POST  /guest/session   anyone: give this device a signed guest identity
GET   /me              signed-in user: their profile and role
PATCH /me              signed-in user: change username (citizens) or language
"""
import os
import time

from botocore.exceptions import ClientError

from common import (DONE, IN_PROGRESS, PENDING, ApiError, Key, api, body, caller, client, guest_label, is_true,
                    issue_guest_token, logger, now, plain, respond, table, text)

_stats = {"value": None, "expires": 0.0}  # cached per container for 5 minutes

PROFILE_TABLES = {"Admin": ("admins", "admin_id"), "Employee": ("employees", "employee_id"),
                  "Citizen": ("citizens", "citizen_id")}


def count(status: str) -> int:
    kwargs = {"IndexName": "GSI-status", "KeyConditionExpression": Key("status").eq(status), "Select": "COUNT"}
    total = 0
    while True:
        page = table("reports").query(**kwargs)
        total += page["Count"]
        if "LastEvaluatedKey" not in page:
            return total
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def stats():
    if time.time() > _stats["expires"]:
        pending, progress, done = count(PENDING), count(IN_PROGRESS), count(DONE)
        total = pending + progress + done
        _stats["value"] = {"reports_total": total, "reports_pending": pending, "reports_in_progress": progress,
                           "reports_resolved": done, "resolution_rate": round(done / total * 100, 1) if total else 0.0}
        _stats["expires"] = time.time() + 300
    return respond(200, {"stats": _stats["value"]})


def guest_session():
    token, guest_id, expires = issue_guest_token()
    return respond(201, {"guest_token": token, "guest_label": guest_label(guest_id), "expires_at": expires})


def me(event):
    who = caller(event)
    if who.role not in PROFILE_TABLES:
        raise ApiError(403, "FORBIDDEN", "Your account has no role yet. Contact an administrator.")
    table_name, key_name = PROFILE_TABLES[who.role]
    key = {key_name: who.id}

    if event["httpMethod"] == "PATCH":
        data = body(event)
        updates = {}
        if "language" in data:
            if data["language"] not in ("en", "fr"):
                raise ApiError(400, "INVALID_LANGUAGE", "Language must be 'en' or 'fr'.")
            updates["language"] = data["language"]
        if "username" in data and who.role == "Citizen":
            updates["username"] = text(data["username"], "username", 30)
        if not updates:
            raise ApiError(400, "NO_UPDATES", "Nothing to update.")
        updates["updated_at"] = now()
        profile = table(table_name).update_item(
            Key=key, UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
            ExpressionAttributeNames={f"#{k}": k for k in updates},
            ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
            ConditionExpression=f"attribute_exists({key_name})", ReturnValues="ALL_NEW")["Attributes"]
        if "language" in updates and who.cognito_username:
            # Cognito words the SMS codes and emails from custom:language.
            try:
                client("cognito-idp").admin_update_user_attributes(
                    UserPoolId=os.environ["USER_POOL_ID"], Username=who.cognito_username,
                    UserAttributes=[{"Name": "custom:language", "Value": updates["language"]}])
            except ClientError:
                logger.exception("could not update the Cognito language for %s", who.id)
    else:
        profile = table(table_name).get_item(Key=key).get("Item")
        if not profile:  # e.g. the first admin before their first profile write
            return respond(200, {"profile": {"user_id": who.id, "username": who.username, "role": who.role},
                                 "role": who.role})

    profile = plain(profile)
    profile.pop("cognito_username", None)
    if who.role == "Citizen":
        profile["is_suspended"] = is_true(profile.get("is_suspended"))
        # Status emails need a verified address; otherwise updates show only in the app.
        profile["notification_channel"] = "email" if profile.get("email_verified") is True else "in_app"
    return respond(200, {"profile": profile, "role": who.role})


@api
def handler(event, context):
    resource = event.get("resource")
    if resource == "/public/stats":
        return stats()
    if resource == "/guest/session":
        return guest_session()
    return me(event)
