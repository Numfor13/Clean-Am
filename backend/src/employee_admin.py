"""
POST   /employees                  admin creates a staff account; Cognito emails the invitation
GET    /employees                  admin lists staff accounts
GET    /employees/{employee_id}
DELETE /employees/{employee_id}    revoke access (deactivate, never delete: reports refer to them)
"""
import os
import re
import secrets
import string

from decimal import Decimal

from botocore.exceptions import ClientError

from assignment import active_employees, choose_assignees, pending_unassigned_in
from common import (IN_PROGRESS, PENDING, ApiError, Key, api, body, caller, client, conditional_failed, decode_cursor,
                    encode_cursor, logger, now, page_size, path_param, plain, query, respond, table, text)

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$"
# Symbols that read clearly in an email and need no escaping in HTML.
SYMBOLS = "!#$%*+-=?@_"


def temporary_password(length: int = 14) -> str:
    """A random first-sign-in password meeting the pool policy: upper, lower, digit and symbol."""
    groups = (string.ascii_uppercase, string.ascii_lowercase, string.digits, SYMBOLS)
    chars = [secrets.choice(group) for group in groups]
    chars += [secrets.choice("".join(groups)) for _ in range(length - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def cognito_failure(step: str, exc: ClientError) -> ApiError:
    """Admins see Cognito's own reason (this route is admin-only), and it is logged."""
    error = exc.response["Error"]
    logger.exception("Cognito could not %s", step)
    return ApiError(502, "COGNITO_ERROR", f"Cognito could not {step}: {error.get('Code')}: {error.get('Message')}")


def parse_zones(data) -> list[str]:
    """The quarters an employee covers; at least one is required for auto-assignment."""
    raw = data.get("zones")
    if not isinstance(raw, list):
        raise ApiError(400, "INVALID_FIELD", "Select at least one coverage zone.", {"field": "zones"})
    zones, seen = [], set()
    for z in raw:
        name = text(z, "zone", 80)
        if name.lower() not in seen:
            seen.add(name.lower())
            zones.append(name)
    if not zones:
        raise ApiError(400, "MISSING_FIELD", "Select at least one coverage zone.", {"field": "zones"})
    return zones


def parse_base(data) -> tuple[Decimal | None, Decimal | None]:
    """Optional base point used to break ties between employees covering the same quarter."""
    lat, lng = data.get("base_lat"), data.get("base_lng")
    if lat in (None, "") or lng in (None, ""):
        return None, None
    try:
        return Decimal(str(round(float(lat), 6))), Decimal(str(round(float(lng), 6)))
    except (TypeError, ValueError):
        raise ApiError(400, "INVALID_COORDINATES", "The base coordinates are not valid.")


def drain_pending(employee: dict) -> None:
    """A new employee immediately picks up pending reports in their zones that no one covered (Items 2 & 4)."""
    zones = set(employee.get("zones") or [])
    if not zones:
        return
    pool, stamp = active_employees(), now()
    for report in pending_unassigned_in(zones):
        try:
            lat, lng = float(report["latitude"]), float(report["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        assignees = choose_assignees(report.get("quarter"), report.get("category"), lat, lng, pool=pool)
        if not assignees:
            continue
        entry = {"status": IN_PROGRESS, "at": stamp, "by": "system", "by_role": "System", "note": "Auto-assigned"}
        try:
            table("reports").update_item(
                Key={"report_id": report["report_id"]},
                UpdateExpression=("SET assigned_to = :ids, assigned_names = :names, assigned_at = :now, "
                                  "#s = :inprog, updated_at = :now, "
                                  "status_history = list_append(status_history, :h)"),
                ConditionExpression="attribute_not_exists(assigned_to) AND #s = :pending",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":ids": [e["employee_id"] for e in assignees],
                                           ":names": [e.get("name") or e["employee_id"] for e in assignees],
                                           ":now": stamp, ":inprog": IN_PROGRESS, ":pending": PENDING, ":h": [entry]})
        except ClientError as exc:
            if not conditional_failed(exc):
                raise


def create(event, who):
    data = body(event)
    name = text(data.get("name"), "name", 100)
    email = text(data.get("email"), "email", 254).lower()
    if not re.match(EMAIL_PATTERN, email):
        raise ApiError(400, "INVALID_EMAIL", "Enter a valid email address.", {"field": "email"})
    zones = parse_zones(data)
    base_lat, base_lng = parse_base(data)
    location = text(data.get("location"), "location", 100, required=False) or ", ".join(zones)
    language = "fr" if data.get("language") == "fr" else "en"
    if table("employees").query(IndexName="GSI-email", KeyConditionExpression=Key("email").eq(email), Limit=1)["Items"]:
        raise ApiError(409, "EMAIL_EXISTS", "An account with that email address already exists.")

    cognito, pool = client("cognito-idp"), os.environ.get("EMPLOYEE_USER_POOL_ID", os.environ.get("USER_POOL_ID", ""))
    try:
        # The pool allows sign-in by SMS code, so Cognito no longer invents a
        # password for a user without a phone: we pass one. Cognito emails it in
        # the invitation (worded by the custom-message trigger); it is never
        # stored, logged or returned, and must be changed at first sign-in.
        user = cognito.admin_create_user(
            UserPoolId=pool, Username=email, DesiredDeliveryMediums=["EMAIL"],
            TemporaryPassword=temporary_password(),
            UserAttributes=[{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"},
                            {"Name": "name", "Value": name}, {"Name": "custom:language", "Value": language}])["User"]
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "UsernameExistsException":
            raise ApiError(409, "EMAIL_EXISTS", "An account with that email address already exists.")
        raise cognito_failure("create the account", exc)
    # Email is a sign-in alias, so Cognito names the user internally; use that name from here on.
    try:
        cognito.admin_add_user_to_group(UserPoolId=pool, Username=user["Username"], GroupName="Employee")
    except ClientError as exc:
        # Never leave an account that can sign in with no role.
        cognito.admin_delete_user(UserPoolId=pool, Username=user["Username"])
        raise cognito_failure("give the account the Employee role", exc)

    employee = {
        "employee_id": next(a["Value"] for a in user["Attributes"] if a["Name"] == "sub"),
        "cognito_username": user["Username"], "name": name, "email": email, "location": location,
        "zones": zones,
        "language": language, "is_active": True, "created_by": who.id, "created_by_username": who.username,
        "created_at": now(),
    }
    if base_lat is not None:
        employee["base_lat"], employee["base_lng"] = base_lat, base_lng
    table("employees").put_item(Item=employee)
    drain_pending(employee)  # take over any unassigned reports now that this zone is covered
    return respond(201, {"employee": plain(employee)})


def list_employees(event):
    """Newest first across every page: a council has tens of staff, so read them all, then page."""
    params = query(event)
    size = page_size(params)
    everyone, kwargs = [], {}
    while True:
        result = table("employees").scan(**kwargs)
        everyone += result.get("Items", [])
        if "LastEvaluatedKey" not in result:
            break
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]
    everyone.sort(key=lambda e: e["created_at"], reverse=True)
    start = int((decode_cursor(params.get("cursor")) or {}).get("offset", 0))
    rows = everyone[start:start + size]
    more = start + size < len(everyone)
    return respond(200, {"employees": plain(rows), "next_cursor": encode_cursor({"offset": start + size}) if more else None})


def get_employee(employee_id: str) -> dict:
    employee = table("employees").get_item(Key={"employee_id": employee_id}).get("Item")
    if not employee:
        raise ApiError(404, "NOT_FOUND", "That employee could not be found.")
    return employee


def revoke(who, employee_id: str):
    employee = get_employee(employee_id)
    if not employee.get("is_active"):
        raise ApiError(409, "ALREADY_INACTIVE", "That account is already deactivated.")
    result = table("employees").update_item(
        Key={"employee_id": employee_id}, UpdateExpression="SET is_active = :no, deactivated_at = :now, deactivated_by = :me",
        ExpressionAttributeValues={":no": False, ":now": now(), ":me": who.id}, ReturnValues="ALL_NEW")
    try:
        pool = os.environ.get("EMPLOYEE_USER_POOL_ID", os.environ.get("USER_POOL_ID", ""))
        client("cognito-idp").admin_disable_user(UserPoolId=pool, Username=employee["cognito_username"])
    except ClientError:
        logger.exception("could not disable %s in Cognito", employee_id)
    return respond(200, {"employee": plain(result["Attributes"])})


@api
def handler(event, context):
    who = caller(event, "Admin")
    method, employee_id = event.get("httpMethod"), path_param(event, "employee_id")
    if method == "POST":
        return create(event, who)
    if method == "DELETE":
        return revoke(who, employee_id)
    if employee_id:
        return respond(200, {"employee": plain(get_employee(employee_id))})
    return list_employees(event)
