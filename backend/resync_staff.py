#!/usr/bin/env python3
"""
CLEAN-AM Staff Migration and Resync Utility

Helps inspect, clean, and re-link Admin and Employee accounts when migrating
from a single Cognito User Pool to separate Admin and Employee User Pools.

Usage:
  python resync_staff.py --list
  python resync_staff.py --clean-dynamo
  python resync_staff.py --relink-employee
"""
import argparse
import os
import sys
import boto3
from botocore.exceptions import ClientError


def get_stack_outputs(stage: str, region: str) -> dict:
    cf = boto3.client("cloudformation", region_name=region)
    stack_name = f"CleanAm-{stage.capitalize()}-Data"
    try:
        resp = cf.describe_stacks(StackName=stack_name)
        outputs = {
            o["OutputKey"]: o["OutputValue"]
            for o in resp["Stacks"][0].get("Outputs", [])
        }
        return outputs
    except Exception as exc:
        print(f"[!] Warning: Could not read CloudFormation stack '{stack_name}': {exc}")
        return {}


def list_records(stage: str, region: str):
    dynamodb = boto3.resource("dynamodb", region_name=region)
    admins_tbl = dynamodb.Table(f"clean-am-{stage}-admins")
    employees_tbl = dynamodb.Table(f"clean-am-{stage}-employees")

    print(f"\n=== Current DynamoDB Records ({stage}) ===")
    try:
        admins = admins_tbl.scan().get("Items", [])
        print(f"Admins Table (clean-am-{stage}-admins): {len(admins)} items")
        for a in admins:
            print(f"  - Admin ID (sub): {a.get('admin_id')}, Email: {a.get('email')}, Name: {a.get('name')}")
    except Exception as e:
        print(f"  Error reading admins table: {e}")

    try:
        employees = employees_tbl.scan().get("Items", [])
        print(f"Employees Table (clean-am-{stage}-employees): {len(employees)} items")
        for e in employees:
            print(f"  - Employee ID (sub): {e.get('employee_id')}, Email: {e.get('email')}, Name: {e.get('name')}, Created By: {e.get('created_by')}")
    except Exception as e:
        print(f"  Error reading employees table: {e}")


def clean_dynamo(stage: str, region: str):
    dynamodb = boto3.resource("dynamodb", region_name=region)
    admins_tbl = dynamodb.Table(f"clean-am-{stage}-admins")
    employees_tbl = dynamodb.Table(f"clean-am-{stage}-employees")

    print(f"\nCleaning DynamoDB records for stage '{stage}'...")
    try:
        admins = admins_tbl.scan().get("Items", [])
        for a in admins:
            print(f"  Deleting old admin item: {a.get('admin_id')} ({a.get('email')})")
            admins_tbl.delete_item(Key={"admin_id": a["admin_id"]})
    except Exception as e:
        print(f"  Error cleaning admins: {e}")

    try:
        employees = employees_tbl.scan().get("Items", [])
        for e in employees:
            print(f"  Deleting old employee item: {e.get('employee_id')} ({e.get('email')})")
            employees_tbl.delete_item(Key={"employee_id": e["employee_id"]})
    except Exception as e:
        print(f"  Error cleaning employees: {e}")

    print("[+] DynamoDB staff tables cleaned successfully.")


