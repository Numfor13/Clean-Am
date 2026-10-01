"""POST /uploads/presign and /guest/uploads/presign: a 5-minute link to PUT one photo in S3."""
import os
import uuid

from common import ApiError, api, body, client, reporter, respond, staging_prefix

IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}
MAX_BYTES = 10 * 1024 * 1024
EXPIRES = 300


@api
def handler(event, context):
    who = reporter(event)
    data = body(event)
    content_type = str(data.get("content_type", "")).lower()
    if content_type not in IMAGE_TYPES:
        raise ApiError(400, "UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG, PNG, WebP or HEIC photo.")
    try:
        size = int(data.get("file_size"))
    except (TypeError, ValueError):
        raise ApiError(400, "INVALID_SIZE", "A valid file size is required.")
    if not 1024 <= size <= MAX_BYTES:
        raise ApiError(400, "FILE_TOO_LARGE", "Photos must be between 1 KB and 10 MB.")

    key = f"{staging_prefix(who)}{uuid.uuid4()}{IMAGE_TYPES[content_type]}"
    # ContentType and ContentLength are signed, so S3 rejects any other file.
    url = client("s3").generate_presigned_url(
        "put_object",
        Params={"Bucket": os.environ["PHOTO_BUCKET"], "Key": key, "ContentType": content_type,
                "ContentLength": size, "ServerSideEncryption": "AES256"},
        ExpiresIn=EXPIRES,
    )
    return respond(200, {
        "upload_url": url,
        "s3_key": key,
        "expires_in": EXPIRES,
        "required_headers": {"Content-Type": content_type, "x-amz-server-side-encryption": "AES256"},
    })
