"""
POST /reports                  a signed-in citizen submits a report
POST /guest/reports            a guest submits one (no status feedback)
POST /me/claim-guest-reports   a new citizen takes over this device's guest reports
"""
import math
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from botocore.exceptions import ClientError

from assignment import choose_assignees
from common import (GUEST_PREFIX, IN_PROGRESS, PENDING, ApiError, Key, api, body, caller, client, conditional_failed,
                    msg, new_id, now, query_all, reporter, respond, search_text, staging_prefix, table, text,
                    verify_guest_token, with_photo)

CATEGORIES = {"ILLEGAL_DUMPING", "OVERFLOWING_BIN", "BLOCKED_DRAIN", "BURNING_WASTE", "HOUSEHOLD_WASTE", "OTHER"}
RATE_LIMITS = {"citizen": (timedelta(minutes=10), 5), "guest": (timedelta(hours=1), 3)}
DUPLICATE_METRES, DUPLICATE_WINDOW = 50, timedelta(hours=24)
CAMEROON = {"lat": (1.5, 13.2), "lng": (8.3, 16.3)}  # bounding box with a small margin


def since(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) - delta).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def recent_reports(owner_id: str, delta: timedelta) -> list[dict]:
    return table("reports").query(
        IndexName="GSI-citizen",
        KeyConditionExpression=Key("citizen_id").eq(owner_id) & Key("created_at").gte(since(delta)),
    ).get("Items", [])


def metres_between(lat1, lng1, lat2, lng2) -> float:
    """Equirectangular approximation: accurate to well under a metre at 50 m."""
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return math.hypot(x, y) * 6_371_000


def move_photo(key: str, report_id: str, lang: str) -> str:
    """Confirm the upload exists, then move it out of staging/ (which expires after 2 days)."""
    bucket, s3 = os.environ["PHOTO_BUCKET"], client("s3")
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
    except ClientError:
        raise ApiError(400, "PHOTO_NOT_UPLOADED", msg("photo_missing", lang))
    final_key = f"reports/{report_id}{os.path.splitext(key)[1] or '.jpg'}"
    s3.copy_object(Bucket=bucket, Key=final_key, CopySource={"Bucket": bucket, "Key": key},
                   ContentType=head.get("ContentType", "image/jpeg"), ServerSideEncryption="AES256",
                   MetadataDirective="REPLACE")
    s3.delete_object(Bucket=bucket, Key=key)
    return final_key


def submit(event):
    who = reporter(event)
    kind = "guest" if who.is_guest else "citizen"
    data = body(event)

    if not data.get("s3_key"):
        raise ApiError(400, "PHOTO_REQUIRED", msg("photo_required", who.lang))
    if data.get("latitude") in (None, "") or data.get("longitude") in (None, ""):
        raise ApiError(400, "LOCATION_REQUIRED", msg("location_required", who.lang))
    if not data.get("quarter"):
        raise ApiError(400, "QUARTER_REQUIRED", msg("quarter_required", who.lang))
    try:
        lat, lng = round(float(data["latitude"]), 6), round(float(data["longitude"]), 6)
    except (TypeError, ValueError):
        raise ApiError(400, "INVALID_COORDINATES", "The coordinates are not valid.")
    if not (CAMEROON["lat"][0] <= lat <= CAMEROON["lat"][1] and CAMEROON["lng"][0] <= lng <= CAMEROON["lng"][1]):
        raise ApiError(400, "COORDINATES_OUT_OF_BOUNDS", msg("outside_cameroon", who.lang))
    category = str(data.get("category") or "OTHER").upper()
    if category not in CATEGORIES:
        raise ApiError(400, "INVALID_CATEGORY", "Unknown report category.", {"allowed": sorted(CATEGORIES)})
    quarter = text(data["quarter"], "quarter", 80)
    city = text(data.get("city"), "city", 80, required=False)
    description = text(data.get("description"), "description", 1000, required=False)
    if not str(data["s3_key"]).startswith(staging_prefix(who)):
        raise ApiError(400, "INVALID_PHOTO_KEY", "That photo does not belong to you.")

    window, limit = RATE_LIMITS[kind]
    if len(recent_reports(who.id, window)) >= limit:
        raise ApiError(429, "RATE_LIMITED", msg(f"{'guest_' if who.is_guest else ''}rate_limited", who.lang))

    if not data.get("confirm_duplicate"):
        for old in recent_reports(who.id, DUPLICATE_WINDOW):
            if old["status"] != "DONE" and metres_between(lat, lng, float(old["latitude"]), float(old["longitude"])) <= DUPLICATE_METRES:
                raise ApiError(400, "POSSIBLE_DUPLICATE", msg("duplicate", who.lang), {
                    "existing_report_id": old["report_id"], "existing_status": old["status"],
                    "created_at": old["created_at"]})

    if who.is_guest:
        # First report from this device creates its guest record.
        guests = table("guests")
        try:
            guests.put_item(Item={"guest_id": who.guest_id, "label": who.username, "flag_count": 0,
                                  "is_blocked": "false", "report_count": 0, "created_at": now()},
                            ConditionExpression="attribute_not_exists(guest_id)")
        except ClientError as exc:
            if not conditional_failed(exc):
                raise
            if guests.get_item(Key={"guest_id": who.guest_id})["Item"].get("claimed_by"):
                raise ApiError(403, "USE_ACCOUNT", "This device's reports now belong to an account. Sign in to report.")
        username = who.username
    else:
        citizen = table("citizens").get_item(Key={"citizen_id": who.id}).get("Item") or {}
        username = citizen.get("username") or who.username  # never from the request body

    report_id = new_id("rpt")
    timestamp = now()
    report = {
        "report_id": report_id,
        "record_type": "REPORT",  # the one partition of GSI-created: every report, newest first
        "citizen_id": who.id,  # "guest#<id>" for guests, so a later claim can find them
        "reporter_type": kind,
        "username": username,
        "image_s3_key": move_photo(data["s3_key"], report_id, who.lang),
        "latitude": Decimal(str(lat)),
        "longitude": Decimal(str(lng)),
        "quarter": quarter,
        "city": city,
        "category": category,
        "description": description,
        "status": PENDING,
        "is_fraudulent": False,
        "flag_count": 0,
        "language": who.lang,
        "created_at": timestamp,
        "updated_at": timestamp,
        "status_history": [{"status": PENDING, "at": timestamp, "by": who.id, "by_role": who.role}],
    }
    # Auto-assign to the nearest employees whose zones cover this quarter (Item 2).
    # If no one covers it, the report stays PENDING and unassigned and surfaces in
    # the admin's "unassigned" queue (Item 4).
    assignees = choose_assignees(quarter, category, lat, lng)
    if assignees:
        report["assigned_to"] = [e["employee_id"] for e in assignees]
        report["assigned_names"] = [e.get("name") or e["employee_id"] for e in assignees]
        report["assigned_at"] = timestamp
        report["status"] = IN_PROGRESS
        report["status_history"].append(
            {"status": IN_PROGRESS, "at": timestamp, "by": "system", "by_role": "System", "note": "Auto-assigned"})
    if who.is_guest:
        report["guest_id"] = who.guest_id
    report["search_text"] = search_text(report)
    table("reports").put_item(Item=report, ConditionExpression="attribute_not_exists(report_id)")

    counter_table, counter_key = (("guests", {"guest_id": who.guest_id}) if who.is_guest
                                  else ("citizens", {"citizen_id": who.id}))
    table(counter_table).update_item(Key=counter_key, UpdateExpression="ADD report_count :one",
                                     ExpressionAttributeValues={":one": 1})

    report = with_photo(report)
    report.pop("status_history")
    # "none" tells the app to show the guest version of the confirmation.
    return respond(201, {"report": report, "tracking": "none" if who.is_guest else "account"})


