"""
API Gateway TOKEN authorizer for the /guest/* routes.

Checks the signature on "Authorization: Guest <token>" and passes the guest's
ID to the handler. Raising exactly "Unauthorized" makes API Gateway answer 401.
"""
from common import verify_guest_token


def handler(event, context):
    scheme, _, token = (event.get("authorizationToken") or "").partition(" ")
    guest_id = verify_guest_token(token) if scheme == "Guest" else None
    if not guest_id:
        raise Exception("Unauthorized")
    # arn:aws:execute-api:region:account:api-id/stage/METHOD/path -> every guest route,
    # so the cached decision also covers the guest's next call.
    api_arn, stage = event["methodArn"].split("/")[:2]
    return {
        "principalId": f"guest:{guest_id}",
        "policyDocument": {"Version": "2012-10-17", "Statement": [{
            "Action": "execute-api:Invoke", "Effect": "Allow", "Resource": f"{api_arn}/{stage}/*/guest/*"}]},
        "context": {"guest_id": guest_id},
    }
