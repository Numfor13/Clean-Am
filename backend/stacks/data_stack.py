"""
Stateful resources: everything that holds data or identities.

Kept apart from the API (AWS CDK best practice), so the stateless stack can be
redeployed or torn down freely without putting data at risk.
"""
import os

import aws_cdk as cdk
from aws_cdk import (Duration, RemovalPolicy, Stack, aws_cognito as cognito, aws_dynamodb as dynamodb,
                     aws_iam as iam, aws_lambda as lambda_, aws_logs as logs, aws_s3 as s3,
                     aws_secretsmanager as secretsmanager, custom_resources as cr)
from constructs import Construct

S, N = dynamodb.AttributeType.STRING, dynamodb.AttributeType.NUMBER
SRC = os.path.join(os.path.dirname(__file__), "..", "src")


class DataStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, config: dict, **kwargs):
        super().__init__(scope, construct_id, **kwargs)
        stage, prod = config["stage"], config["stage"] == "prod"
        removal = RemovalPolicy.RETAIN if prod else RemovalPolicy.DESTROY

        # --- DynamoDB: one table per entity (SRS section 7), billed per request --
        def new_table(name: str, key: str, indexes: dict) -> dynamodb.Table:
            tbl = dynamodb.Table(
                self, f"{name.title()}Table", table_name=f"clean-am-{stage}-{name}",
                partition_key=dynamodb.Attribute(name=key, type=S),
                billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST, removal_policy=removal,
                point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                    point_in_time_recovery_enabled=prod))
            for index, (pk, sk) in indexes.items():
                tbl.add_global_secondary_index(
                    index_name=index, partition_key=dynamodb.Attribute(name=pk, type=S),
                    sort_key=dynamodb.Attribute(name=sk[0], type=sk[1]) if sk else None)
            return tbl

        created = ("created_at", S)
        self.tables = {
            "citizens": new_table("citizens", "citizen_id", {"GSI-suspended": ("is_suspended", ("flag_count", N))}),
            "employees": new_table("employees", "employee_id", {"GSI-email": ("email", None)}),
            "admins": new_table("admins", "admin_id", {}),
            "reports": new_table("reports", "report_id", {
                "GSI-status": ("status", created), "GSI-quarter": ("quarter", created),
                "GSI-citizen": ("citizen_id", created),
                "GSI-created": ("record_type", created)}),  # all reports by date, for the staff list
            "flags": new_table("flags", "flag_id", {
                "GSI-citizen": ("citizen_id", ("flagged_at", S)), "GSI-report": ("report_id", None)}),
            "guests": new_table("guests", "guest_id", {}),
        }

        # --- S3: private report photos, uploaded and viewed through presigned URLs -
        # Uploads are already gated by the 5-minute signed URL; CORS only says which
        # web pages may send them. Outside prod any page may, so testing from a phone
        # at the computer's network address (http://10.x.x.x:3000) works too.
        origins = [config["frontend_url"]] if prod else ["*"]
        self.photo_bucket = s3.Bucket(
            self, "ReportPhotos", block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED, enforce_ssl=True, removal_policy=removal,
            auto_delete_objects=not prod,
            cors=[s3.CorsRule(allowed_methods=[s3.HttpMethods.PUT], allowed_origins=origins, allowed_headers=["*"])],
            lifecycle_rules=[
                s3.LifecycleRule(prefix="staging/", expiration=Duration.days(2)),  # uploads never submitted
                s3.LifecycleRule(prefix="reports/", transitions=[s3.Transition(
                    storage_class=s3.StorageClass.INFREQUENT_ACCESS, transition_after=Duration.days(90))]),
                s3.LifecycleRule(abort_incomplete_multipart_upload_after=Duration.days(1)),
            ])

        # --- Secret that signs guest tokens (only its ARN reaches Lambda) ----------
        self.guest_token_secret = secretsmanager.Secret(
            self, "GuestTokenKey", removal_policy=removal,
            generate_secret_string=secretsmanager.SecretStringGenerator(password_length=64, exclude_punctuation=True))

        # --- Cognito: citizens sign in with phone, staff with email ----------------
        triggers = lambda_.Function(
            self, "CognitoTriggers", runtime=lambda_.Runtime.PYTHON_3_12, handler="cognito_triggers.handler",
            code=lambda_.Code.from_asset(SRC, exclude=["__pycache__"]), timeout=Duration.seconds(10),
            log_group=logs.LogGroup(self, "CognitoTriggersLogs", retention=logs.RetentionDays.ONE_MONTH,
                                    removal_policy=RemovalPolicy.DESTROY),
            environment={"CITIZENS_TABLE": self.tables["citizens"].table_name,
                         "ADMINS_TABLE": self.tables["admins"].table_name, "FRONTEND_URL": config["frontend_url"]})
        self.tables["citizens"].grant_read_write_data(triggers)
        self.tables["admins"].grant_write_data(triggers)

        # --- Cognito: 3 separate pools for Citizens (students), Employees, and Admins
        self.citizen_user_pool = cognito.UserPool(
            self, "UserPool", user_pool_name=f"clean-am-{stage}-citizens", self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(phone=True, email=True), sign_in_case_sensitive=False,
            auto_verify=cognito.AutoVerifiedAttrs(phone=True, email=True),
            standard_attributes=cognito.StandardAttributes(
                preferred_username=cognito.StandardAttribute(required=False, mutable=True),
                fullname=cognito.StandardAttribute(required=False, mutable=True)),
            custom_attributes={"language": cognito.StringAttribute(min_len=2, max_len=2, mutable=True)},
            # Essentials plan: needed for SMS one-time codes as a way to sign in.
            feature_plan=cognito.FeaturePlan.ESSENTIALS,
            sign_in_policy=cognito.SignInPolicy(allowed_first_auth_factors=cognito.AllowedFirstAuthFactors(
                password=True, sms_otp=True)),
            password_policy=cognito.PasswordPolicy(min_length=8, require_symbols=True,
                                                   temp_password_validity=Duration.days(7)),
            mfa=cognito.Mfa.OPTIONAL, mfa_second_factor=cognito.MfaSecondFactor(sms=True, otp=True),
            account_recovery=cognito.AccountRecovery.PHONE_WITHOUT_MFA_AND_EMAIL,
            lambda_triggers=cognito.UserPoolTriggers(pre_sign_up=triggers, custom_message=triggers,
                                                     post_confirmation=triggers, pre_token_generation=triggers),
            removal_policy=removal, deletion_protection=prod)

        self.employee_user_pool = cognito.UserPool(
            self, "EmployeeUserPool", user_pool_name=f"clean-am-{stage}-employees", self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(email=True), sign_in_case_sensitive=False,
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            standard_attributes=cognito.StandardAttributes(
                fullname=cognito.StandardAttribute(required=False, mutable=True)),
            custom_attributes={"language": cognito.StringAttribute(min_len=2, max_len=2, mutable=True)},
            password_policy=cognito.PasswordPolicy(min_length=8, require_symbols=True,
                                                   temp_password_validity=Duration.days(7)),
            mfa=cognito.Mfa.OPTIONAL, mfa_second_factor=cognito.MfaSecondFactor(sms=False, otp=True),
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            lambda_triggers=cognito.UserPoolTriggers(custom_message=triggers, pre_token_generation=triggers),
            removal_policy=removal, deletion_protection=prod)

        self.admin_user_pool = cognito.UserPool(
            self, "AdminUserPool", user_pool_name=f"clean-am-{stage}-admins", self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(email=True), sign_in_case_sensitive=False,
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            standard_attributes=cognito.StandardAttributes(
                fullname=cognito.StandardAttribute(required=False, mutable=True)),
            password_policy=cognito.PasswordPolicy(min_length=8, require_symbols=True,
                                                   temp_password_validity=Duration.days(7)),
            mfa=cognito.Mfa.OPTIONAL, mfa_second_factor=cognito.MfaSecondFactor(sms=False, otp=True),
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            lambda_triggers=cognito.UserPoolTriggers(custom_message=triggers, pre_token_generation=triggers),
            removal_policy=removal, deletion_protection=prod)

        # For backwards compatibility with any single-pool reference:
        self.user_pool = self.citizen_user_pool

        # Granted by ARN pattern: referencing the pool itself here would be circular.
        triggers.add_to_role_policy(iam.PolicyStatement(
            actions=["cognito-idp:AdminAddUserToGroup"],
            resources=[f"arn:aws:cognito-idp:{self.region}:{self.account}:userpool/*"]))

        cognito.CfnUserPoolGroup(self, "CitizenGroup", user_pool_id=self.citizen_user_pool.user_pool_id,
                                 group_name="Citizen", precedence=30)
        cognito.CfnUserPoolGroup(self, "EmployeeGroup", user_pool_id=self.employee_user_pool.user_pool_id,
                                 group_name="Employee", precedence=20)
        cognito.CfnUserPoolGroup(self, "AdminGroup", user_pool_id=self.admin_user_pool.user_pool_id,
                                 group_name="Admin", precedence=10)

        # --- Google sign-in (optional, on Citizen pool): -c googleClientId=... --------
        providers = [cognito.UserPoolClientIdentityProvider.COGNITO]
        google = None
        if self.node.try_get_context("googleClientId"):
            if not self.node.try_get_context("googleSecretArn"):
                raise ValueError("Google sign-in needs -c googleSecretArn=<ARN of the Google client secret>")
            google_secret = secretsmanager.Secret.from_secret_complete_arn(
                self, "GoogleSecret", self.node.try_get_context("googleSecretArn"))
            google = cognito.UserPoolIdentityProviderGoogle(
                self, "Google", user_pool=self.citizen_user_pool, client_id=self.node.try_get_context("googleClientId"),
                client_secret_value=google_secret.secret_value_from_json("client_secret"),
                scopes=["openid", "email", "profile"],
                attribute_mapping=cognito.AttributeMapping(
                    email=cognito.ProviderAttribute.GOOGLE_EMAIL, fullname=cognito.ProviderAttribute.GOOGLE_NAME))
            providers.append(cognito.UserPoolClientIdentityProvider.GOOGLE)

        # Google sign-in goes through Cognito's OAuth endpoints on this domain.
        account = "local" if cdk.Token.is_unresolved(self.account) else self.account[-6:]
        domain = self.citizen_user_pool.add_domain("Domain", cognito_domain=cognito.CognitoDomainOptions(
            domain_prefix=self.node.try_get_context("cognitoDomainPrefix") or f"clean-am-{stage}-{account}"))

        # The Next.js server holds the client secret, so every Cognito call is made server-side.
        sites = [config["frontend_url"]] if prod else sorted({config["frontend_url"], "http://localhost:3000"})
        self.citizen_client = self.citizen_user_pool.add_client(
            "WebClient", generate_secret=True, prevent_user_existence_errors=True,
            auth_flows=cognito.AuthFlow(user=True),  # choice-based sign-in: password or SMS code
            supported_identity_providers=providers,
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE,
                        cognito.OAuthScope.COGNITO_ADMIN],
                callback_urls=[f"{site.rstrip('/')}/api/auth/google/callback" for site in sites],
                logout_urls=[site.rstrip("/") for site in sites]),
            id_token_validity=Duration.hours(1), access_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(30),
            write_attributes=cognito.ClientAttributes().with_standard_attributes(
                phone_number=True, email=True, preferred_username=True, fullname=True).with_custom_attributes("language"))
        if google:
            self.citizen_client.node.add_dependency(google)
        self.web_client = self.citizen_client
        citizen_client_secret = secretsmanager.Secret(self, "WebClientSecret", removal_policy=removal,
                                                      secret_string_value=self.citizen_client.user_pool_client_secret)

        # Employee App Client & Secret
        self.employee_client = self.employee_user_pool.add_client(
            "EmployeeClient", generate_secret=True, prevent_user_existence_errors=True,
            auth_flows=cognito.AuthFlow(user_password=True, user=True),
            id_token_validity=Duration.hours(1), access_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(30),
            write_attributes=cognito.ClientAttributes().with_standard_attributes(
                email=True, fullname=True).with_custom_attributes("language"))
        employee_client_secret = secretsmanager.Secret(self, "EmployeeClientSecret", removal_policy=removal,
                                                       secret_string_value=self.employee_client.user_pool_client_secret)

        # Admin App Client & Secret
        self.admin_client = self.admin_user_pool.add_client(
            "AdminClient", generate_secret=True, prevent_user_existence_errors=True,
            auth_flows=cognito.AuthFlow(user_password=True, user=True),
            id_token_validity=Duration.hours(1), access_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(30),
            write_attributes=cognito.ClientAttributes().with_standard_attributes(
                email=True, fullname=True))
        admin_client_secret = secretsmanager.Secret(self, "AdminClientSecret", removal_policy=removal,
                                                    secret_string_value=self.admin_client.user_pool_client_secret)

        # --- The first admin: Cognito emails them a temporary password & link to staff login --
        admin_email = config["seed_admin_email"]
        seed_params = {
            "UserPoolId": self.admin_user_pool.user_pool_id,
            "Username": admin_email,
            "DesiredDeliveryMediums": ["EMAIL"],
            "UserAttributes": [{"Name": "email", "Value": admin_email},
                               {"Name": "email_verified", "Value": "true"},
                               {"Name": "name", "Value": config["seed_admin_name"]}],
        }
        if config.get("seed_admin_password"):
            seed_params["TemporaryPassword"] = config["seed_admin_password"]

        seed_call = cr.AwsSdkCall(
            service="CognitoIdentityServiceProvider", action="adminCreateUser",
            parameters=seed_params,
            physical_resource_id=cr.PhysicalResourceId.of(f"seed-admin-pool-{admin_email}"),
            ignore_error_codes_matching="UsernameExistsException")
        seed = cr.AwsCustomResource(
            self, "SeedAdmin", install_latest_aws_sdk=False,
            on_create=seed_call, on_update=seed_call,
            policy=cr.AwsCustomResourcePolicy.from_sdk_calls(resources=[self.admin_user_pool.user_pool_arn]))

        group_call = cr.AwsSdkCall(
            service="CognitoIdentityServiceProvider", action="adminAddUserToGroup",
            parameters={"UserPoolId": self.admin_user_pool.user_pool_id, "Username": admin_email, "GroupName": "Admin"},
            physical_resource_id=cr.PhysicalResourceId.of(f"seed-admin-group-pool-{admin_email}"))
        add_to_group = cr.AwsCustomResource(
            self, "SeedAdminGroup", install_latest_aws_sdk=False,
            on_create=group_call, on_update=group_call,
            policy=cr.AwsCustomResourcePolicy.from_sdk_calls(resources=[self.admin_user_pool.user_pool_arn]))
        add_to_group.node.add_dependency(seed, self.node.find_child("AdminGroup"))

        resend_tag = self.node.try_get_context("resendAdminInvite")
        if resend_tag and not config["seed_admin_email_given"]:
            raise ValueError("resendAdminInvite needs -c seedAdminEmail=<the email the admin was created with>")
        if resend_tag:
            resend = cr.AwsSdkCall(
                service="CognitoIdentityServiceProvider", action="adminCreateUser",
                parameters={"UserPoolId": self.admin_user_pool.user_pool_id, "Username": admin_email,
                            "MessageAction": "RESEND", "DesiredDeliveryMediums": ["EMAIL"]},
                physical_resource_id=cr.PhysicalResourceId.of(f"resend-admin-invite-{resend_tag}"),
                ignore_error_codes_matching="UnsupportedUserStateException")
            cr.AwsCustomResource(
                self, "ResendAdminInvite", install_latest_aws_sdk=False, on_create=resend, on_update=resend,
                policy=cr.AwsCustomResourcePolicy.from_sdk_calls(resources=[self.admin_user_pool.user_pool_arn])
            ).node.add_dependency(seed)

        # --- Values the frontend needs -------------------------------------------
        # Backwards compatible outputs:
        cdk.CfnOutput(self, "UserPoolId", value=self.citizen_user_pool.user_pool_id)
        cdk.CfnOutput(self, "UserPoolClientId", value=self.citizen_client.user_pool_client_id)
        cdk.CfnOutput(self, "WebClientSecretArn", value=citizen_client_secret.secret_arn)
        cdk.CfnOutput(self, "CognitoDomain", value=domain.base_url())

        # Pool-specific outputs:
        cdk.CfnOutput(self, "CitizenUserPoolId", value=self.citizen_user_pool.user_pool_id)
        cdk.CfnOutput(self, "CitizenClientId", value=self.citizen_client.user_pool_client_id)
        cdk.CfnOutput(self, "CitizenClientSecretArn", value=citizen_client_secret.secret_arn)
        cdk.CfnOutput(self, "EmployeeUserPoolId", value=self.employee_user_pool.user_pool_id)
        cdk.CfnOutput(self, "EmployeeClientId", value=self.employee_client.user_pool_client_id)
        cdk.CfnOutput(self, "EmployeeClientSecretArn", value=employee_client_secret.secret_arn)
        cdk.CfnOutput(self, "AdminUserPoolId", value=self.admin_user_pool.user_pool_id)
        cdk.CfnOutput(self, "AdminClientId", value=self.admin_client.user_pool_client_id)
        cdk.CfnOutput(self, "AdminClientSecretArn", value=admin_client_secret.secret_arn)
