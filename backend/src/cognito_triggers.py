"""
One function for all four Cognito triggers; Cognito says which in event["triggerSource"].

  PreSignUp_*         only +237 phone numbers, a valid username, optional email
  CustomMessage_*     SMS codes and emails in the user's language (EN/FR)
  PostConfirmation_*  a confirmed sign-up joins the Citizen group and gets a citizens row
  TokenGeneration_*   adds suspension and username claims; keeps contact details in sync
"""
import os
import re

from botocore.exceptions import ClientError

from common import client, conditional_failed, logger, now, table

PHONE = re.compile(r"^\+237[26]\d{8}$")
USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# French SMS avoids accents so each message stays one GSM-7 SMS (160 characters).
SMS = {
    "verify": ("CLEAN-AM: your verification code is {code}. Do not share it.",
               "CLEAN-AM : votre code de verification est {code}. Ne le partagez pas."),
    "reset": ("CLEAN-AM: your password reset code is {code}. If you did not ask for it, ignore this.",
              "CLEAN-AM : votre code de reinitialisation est {code}. Sinon, ignorez ce message."),
    "signin": ("CLEAN-AM: your sign-in code is {code}. Do not share it.",
               "CLEAN-AM : votre code de connexion est {code}. Ne le partagez pas."),
}
EMAIL_TEXT = {
    "verify": (("Confirm your email for CLEAN-AM", "Your confirmation code is <b>{code}</b>."),
               ("Confirmez votre e-mail pour CLEAN-AM", "Votre code de confirmation est <b>{code}</b>.")),
    "reset": (("Reset your CLEAN-AM password", "Your password reset code is <b>{code}</b>."),
              ("Réinitialisez votre mot de passe CLEAN-AM", "Votre code de réinitialisation est <b>{code}</b>.")),
    # Staff invitations: Cognito requires both {username} and the {####} password placeholder.
    "invite": ((
        "Welcome to CLEAN-AM - Staff Account Access",
        """<div style="font-family: Arial, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h2 style="color: #1e40af; margin-top: 0; font-size: 20px;">Welcome to the CLEAN-AM Staff Portal</h2>
  <p>An administrator has created an official CLEAN-AM staff account for you.</p>

  <h3 style="color: #374151; font-size: 16px; margin-bottom: 8px;">Instructions to activate your account:</h3>
  <ol style="padding-left: 20px; margin-top: 0;">
    <li style="margin-bottom: 8px;"><strong>Open the Staff Portal:</strong> Click the button below, or visit <a href="{url}/staff/login" style="color: #2563eb; text-decoration: underline;">{url}/staff/login</a>.</li>
    <li style="margin-bottom: 8px;"><strong>Enter your Email:</strong> <code>{email}</code></li>
    <li style="margin-bottom: 8px;"><strong>Enter your Temporary Password:</strong><br>
      <span style="display: inline-block; background-color: #f3f4f6; border: 1px solid #d1d5db; padding: 6px 12px; font-family: monospace; font-size: 16px; font-weight: bold; color: #111827; border-radius: 4px; margin-top: 4px;">{code}</span>
    </li>
    <li style="margin-bottom: 8px;"><strong>Set your Permanent Password:</strong> Upon signing in, the system will immediately prompt you to choose your own secure password.</li>
  </ol>

  <div style="margin: 25px 0 20px 0; text-align: center;">
    <a href="{url}/staff/login" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Access Staff Portal</a>
  </div>

  <div style="font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 14px; margin-top: 20px;">
    <p style="margin: 4px 0;"><strong>Important:</strong> This temporary password expires in 7 days. Do not share your login credentials with anyone.</p>
    <p style="margin: 4px 0;">Account reference: {username}</p>
  </div>
</div>"""
    ), (
        "Bienvenue sur CLEAN-AM - Accès Compte Personnel",
        """<div style="font-family: Arial, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h2 style="color: #1e40af; margin-top: 0; font-size: 20px;">Bienvenue sur le portail du personnel CLEAN-AM</h2>
  <p>Un administrateur a créé votre compte officiel de personnel CLEAN-AM.</p>

  <h3 style="color: #374151; font-size: 16px; margin-bottom: 8px;">Instructions pour activer votre compte :</h3>
  <ol style="padding-left: 20px; margin-top: 0;">
    <li style="margin-bottom: 8px;"><strong>Ouvrez le portail du personnel :</strong> Cliquez sur le bouton ci-dessous, ou rendez-vous sur <a href="{url}/staff/login" style="color: #2563eb; text-decoration: underline;">{url}/staff/login</a>.</li>
    <li style="margin-bottom: 8px;"><strong>Entrez votre adresse e-mail :</strong> <code>{email}</code></li>
    <li style="margin-bottom: 8px;"><strong>Entrez votre mot de passe temporaire :</strong><br>
      <span style="display: inline-block; background-color: #f3f4f6; border: 1px solid #d1d5db; padding: 6px 12px; font-family: monospace; font-size: 16px; font-weight: bold; color: #111827; border-radius: 4px; margin-top: 4px;">{code}</span>
    </li>
    <li style="margin-bottom: 8px;"><strong>Définissez votre mot de passe permanent :</strong> Dès votre connexion, le système vous demandera de choisir un mot de passe sécurisé et définitif.</li>
  </ol>

  <div style="margin: 25px 0 20px 0; text-align: center;">
    <a href="{url}/staff/login" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Accéder au portail du personnel</a>
  </div>

  <div style="font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 14px; margin-top: 20px;">
    <p style="margin: 4px 0;"><strong>Important :</strong> Ce mot de passe temporaire expire dans 7 jours. Ne partagez jamais vos identifiants.</p>
    <p style="margin: 4px 0;">Référence du compte : {username}</p>
  </div>
</div>"""
    )),
}
MESSAGE_KIND = {
    "CustomMessage_SignUp": "verify", "CustomMessage_ResendCode": "verify",
    "CustomMessage_UpdateUserAttribute": "verify", "CustomMessage_VerifyUserAttribute": "verify",
    "CustomMessage_ForgotPassword": "reset", "CustomMessage_Authentication": "signin",
    "CustomMessage_AdminCreateUser": "invite",
}


