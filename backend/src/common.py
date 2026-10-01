"""Shared helpers imported by every CLEAN-AM Lambda function."""
import base64
import functools
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key  # noqa: F401  (re-exported)
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

PENDING, IN_PROGRESS, DONE = "PENDING", "IN_PROGRESS", "DONE"
STATUSES = (PENDING, IN_PROGRESS, DONE)
# Reopening DONE -> IN_PROGRESS corrects a premature "collected".
TRANSITIONS = {PENDING: {IN_PROGRESS, DONE}, IN_PROGRESS: {DONE}, DONE: {IN_PROGRESS}}
FLAG_THRESHOLD = int(os.environ.get("FLAG_THRESHOLD", "5"))
GUEST_PREFIX = "guest#"


# --- AWS clients: created once per container, reused across invocations ----
@functools.cache
def client(service: str):
    if service == "s3":  # presigned URLs that browsers PUT to need SigV4
        return boto3.client("s3", config=Config(signature_version="s3v4"))
    return boto3.client(service)


@functools.cache
def table(name: str):
    """table("reports") -> the table named in the REPORTS_TABLE variable."""
    return boto3.resource("dynamodb").Table(os.environ[f"{name.upper()}_TABLE"])


# --- API responses -----------------------------------------------------------
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details


def _default(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(type(value))


def respond(status: int, body) -> dict:
    """The response shape API Gateway expects from a Lambda proxy integration."""
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, default=_default),
    }


def api(handler):
    """Turn ApiError into its HTTP response and hide anything unexpected."""
    @functools.wraps(handler)
    def wrapper(event, context):
        try:
            return handler(event, context)
        except ApiError as exc:
            error = {"code": exc.code, "message": exc.message}
            if exc.details:
                error["details"] = exc.details
            return respond(exc.status, {"error": error})
        except Exception:
            logger.exception("unhandled error")
            return respond(500, {"error": {"code": "INTERNAL_ERROR",
                                           "message": "Something went wrong. Please try again."}})
    return wrapper


def body(event) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        data = json.loads(raw)
    except ValueError:
        raise ApiError(400, "BAD_JSON", "Request body must be valid JSON.")
    if not isinstance(data, dict):
        raise ApiError(400, "BAD_JSON", "Request body must be a JSON object.")
    return data


def query(event) -> dict:
    return event.get("queryStringParameters") or {}


def path_param(event, name: str) -> str:
    return (event.get("pathParameters") or {}).get(name) or ""


def plain(value):
    """DynamoDB items contain Decimals; turn them into plain JSON types."""
    return json.loads(json.dumps(value, default=_default))


# --- Who is calling ----------------------------------------------------------
class Caller:
    """The signed-in user (from the Cognito authorizer) or a guest (from ours)."""

    def __init__(self, event):
        authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
        claims = authorizer.get("claims") or {}
        self.guest_id = "" if claims else authorizer.get("guest_id", "")
        self.cognito_username = ""
        if self.guest_id:
            self.id = GUEST_PREFIX + self.guest_id
            self.username = guest_label(self.guest_id)
            self.groups = ["Guest"]
        else:
            self.id = claims.get("sub", "")
            self.cognito_username = claims.get("cognito:username", "")
            # Never the phone number: usernames are shown to crews.
            self.username = (claims.get("custom:username") or claims.get("preferred_username") or claims.get("name")
                             or claims.get("email", "").split("@")[0] or claims.get("cognito:username", ""))
            raw = claims.get("cognito:groups", "")
            # REST APIs pass the groups as "[Admin Employee]" rather than a list
            self.groups = raw if isinstance(raw, list) else raw.strip("[]").replace(",", " ").split()
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        self.lang = "fr" if (headers.get("accept-language") or "").lower().startswith("fr") else "en"

    @property
    def role(self) -> str:
        return next((r for r in ("Admin", "Employee", "Citizen", "Guest") if r in self.groups), "")

    @property
    def is_guest(self) -> bool:
        return bool(self.guest_id)

    @property
    def is_staff(self) -> bool:
        return self.role in ("Admin", "Employee")

    def allowed(self, *roles: str) -> bool:
        # An Admin can do anything an Employee can.
        return self.role in roles or (self.role == "Admin" and "Employee" in roles)


