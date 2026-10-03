"""
Stateless resources: the REST API, the functions behind it and the email queue.

One function per box in the architecture diagram, each with only the
permissions it needs (SRS NFR-MAINT-01).
"""
import os

import aws_cdk as cdk
from aws_cdk import (Duration, RemovalPolicy, Stack, aws_apigateway as apigw, aws_cloudwatch as cloudwatch,
                     aws_iam as iam, aws_lambda as lambda_, aws_lambda_event_sources as sources, aws_logs as logs,
                     aws_sqs as sqs)
from constructs import Construct

SRC = os.path.join(os.path.dirname(__file__), "..", "src")


class ApiStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, config: dict, data, **kwargs):
        super().__init__(scope, construct_id, **kwargs)
        stage, tables, bucket = config["stage"], data.tables, data.photo_bucket
        citizen_pool = data.citizen_user_pool
        employee_pool = data.employee_user_pool
        admin_pool = data.admin_user_pool

        # --- Email queue: requests never wait for SES; failures retry 3 times ------
        dead_letters = sqs.Queue(self, "NotificationDLQ", retention_period=Duration.days(14), enforce_ssl=True)
        queue = sqs.Queue(self, "NotificationQueue", visibility_timeout=Duration.seconds(90), enforce_ssl=True,
                          dead_letter_queue=sqs.DeadLetterQueue(max_receive_count=3, queue=dead_letters))

        env = {
            **{f"{name.upper()}_TABLE": t.table_name for name, t in tables.items()},
            "PHOTO_BUCKET": bucket.bucket_name,
            "NOTIFICATION_QUEUE_URL": queue.queue_url,
            "USER_POOL_ID": citizen_pool.user_pool_id,
            "CITIZEN_USER_POOL_ID": citizen_pool.user_pool_id,
            "EMPLOYEE_USER_POOL_ID": employee_pool.user_pool_id,
            "ADMIN_USER_POOL_ID": admin_pool.user_pool_id,
            "GUEST_TOKEN_SECRET_ARN": data.guest_token_secret.secret_arn,
            "FRONTEND_URL": config["frontend_url"],
        }

        def function(name: str, memory: int = 256, extra_env: dict | None = None) -> lambda_.Function:
            return lambda_.Function(
                self, name.title().replace("_", ""), function_name=f"clean-am-{stage}-{name.replace('_', '-')}",
                runtime=lambda_.Runtime.PYTHON_3_12, handler=f"{name}.handler", code=lambda_.Code.from_asset(SRC, exclude=["__pycache__"]),
                memory_size=memory, timeout=Duration.seconds(15), tracing=lambda_.Tracing.ACTIVE,
                environment={**env, **(extra_env or {})},
                log_group=logs.LogGroup(self, f"{name.title().replace('_', '')}Logs",
                                        retention=logs.RetentionDays.ONE_MONTH, removal_policy=RemovalPolicy.DESTROY))

        presign = function("presign_upload")
        bucket.grant_put(presign)
        tables["citizens"].grant_read_data(presign)
        tables["guests"].grant_read_data(presign)

        submit = function("report_submit", memory=512)
        for name in ("reports", "citizens", "guests", "flags"):
            tables[name].grant_read_write_data(submit)
        bucket.grant_read_write(submit)
        data.guest_token_secret.grant_read(submit)  # to check the token on a guest claim

        report_list = function("report_list", memory=512)
        tables["reports"].grant_read_data(report_list)
        bucket.grant_read(report_list)

        detail = function("report_detail")
        for name in ("reports", "citizens", "guests", "flags"):
            tables[name].grant_read_data(detail)
        bucket.grant_read(detail)

        status = function("report_status_update")
        tables["reports"].grant_read_write_data(status)
        tables["citizens"].grant_read_data(status)
        bucket.grant_read(status)
        queue.grant_send_messages(status)

        flag = function("flag_citizen")
        for name in ("reports", "citizens", "guests", "flags"):
            tables[name].grant_read_write_data(flag)
        queue.grant_send_messages(flag)

        employee_admin = function("employee_admin")
        tables["employees"].grant_read_write_data(employee_admin)

        public = function("public_info")
        tables["reports"].grant_read_data(public)
        for name in ("citizens", "employees", "admins"):
            tables[name].grant_read_write_data(public)
        data.guest_token_secret.grant_read(public)

        authorizer_fn = function("guest_authorizer", memory=128)
        data.guest_token_secret.grant_read(authorizer_fn)

        # Specific IAM permissions for each pool
        employee_admin.add_to_role_policy(iam.PolicyStatement(
            actions=["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup",
                     "cognito-idp:AdminDeleteUser", "cognito-idp:AdminDisableUser"],
            resources=[employee_pool.user_pool_arn]))

        flag.add_to_role_policy(iam.PolicyStatement(
            actions=["cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser"],
            resources=[citizen_pool.user_pool_arn]))

        public.add_to_role_policy(iam.PolicyStatement(
            actions=["cognito-idp:AdminUpdateUserAttributes"],
            resources=[citizen_pool.user_pool_arn, employee_pool.user_pool_arn, admin_pool.user_pool_arn]))

        sender = function("notification_sender", extra_env={"SES_SENDER_EMAIL": config["ses_sender_email"]})
        sender.add_event_source(sources.SqsEventSource(queue, batch_size=10, report_batch_item_failures=True,
                                                       max_concurrency=2))  # stays under the SES send rate
        sender.add_to_role_policy(iam.PolicyStatement(
            actions=["ses:SendEmail"], resources=["*"],
            conditions={"StringEquals": {"ses:FromAddress": config["ses_sender_email"]}}))

        # --- REST API --------------------------------------------------------------
        # Only the Next.js server calls this API (it holds the tokens), so no CORS is configured.
        api = apigw.RestApi(
            self, "Api", rest_api_name=f"clean-am-{stage}-api", cloud_watch_role=True,
            deploy_options=apigw.StageOptions(
                stage_name=stage, tracing_enabled=True, metrics_enabled=True,
                logging_level=apigw.MethodLoggingLevel.ERROR,
                throttling_rate_limit=100, throttling_burst_limit=200,
                # Anyone can become a guest, so guest routes get much lower ceilings.
                method_options={
                    "/guest/session/POST": apigw.MethodDeploymentOptions(throttling_rate_limit=2, throttling_burst_limit=5),
                    "/guest/uploads/presign/POST": apigw.MethodDeploymentOptions(throttling_rate_limit=5, throttling_burst_limit=10),
                    "/guest/reports/POST": apigw.MethodDeploymentOptions(throttling_rate_limit=5, throttling_burst_limit=10),
                }))

        signed_in = {"authorization_type": apigw.AuthorizationType.COGNITO,
                     "authorizer": apigw.CognitoUserPoolsAuthorizer(
                         self, "CognitoAuthorizer",
                         cognito_user_pools=[admin_pool, employee_pool, citizen_pool])}
        guest = {"authorization_type": apigw.AuthorizationType.CUSTOM,
                 "authorizer": apigw.TokenAuthorizer(
                     self, "GuestTokenAuthorizer", handler=authorizer_fn,
                     validation_regex=r"^Guest [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$",
                     results_cache_ttl=Duration.minutes(5))}
        anyone = {"authorization_type": apigw.AuthorizationType.NONE}

        routes = [
            ("GET", "public/stats", public, anyone),
            ("POST", "guest/session", public, anyone),
            ("POST", "guest/uploads/presign", presign, guest),
            ("POST", "guest/reports", submit, guest),
            ("POST", "uploads/presign", presign, signed_in),
            ("POST", "reports", submit, signed_in),
            ("GET", "reports", report_list, signed_in),
            ("GET", "reports/me", report_list, signed_in),
            ("GET", "reports/{report_id}", detail, signed_in),
            ("PATCH", "reports/{report_id}/status", status, signed_in),
            ("POST", "reports/{report_id}/flag", flag, signed_in),
            ("GET", "me", public, signed_in),
            ("PATCH", "me", public, signed_in),
            ("POST", "me/claim-guest-reports", submit, signed_in),
            ("POST", "employees", employee_admin, signed_in),
            ("GET", "employees", employee_admin, signed_in),
            ("GET", "employees/{employee_id}", employee_admin, signed_in),
            ("DELETE", "employees/{employee_id}", employee_admin, signed_in),
            ("GET", "citizens/flagged", flag, signed_in),
            ("GET", "citizens/{citizen_id}", flag, signed_in),
            ("POST", "citizens/{citizen_id}/suspend", flag, signed_in),
            ("POST", "citizens/{citizen_id}/reinstate", flag, signed_in),
        ]
        for method, path, fn, auth in routes:
            api.root.resource_for_path(path).add_method(method, apigw.LambdaIntegration(fn), **auth)

        # --- Alarms (NFR-REL-01, NFR-PERF-01) ------------------------------------------
        cloudwatch.Alarm(self, "Api5xx", metric=api.metric_server_error(period=Duration.minutes(5)),
                         threshold=10, evaluation_periods=2, treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING)
        cloudwatch.Alarm(self, "ApiLatencyP95", metric=api.metric_latency(period=Duration.minutes(5), statistic="p95"),
                         threshold=2000, evaluation_periods=3, treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING)
        cloudwatch.Alarm(self, "EmailsFailing", metric=dead_letters.metric_approximate_number_of_messages_visible(),
                         threshold=1, evaluation_periods=1, treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING)

        cdk.CfnOutput(self, "ApiUrl", value=api.url)