def relink_employee(stage: str, region: str):
    outputs = get_stack_outputs(stage, region)
    emp_pool_id = outputs.get("EmployeeUserPoolId")
    admin_pool_id = outputs.get("AdminUserPoolId")

    if not emp_pool_id:
        print(f"[X] Error: Could not determine EmployeeUserPoolId from stack outputs.")
        print(f"    Please ensure 'npx cdk deploy CleanAm-{stage.capitalize()}-Data' has run successfully.")
        return

    dynamodb = boto3.resource("dynamodb", region_name=region)
    cognito = boto3.client("cognito-idp", region_name=region)
    admins_tbl = dynamodb.Table(f"clean-am-{stage}-admins")
    employees_tbl = dynamodb.Table(f"clean-am-{stage}-employees")

    # 1. Find new admin sub
    admins = admins_tbl.scan().get("Items", [])
    if not admins:
        # Check Cognito directly
        if admin_pool_id:
            users = cognito.list_users(UserPoolId=admin_pool_id).get("Users", [])
            if users:
                new_admin_id = next((a["Value"] for a in users[0]["Attributes"] if a["Name"] == "sub"), None)
                admin_name = next((a["Value"] for a in users[0]["Attributes"] if a["Name"] == "name"), "Admin")
                admin_email = next((a["Value"] for a in users[0]["Attributes"] if a["Name"] == "email"), "")
            else:
                print("[X] No admin found in AdminUserPool or DynamoDB. Please sign in as admin first or run deploy.")
                return
        else:
            print("[X] Admin not found. Please log in as admin once or check CDK outputs.")
            return
    else:
        new_admin = sorted(admins, key=lambda a: a.get("created_at", ""), reverse=True)[0]
        new_admin_id = new_admin["admin_id"]
        admin_name = new_admin.get("name", "Admin")

    print(f"[*] Target Admin ID: {new_admin_id} ({admin_name})")

    # 2. Find existing employees
    employees = employees_tbl.scan().get("Items", [])
    if not employees:
        print("[!] No employees found in DynamoDB to migrate.")
        return

    for old_emp in employees:
        email = old_emp["email"]
        name = old_emp.get("name", "")
        lang = old_emp.get("language", "en")
        old_id = old_emp["employee_id"]

        print(f"\n[*] Processing employee: {email} (Name: {name})...")
        try:
            # Create user in new Employee User Pool
            res = cognito.admin_create_user(
                UserPoolId=emp_pool_id,
                Username=email,
                DesiredDeliveryMediums=["EMAIL"],
                UserAttributes=[
                    {"Name": "email", "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                    {"Name": "name", "Value": name},
                    {"Name": "custom:language", "Value": lang},
                ],
            )
            new_sub = next(a["Value"] for a in res["User"]["Attributes"] if a["Name"] == "sub")
            username = res["User"]["Username"]

            # Add to Employee group
            cognito.admin_add_user_to_group(UserPoolId=emp_pool_id, Username=username, GroupName="Employee")
            print(f"  [+] Created user in EmployeeUserPool: {new_sub}")
            print(f"  [+] Cognito invitation email with temporary password & /staff/login sent to {email}")

            # Delete old DynamoDB row if sub changed
            if old_id != new_sub:
                employees_tbl.delete_item(Key={"employee_id": old_id})

            # Put updated item
            updated_emp = dict(old_emp)
            updated_emp.update({
                "employee_id": new_sub,
                "cognito_username": username,
                "created_by": new_admin_id,
                "created_by_username": admin_name,
                "is_active": True,
            })
            employees_tbl.put_item(Item=updated_emp)
            print(f"  [+] Updated DynamoDB record for employee: allocated to Admin {new_admin_id}")

        except ClientError as ce:
            if ce.response["Error"]["Code"] == "UsernameExistsException":
                print(f"  [!] Employee already exists in EmployeeUserPool. Re-sending invitation...")
                try:
                    cognito.admin_create_user(
                        UserPoolId=emp_pool_id,
                        Username=email,
                        MessageAction="RESEND",
                        DesiredDeliveryMediums=["EMAIL"]
                    )
                    print(f"  [+] Invitation email resent to {email}.")
                except Exception as ex:
                    print(f"  [!] Could not resend invite: {ex}")
            else:
                print(f"  [X] Failed creating employee in Cognito: {ce}")


def main():
    parser = argparse.ArgumentParser(description="Clean-AM Staff Account Relink and Cleanup Tool")
    parser.add_argument("--stage", default=os.getenv("STAGE", "dev"), help="Deployment stage (default: dev)")
    parser.add_argument("--region", default=os.getenv("AWS_REGION", os.getenv("CDK_DEFAULT_REGION", "us-east-1")), help="AWS Region (default: us-east-1)")
    parser.add_argument("--list", action="store_true", help="List current admin and employee DynamoDB records")
    parser.add_argument("--clean-dynamo", action="store_true", help="Delete old admin and employee rows from DynamoDB tables")
    parser.add_argument("--relink-employee", action="store_true", help="Re-create employee in new pool, send login invite, and allocate to new admin")

    args = parser.parse_args()

    if args.list:
        list_records(args.stage, args.region)
    elif args.clean_dynamo:
        clean_dynamo(args.stage, args.region)
    elif args.relink_employee:
        relink_employee(args.stage, args.region)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