def caller(event, *roles: str) -> Caller:
    who = Caller(event)
    if not who.id:
        raise ApiError(401, "UNAUTHORIZED", "Please sign in.")
    if roles and not who.allowed(*roles):
        raise ApiError(403, "FORBIDDEN", "You do not have permission to do this.")
    return who


def guest_label(guest_id: str) -> str:
    """What crews see for a guest, e.g. "Guest-7F3A"."""
    return "Guest-" + guest_id.replace("-", "")[-4:].upper()


# --- Signed guest tokens: base64url(payload).base64url(HMAC-SHA256) ----------
GUEST_TOKEN_LIFETIME = 365 * 24 * 3600


@functools.cache
def _guest_key() -> bytes:
    arn = os.environ["GUEST_TOKEN_SECRET_ARN"]
    return client("secretsmanager").get_secret_value(SecretId=arn)["SecretString"].encode()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _sign(payload: str) -> str:
    return _b64(hmac.new(_guest_key(), payload.encode(), hashlib.sha256).digest())


def issue_guest_token() -> tuple[str, str, int]:
    guest_id, expires = str(uuid.uuid4()), int(time.time()) + GUEST_TOKEN_LIFETIME
    payload = _b64(json.dumps({"gid": guest_id, "exp": expires, "v": 1}).encode())
    return f"{payload}.{_sign(payload)}", guest_id, expires


def verify_guest_token(token: str) -> str | None:
    """The guest ID inside a genuine, unexpired token; otherwise None."""
    try:
        payload, signature = token.split(".")
        if not hmac.compare_digest(signature, _sign(payload)):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data.get("v") != 1 or data["exp"] < time.time():
            return None
        return str(uuid.UUID(data["gid"]))
    except (ValueError, KeyError, TypeError):
        return None


# --- Input checks ------------------------------------------------------------
def text(value, field: str, max_len: int = 200, required: bool = True) -> str:
    value = str(value or "").strip()
    if not value:
        if required:
            raise ApiError(400, "MISSING_FIELD", f"'{field}' is required.", {"field": field})
        return ""
    if len(value) > max_len or any(ord(ch) < 32 and ch not in "\n\t" for ch in value):
        raise ApiError(400, "INVALID_FIELD", f"'{field}' is too long or contains invalid characters.",
                       {"field": field})
    return value


def status_value(value) -> str:
    status = str(value or "").strip().upper()
    if status not in STATUSES:
        raise ApiError(400, "INVALID_STATUS", f"Status must be one of {', '.join(STATUSES)}.")
    return status


def page_size(params: dict, default: int = 25) -> int:
    try:
        return max(1, min(100, int(params.get("limit") or default)))
    except ValueError:
        raise ApiError(400, "INVALID_LIMIT", "'limit' must be a number.")


def encode_cursor(last_key: dict | None) -> str | None:
    return _b64(json.dumps(plain(last_key)).encode()) if last_key else None


def decode_cursor(cursor: str | None) -> dict | None:
    if not cursor:
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
    except ValueError:
        raise ApiError(400, "BAD_CURSOR", "Invalid pagination cursor.")