def from_google(attrs) -> bool:
    """Signed in with Google (the "identities" attribute lists the provider)."""
    return '"providerName":"Google"' in attrs.get("identities", "").replace(" ", "")


def email_verified(attrs) -> bool:
    # Google only lets someone sign in to an account whose email it has
    # checked, so that address counts as verified for status emails.
    return attrs.get("email_verified") == "true" or (from_google(attrs) and bool(attrs.get("email")))


def pre_sign_up(event, attrs):
    if event["triggerSource"] != "PreSignUp_SignUp":  # staff (AdminCreateUser) and Google are not checked here
        return
    if not PHONE.match(attrs.get("phone_number", "")):
        raise Exception("INVALID_PHONE: Use a Cameroonian number in the form +2376XXXXXXXX.")
    username = attrs.get("preferred_username", "")
    # "Guest-..." is how crews see reports from people without an account.
    if not USERNAME.match(username) or username.lower().startswith(("guest-", "guest_")):
        raise Exception("INVALID_USERNAME: 2 to 30 letters, numbers, dots, dashes or underscores.")
    if attrs.get("email") and not EMAIL.match(attrs["email"]):
        raise Exception("INVALID_EMAIL: That email address is not valid.")
    if attrs.get("custom:language", "en") not in ("en", "fr"):
        raise Exception("INVALID_LANGUAGE: Language must be en or fr.")


