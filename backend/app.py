#!/usr/bin/env python3
"""CDK entry point: `cdk deploy --all` builds the CLEAN-AM backend as two stacks."""
import os

import aws_cdk as cdk

from stacks.api_stack import ApiStack
from stacks.data_stack import DataStack

app = cdk.App()
context = app.node.try_get_context
config = {
    "stage": context("stage") or "dev",
    "frontend_url": (context("frontendUrl") or "http://localhost:3000").rstrip("/"),  # also the S3 CORS origin
    "seed_admin_email": (context("seedAdminEmail") or "admin@clean-am.cm").strip().lower(),
    "seed_admin_email_given": bool(context("seedAdminEmail")),
    "seed_admin_name": context("seedAdminName") or "Platform Administrator",
    "ses_sender_email": context("sesSenderEmail") or "no-reply@clean-am.cm",
}
env = cdk.Environment(account=os.getenv("CDK_DEFAULT_ACCOUNT"), region=os.getenv("CDK_DEFAULT_REGION", "eu-west-1"))
prefix = f"CleanAm-{config['stage'].capitalize()}"

data = DataStack(app, f"{prefix}-Data", config=config, env=env)
ApiStack(app, f"{prefix}-Api", config=config, data=data, env=env)
cdk.Tags.of(app).add("Project", "CLEAN-AM")
cdk.Tags.of(app).add("Stage", config["stage"])
app.synth()