def claim(event):
    """Move a guest's reports (and any flags on them) into the caller's new account."""
    who = caller(event, "Citizen")
    guest_id = verify_guest_token(str(body(event).get("guest_token", "")))
    if not guest_id:
        raise ApiError(403, "INVALID_GUEST_TOKEN", "That guest session is not valid.")
    guest = table("guests").get_item(Key={"guest_id": guest_id}).get("Item")
    if not guest:
        return respond(200, {"moved_reports": 0, "carried_flags": 0})
    try:
        table("guests").update_item(
            Key={"guest_id": guest_id}, UpdateExpression="SET claimed_by = :me, claimed_at = :now",
            ConditionExpression="attribute_not_exists(claimed_by) OR claimed_by = :me",
            ExpressionAttributeValues={":me": who.id, ":now": now()})
    except ClientError as exc:
        if conditional_failed(exc):
            raise ApiError(409, "ALREADY_CLAIMED", "These reports have already been moved to an account.")
        raise

    old_owner = GUEST_PREFIX + guest_id
    citizen = table("citizens").get_item(Key={"citizen_id": who.id}).get("Item")
    if not citizen:
        raise ApiError(403, "PROFILE_MISSING", "Your profile is not set up yet. Please sign out and back in.")
    username = citizen.get("username") or who.username
    moved = 0
    for report in query_all(table("reports"), IndexName="GSI-citizen", KeyConditionExpression=Key("citizen_id").eq(old_owner)):
        try:  # the condition makes a retried or doubled claim harmless
            table("reports").update_item(
                Key={"report_id": report["report_id"]},
                UpdateExpression="SET citizen_id = :me, username = :u, reporter_type = :c, claimed_from = :g, search_text = :s",
                ConditionExpression="citizen_id = :old",
                ExpressionAttributeValues={":me": who.id, ":u": username, ":c": "citizen", ":g": guest_id, ":old": old_owner,
                                           ":s": search_text({**report, "username": username})})
            moved += 1
        except ClientError as exc:
            if not conditional_failed(exc):
                raise
    # Flags follow the reports, so registering never wipes a guest's record.
    flags = query_all(table("flags"), IndexName="GSI-citizen", KeyConditionExpression=Key("citizen_id").eq(old_owner))
    for flag in flags:
        table("flags").update_item(Key={"flag_id": flag["flag_id"]}, UpdateExpression="SET citizen_id = :me",
                                   ExpressionAttributeValues={":me": who.id})
    table("citizens").update_item(
        Key={"citizen_id": who.id}, UpdateExpression="ADD report_count :r, flag_count :f",
        ExpressionAttributeValues={":r": moved, ":f": len(flags)})
    return respond(200, {"moved_reports": moved, "carried_flags": len(flags)})


@api
def handler(event, context):
    if event.get("resource") == "/me/claim-guest-reports":
        return claim(event)
    return submit(event)