# --- Small shared utilities --------------------------------------------------
def now() -> str:
    """UTC ISO-8601 timestamp; sorts correctly as a string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def is_true(value) -> bool:
    return str(value).lower() == "true"


def photo_url(key: str | None, expires: int = 3600) -> str | None:
    """Photos are private; each view gets a short-lived presigned GET."""
    if not key:
        return None
    return client("s3").generate_presigned_url(
        "get_object", Params={"Bucket": os.environ["PHOTO_BUCKET"], "Key": key}, ExpiresIn=expires)


def search_text(report: dict) -> str:
    """Lower-cased words staff can search by (DynamoDB's contains() is case-sensitive)."""
    parts = (report.get("report_id"), report.get("username"), report.get("quarter"), report.get("city"),
             report.get("description"))
    return " ".join(str(p) for p in parts if p).lower()


def with_photo(report: dict) -> dict:
    report = plain(report)
    report["photo_url"] = photo_url(report.pop("image_s3_key", None))
    for internal in ("guest_id", "record_type", "search_text"):
        report.pop(internal, None)
    return report


def notify(event_type: str, payload: dict) -> None:
    """Queue an email. Never fails the request that triggered it."""
    try:
        client("sqs").send_message(QueueUrl=os.environ["NOTIFICATION_QUEUE_URL"],
                                   MessageBody=json.dumps({"type": event_type, **plain(payload)}))
    except (ClientError, KeyError):
        logger.exception("could not queue %s", event_type)


def conditional_failed(exc: ClientError) -> bool:
    return exc.response["Error"]["Code"] == "ConditionalCheckFailedException"


def query_all(tbl, **kwargs) -> list[dict]:
    """Every item a query matches, following DynamoDB's pagination."""
    items = []
    while True:
        page = tbl.query(**kwargs)
        items += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


# --- Messages the app shows verbatim, in English and French -------------------
MESSAGES = {
    "photo_required": ("A photo is required to submit a report.",
                       "Une photo est requise pour soumettre un signalement."),
    "location_required": ("A location is required to submit a report.",
                          "Une localisation est requise pour soumettre un signalement."),
    "quarter_required": ("Please confirm the quarter for this report.",
                         "Veuillez confirmer le quartier de ce signalement."),
    "outside_cameroon": ("The location must be within Cameroon.",
                         "La localisation doit se trouver au Cameroun."),
    "photo_missing": ("The uploaded photo could not be found. Please upload it again.",
                      "La photo téléversée est introuvable. Veuillez la téléverser à nouveau."),
    "duplicate": ("You already have an open report at this location.",
                  "Vous avez déjà un signalement ouvert à cet endroit."),
    "not_found": ("That report could not be found.", "Ce signalement est introuvable."),
    "suspended": ("Your account has been suspended for repeated false reports.",
                  "Votre compte a été suspendu pour signalements frauduleux répétés."),
    "guest_blocked": ("Reports from this device can no longer be accepted.",
                      "Les signalements depuis cet appareil ne sont plus acceptés."),
    "rate_limited": ("You have submitted several reports recently. Please wait a few minutes.",
                     "Vous avez soumis plusieurs signalements récemment. Veuillez patienter."),
    "guest_rate_limited": ("You have sent several reports from this device recently. "
                           "Create a free account to report more often.",
                           "Vous avez envoyé plusieurs signalements depuis cet appareil. "
                           "Créez un compte gratuit pour signaler plus souvent."),
}


def msg(key: str, lang: str) -> str:
    english, french = MESSAGES[key]
    return french if lang == "fr" else english


# --- Reporting rules shared by presign-upload and report-submit ---------------
def reporter(event) -> Caller:
    """A guest on the /guest/* routes, otherwise a signed-in, unsuspended Citizen."""
    who = caller(event)
    if not (who.is_guest or who.allowed("Citizen")):
        raise ApiError(403, "FORBIDDEN", "Only citizens and guests can submit reports.")
    if who.is_guest:
        guest = table("guests").get_item(Key={"guest_id": who.guest_id}).get("Item") or {}
        if is_true(guest.get("is_blocked")):
            raise ApiError(403, "GUEST_BLOCKED", msg("guest_blocked", who.lang))
    else:
        citizen = table("citizens").get_item(Key={"citizen_id": who.id}).get("Item") or {}
        if is_true(citizen.get("is_suspended")):
            raise ApiError(403, "ACCOUNT_SUSPENDED", msg("suspended", who.lang))
    return who


def staging_prefix(who: Caller) -> str:
    """Each reporter uploads into their own folder; submit only accepts keys from it."""
    return f"staging/{who.id.replace('#', '_')}/"
