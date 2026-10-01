"""
Reads the notification queue and sends emails with SES, in the citizen's language.

Returns batchItemFailures so SQS retries only the messages that failed; after
3 failures a message moves to the dead-letter queue (which has an alarm).
"""
import json
import os

from botocore.exceptions import ClientError

from common import client, logger

STATUS = {"PENDING": ("Pending", "En attente"), "IN_PROGRESS": ("In Progress", "En cours"), "DONE": ("Done", "Terminé")}
NOTE = {
    "IN_PROGRESS": ("A collection team has been assigned and will visit the location shortly.",
                    "Une équipe de collecte a été assignée et se rendra sur place prochainement."),
    "DONE": ("The waste has been collected and your report is now closed.",
             "Les déchets ont été collectés et votre signalement est clôturé."),
    "PENDING": ("Your report is queued for review.", "Votre signalement est en attente d'examen."),
}
EMAILS = {
    "REPORT_STATUS_CHANGED": (
        ("Your waste report is now {label}",
         "Hello {username},\n\nYour report for {quarter} is now: {label}.\n\n{note}\n\n"
         "Follow it here: {url}/my-reports\n\nThank you for helping keep your neighbourhood clean.\n\nCLEAN-AM"),
        ("Votre signalement est maintenant : {label}",
         "Bonjour {username},\n\nVotre signalement pour {quarter} est maintenant : {label}.\n\n{note}\n\n"
         "Suivez-le ici : {url}/my-reports\n\nMerci de contribuer à la propreté de votre quartier.\n\nCLEAN-AM"),
    ),
    "CITIZEN_SUSPENDED": (
        ("Your CLEAN-AM account has been suspended",
         "Hello {username},\n\nYour CLEAN-AM account has been suspended after {flag_count} of your reports were "
         "found to be false.\n\nIf you believe this is a mistake, contact your municipal office.\n\nCLEAN-AM"),
        ("Votre compte CLEAN-AM a été suspendu",
         "Bonjour {username},\n\nVotre compte CLEAN-AM a été suspendu après que {flag_count} de vos signalements "
         "ont été jugés faux.\n\nSi vous pensez qu'il s'agit d'une erreur, contactez votre service municipal.\n\nCLEAN-AM"),
    ),
}


def send(message: dict) -> None:
    french = message.get("language") == "fr"
    subject, text = EMAILS[message["type"]][1 if french else 0]
    status = message.get("status", "PENDING")
    fields = {**message, "label": STATUS[status][french], "note": NOTE[status][french],
              "url": os.environ["FRONTEND_URL"].rstrip("/")}
    client("ses").send_email(
        Source=os.environ["SES_SENDER_EMAIL"],
        Destination={"ToAddresses": [message["email"]]},
        Message={"Subject": {"Data": subject.format(**fields), "Charset": "UTF-8"},
                 "Body": {"Text": {"Data": text.format(**fields), "Charset": "UTF-8"}}},
    )


def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            send(json.loads(record["body"]))
        except (KeyError, ValueError):
            logger.exception("dropping malformed message %s", record["messageId"])
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "MessageRejected":  # retrying will not help
                logger.error("SES rejected %s: %s", record["messageId"], exc)
            else:
                failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