def custom_message(event, attrs):
    kind = MESSAGE_KIND.get(event["triggerSource"])
    if not kind:
        return
    french = attrs.get("custom:language") == "fr"
    request, response = event["request"], event["response"]
    code = request.get("codeParameter", "{####}")
    if kind == "invite":
        subject, message = EMAIL_TEXT["invite"][french]
        response["emailSubject"] = subject
        response["emailMessage"] = message.format(url=os.environ["FRONTEND_URL"].rstrip("/"), email=attrs.get("email", ""),
                                                  code=code, username=request.get("usernameParameter", "{username}"))
        return
    response["smsMessage"] = SMS[kind][french].format(code=code)
    subject, message = EMAIL_TEXT["reset" if kind == "reset" else "verify"][french]
    response["emailSubject"], response["emailMessage"] = subject, message.format(code=code)


def post_confirmation(event, attrs):
    if event["triggerSource"] != "PostConfirmation_ConfirmSignUp":
        return
    email = attrs.get("email", "").lower()
    username = attrs.get("preferred_username") or attrs.get("name") or email.split("@")[0] or "citizen"
    item = {"citizen_id": attrs["sub"], "cognito_username": event["userName"], "username": username[:30],
            "language": attrs.get("custom:language", "en"), "flag_count": 0, "is_suspended": "false",
            "report_count": 0, "created_at": now()}
    # Absent rather than "": DynamoDB index keys cannot be empty strings.
    if attrs.get("phone_number"):
        item.update(phone_number=attrs["phone_number"], phone_verified=True)
    if email:
        item.update(email=email, email_verified=email_verified(attrs))
    try:
        table("citizens").put_item(Item=item, ConditionExpression="attribute_not_exists(citizen_id)")
    except ClientError as exc:
        if not conditional_failed(exc):
            raise
    # Self sign-up only ever makes citizens; staff are created by an admin.
    client("cognito-idp").admin_add_user_to_group(
        UserPoolId=event["userPoolId"], Username=event["userName"], GroupName="Citizen")


def token_generation(event, attrs):
    groups = event["request"].get("groupConfiguration", {}).get("groupsToOverride", [])
    overrides = {}
    if not groups and "identities" in attrs:
        # A Google user's very first token is issued before the group added in
        # PostConfirmation shows up, so put them in the Citizen group here too.
        groups = ["Citizen"]
        overrides["groupOverrideDetails"] = {"groupsToOverride": groups}
    if "Admin" in groups:  # the first admin is created by the deployment; record them once
        try:
            table("admins").put_item(
                Item={"admin_id": attrs["sub"], "email": attrs.get("email", ""), "name": attrs.get("name", ""),
                      "created_at": now()},
                ConditionExpression="attribute_not_exists(admin_id)")
        except ClientError as exc:
            if not conditional_failed(exc):
                logger.exception("could not record admin %s", attrs["sub"])
        return
    if "Citizen" not in groups:
        return

    citizen = table("citizens").get_item(Key={"citizen_id": attrs["sub"]}).get("Item") or {}
    # Copy an email the citizen added or verified since sign-up, so status emails reach it.
    email = attrs.get("email", "").lower()
    verified = email_verified(attrs)
    if citizen and email and (citizen.get("email") != email or citizen.get("email_verified") != verified):
        table("citizens").update_item(Key={"citizen_id": attrs["sub"]},
                                      UpdateExpression="SET email = :e, email_verified = :v",
                                      ExpressionAttributeValues={":e": email, ":v": verified})
    overrides["claimsToAddOrOverride"] = {
        "custom:suspended": citizen.get("is_suspended", "false"),
        "custom:username": citizen.get("username") or attrs.get("preferred_username", ""),
    }
    event["response"]["claimsOverrideDetails"] = overrides


def handler(event, context):
    attrs = event["request"].get("userAttributes", {})
    source = event["triggerSource"]
    if source.startswith("PreSignUp_"):
        pre_sign_up(event, attrs)
    elif source.startswith("CustomMessage_"):
        custom_message(event, attrs)
    elif source.startswith("PostConfirmation_"):
        post_confirmation(event, attrs)
    elif source.startswith("TokenGeneration_"):
        token_generation(event, attrs)
    return event
