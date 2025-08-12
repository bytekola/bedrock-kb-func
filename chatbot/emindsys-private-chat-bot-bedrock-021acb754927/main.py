import os
import sys
import time
import json
import boto3
import subprocess
from botocore.exceptions import ClientError


# ? Ecr
def connect_to_ecr(session, account_id, region):
    try:
        run_command(
            f"aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {account_id}.dkr.ecr.{region}.amazonaws.com",
            False,
        )
    except Exception as e:
        sys.exit(e)


def build_images_and_push(session, account_id, region):
    try:
        connect_to_ecr(session, account_id, region)

        python_repo_uri = get_cfn_output(
            session, stackset_name="BedrockChatStack", key="PythonRepoUri"
        )

        aws_lambda_adapter_repo_uri = get_cfn_output(
            session, stackset_name="BedrockChatStack", key="AwsLambdaAdapterRepo"
        )

        # ? Pull Images
        run_command(
            f"docker pull public.ecr.aws/lambda/python:3.13",
            True,
        )
        run_command(
            f"docker pull public.ecr.aws/docker/library/python:3.13.2-slim-bookworm",
            True,
        )
        run_command(
            f"docker pull public.ecr.aws/awsguru/aws-lambda-adapter:0.7.0",
            True,
        )

        # ?----- Tag Images
        run_command(
            f"docker tag public.ecr.aws/lambda/python:3.13 {python_repo_uri}:3.13",
            True,
        )
        run_command(
            f"docker tag public.ecr.aws/docker/library/python:3.13.2-slim-bookworm {python_repo_uri}:3.13.2-slim-bookworm",
            True,
        )
        run_command(
            f"docker tag public.ecr.aws/awsguru/aws-lambda-adapter:0.7.0 {aws_lambda_adapter_repo_uri}:0.7.0",
            True,
        )

        # ? Push Images
        run_command(
            f"docker push {python_repo_uri}:3.13",
            True,
        )
        run_command(
            f"docker push {python_repo_uri}:3.13.2-slim-bookworm",
            True,
        )
        run_command(
            f"docker push {aws_lambda_adapter_repo_uri}:0.7.0",
            True,
        )

        print("Please Update Repository URI in Docker File")
        print("Docker File Path: /backend/Dockerfile ")
        print(f"{python_repo_uri}:3.13.2-slim-bookworm")
        print(f"{aws_lambda_adapter_repo_uri}:0.7.0")

        print("Dockerfile: /backend/lambda.Dockerfile ")
        print(f"{python_repo_uri}:3.13")
        input("any key to continue")
    except Exception as e:
        sys.exit(e)


# ?


def update_cdk_context(session):
    print("Update cdk.json")
    region = input("Enter AWS region: ").strip()
    domain_name = input("Enter domain name: ").strip()
    acm = session.client("acm", region_name=region)
    certs = acm.list_certificates(CertificateStatuses=["ISSUED"])[
        "CertificateSummaryList"
    ]
    cert_arn = None

    for cert in certs:
        if domain_name in cert["DomainName"]:
            cert_arn = cert["CertificateArn"]
            break

    if not cert_arn:
        print(
            f"No ACM certificate found for domain: {domain_name}. A certificate is required."
        )
        sys.exit(1)

    vpc_id = input("Enter the VPC ID: ")
    subnet_ids = input(
        "Enter the subnet IDs (separated by commas, e.g., subnet-1234abcd,subnet-5678efgh): "
    ).split(",")
    lb_subnet_ids = input(
        "Enter the subnet IDs for the Load Balancer (comma-separated, e.g., subnet-1234abcd, subnet-5678efgh): "
    ).split(",")

    execute_api_vpc_endpoint_id = input("Enter execute_api_vpc_endpoint_id: ").strip()
    s3_vpc_endpoint_id = input("Enter s3_vpc_endpoint_id: ").strip()

    s3_ips = input(
        "Enter the S3 VPC Endpoint IPs (comma-separated, e.g., 10.200.0.10, 10.200.0.20): "
    ).split(",")

    cdk_file_path = "./cdk/cdk.json"
    if not os.path.exists(cdk_file_path):
        print(f"cdk.json not found at {cdk_file_path}")
        sys.exit(1)

    with open(cdk_file_path, "r") as f:
        data = json.load(f)

    if "context" not in data:
        data["context"] = {}

    data["context"].update(
        {
            "vpcId": vpc_id,
            "bedrockRegion": region,
            "domain_name": domain_name,
            "certificateArn": cert_arn,
            "subnets": subnet_ids,
            "lb_subnets": lb_subnet_ids,
            "execute_api_vpc_endpoint_id": execute_api_vpc_endpoint_id,
            "s3_vpc_endpoint_id": s3_vpc_endpoint_id,
            "s3_endpoint_ips": s3_ips,
        }
    )

    with open(cdk_file_path, "w") as f:
        json.dump(data, f, indent=2)


def get_function(session, lambda_prefix_name):
    try:
        client = session.client("lambda")
        response = client.list_functions()
        for function in response["Functions"]:
            if lambda_prefix_name in function["FunctionName"]:
                return function  # function["FunctionName"], function["Role"]
    except Exception as e:
        sys.exit(e)


def get_environment_variables(variable, error):
    value = None
    try:
        value = os.environ[variable]
    except:
        sys.exit(error)
    return value


def get_account_id(session):
    try:
        client = session.client("sts")
        response = client.get_caller_identity()
        return response["Account"]
    except Exception as e:
        sys.exit(e)


def run_command(command, print_output=False):
    try:
        if print_output:
            print(f"\nRunning: {command}")
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if print_output:
            for line in process.stdout:
                print(line, end="")

        process.wait()

        if process.returncode != 0:
            print(f"\nCommand failed with exit code {process.returncode}")
    except Exception as e:
        print(f"Error running command: {e}")


def install_dependency(path, args="", print_output=False):
    try:
        run_command(f"cd {path} && npm ci {args}", print_output)
    except Exception as e:
        sys.exit(e)


def get_chatbot_stack_outputs(session, stackset_name):
    client = session.client("cloudformation")
    outputs = {}
    keys = {
        "VITEAPPAPIENDPOINT": "VITE_APP_API_ENDPOINT",
        "VITEAPPWSENDPOINT": "VITE_APP_WS_ENDPOINT",
        "VITEAPPUSERPOOLID": "VITE_APP_USER_POOL_ID",
        "VITEAPPUSERPOOLCLIENTID": "VITE_APP_USER_POOL_CLIENT_ID",
        "VITEAPPREGION": "VITE_APP_REGION",
        "VITEAPPUSESTREAMING": "VITE_APP_USE_STREAMING",
        "VITEAPPREDIRECTSIGNINURL": "VITE_APP_REDIRECT_SIGNIN_URL",
        "VITEAPPREDIRECTSIGNOUTURL": "VITE_APP_REDIRECT_SIGNOUT_URL",
        "VITEAPPCOGNITODOMAIN": "VITE_APP_COGNITO_DOMAIN",
        "VITEAPPSOCIALPROVIDERS": "VITE_APP_SOCIAL_PROVIDERS",
        "VITEAPPCUSTOMPROVIDERENABLED": "VITE_APP_CUSTOM_PROVIDER_ENABLED",
    }
    try:
        cfn_outputs = client.describe_stacks(StackName=stackset_name)["Stacks"][0][
            "Outputs"
        ]
        for output in cfn_outputs:
            output_key = keys.get(output["OutputKey"])
            if output_key == None:
                continue
            else:
                outputs[output_key] = output["OutputValue"]
        return outputs
    except Exception as e:
        sys.exit(e)


def get_cfn_output(session, stackset_name, key):
    client = session.client("cloudformation")
    value = None
    try:
        cfn_outputs = client.describe_stacks(StackName=stackset_name)["Stacks"][0][
            "Outputs"
        ]
        for output in cfn_outputs:
            if key == output["OutputKey"]:
                value = output["OutputValue"]
        return value
    except Exception as e:
        sys.exit(e)


def set_environment(envs):
    try:
        for key, value in envs.items():
            os.environ[key] = str(value)
    except Exception as e:
        sys.exit(e)


def build_frontend_files(path):
    try:
        run_command(f"cd {path} && npm run build", True)
    except Exception as e:
        sys.exit(e)


def get_variable_from_context(variable):
    try:
        with open(f"./cdk/cdk.json", "r") as file:
            data = json.load(file)

        return data.get("context", {}).get(variable)
    except Exception as e:
        sys.exit(e)


def upload_folder_to_bucket(folder_path, bucket_name, key="/", exclude_dirs=[]):
    _exclude_dirs = ""
    if len(exclude_dirs) > 0:
        for exclude in exclude_dirs:
            _exclude_dirs += f" --exclude '{exclude}/*'"
            _exclude_dirs += f" --exclude '*/{exclude}/*'"
    else:
        _exclude_dirs = ""
    try:
        run_command(
            f"aws s3 cp {folder_path} s3://{bucket_name}{key} --recursive {_exclude_dirs}",
            True,
        )
    except Exception as e:
        sys.exit(e)


def get_bucket_name(session, bucket_prefix_name):
    try:
        bucket_name = None
        client = session.client("s3")
        buckets = client.list_buckets()["Buckets"]
        for bucket in buckets:
            if bucket_prefix_name in bucket["Name"]:
                bucket_name = bucket["Name"]
        return bucket_name
    except Exception as e:
        sys.exit(e)


def upload_file(bucket_name, file_name, key="/"):
    try:
        run_command(f"aws s3 cp {file_name} s3://{bucket_name}{key} ")
    except Exception as e:
        sys.exit(e)


def update_lambda_config(session, function_name, subnets, security_group_id):
    try:
        client = session.client("lambda")
        client.update_function_configuration(
            FunctionName=function_name,
            VpcConfig={
                "SubnetIds": subnets,
                "SecurityGroupIds": [security_group_id],
            },
            Environment={"Variables": {"AWS_STS_REGIONAL_ENDPOINTS": "regional"}},
        )
    except Exception as e:
        sys.exit(e)


def get_security_group(session, security_group_name):
    try:
        print()
        client = session.client("ec2")
        response = client.describe_security_groups()
        for security_group in response["SecurityGroups"]:
            if security_group_name in security_group["GroupName"]:
                return security_group["GroupId"]
    except Exception as e:
        sys.exit(e)


def attach_vpc_execution_policy_to_role(session, role_arn, managed_policy):
    iam = session.client("iam")
    role_name = role_arn.split("/")[-1]
    policy_arn = f"arn:aws:iam::aws:policy/{managed_policy}"
    try:
        iam.attach_role_policy(RoleName=role_name, PolicyArn=policy_arn)
    except Exception as e:
        sys.exit(e)


def get_action(print_help=False):
    actions = {
        "update_context": "Prompts for AWS environment details (region, domain, VPC, subnets, endpoint IDs, etc.) and updates the cdk.json file with necessary context values for CDK deployment.",
        "deploy": "Install dependencies, bootstrap CDK, deploy the infrastructure",
        "configure": "Configure Lambda with VPC, subnets, and security group",
        "publish": "upload CDK project to source bucket, And Build frontend and push files to the frontend S3 bucket",
        "provision": "Run full setup: deploy cdk, configure, and publish",
        "destroy": "Clean up buckets and destroy the CDK stack",
    }
    if print_help:
        print("Available Actions:")
        for name, description in actions.items():
            print(f"  {name:<10} - {description}")
        return

    if len(sys.argv) > 1:
        action = sys.argv[1]

        if action in ("--help", "-h"):
            print("Available actions:")
            for name, description in actions.items():
                print(f"  {name:<10} - {description}")
            sys.exit(0)

        if action in actions:
            return action
        else:
            sys.exit(
                f"Error: Invalid action '{action}'.\n"
                "Use '--help' or '-h' to see a list of valid actions."
            )
    else:
        print("Error: No action provided. You must specify an action to proceed.\n")
        print("Available actions:")
        for name, description in actions.items():
            print(f"  {name:<10} - {description}")
        print("\n")
        sys.exit(1)


def delete_stacks_with_prefix(session, prefix, region_name):
    cf_client = session.client("cloudformation", region_name=region_name)

    paginator = cf_client.get_paginator("list_stacks")
    stack_summaries = []
    for page in paginator.paginate(
        StackStatusFilter=[
            "CREATE_COMPLETE",
            "UPDATE_COMPLETE",
            "UPDATE_ROLLBACK_COMPLETE",
            "ROLLBACK_COMPLETE",
            "DELETE_FAILED",
        ]
    ):
        stack_summaries.extend(page["StackSummaries"])

    stacks_to_delete = [
        stack["StackName"]
        for stack in stack_summaries
        if stack["StackName"].startswith(prefix)
    ]

    for stack_name in stacks_to_delete:
        print(f"Deleting stack: {stack_name}")
        try:
            cf_client.delete_stack(StackName=stack_name)
        except Exception as e:
            print(f"Error deleting {stack_name}: {e}")

    if not stacks_to_delete:
        print(f"No stacks found with prefix '{prefix}'")


def cleanup_bucket(session, bucket_name):
    s3 = session.resource("s3")
    bucket = s3.Bucket(bucket_name)
    try:
        bucket.object_versions.delete()
    except Exception as e:
        print(e)
    try:
        bucket.objects.all().delete()
    except Exception as e:
        print(f"Failed to Cleanup Buckets: {e}")
        sys.exit(e)


def cleanup_buckets(session, buckets_prefix_name):
    try:
        bucket_name = None
        client = session.client("s3")
        buckets = client.list_buckets()["Buckets"]
        for bucket in buckets:
            if buckets_prefix_name in bucket["Name"]:
                bucket_name = bucket["Name"]
                cleanup_bucket(session, bucket_name)
    except Exception as e:
        sys.exit(e)


def get_props():
    try:
        subnets = get_variable_from_context("./cdk", "subnets")
        return {"subnets": subnets}
    except Exception as e:
        sys.exit(e)


# ? CDK Action
def cdk_bootstrap(session, region, account_id, qualifier):
    cf = session.client("cloudformation", region_name=region)
    try:
        response = cf.describe_stacks(StackName="CDKToolkit")
        stack_status = response["Stacks"][0]["StackStatus"]
        if stack_status in ["CREATE_COMPLETE", "UPDATE_COMPLETE"]:
            return True
    except ClientError as e:
        if "does not exist" in str(e) or "ValidationError" in str(e):
            print("CDK not bootstrapped. Running bootstrap...")
            run_command(
                f"cd ./cdk && npx cdk bootstrap aws://{account_id}/{region} --qualifier {qualifier}",
                True,
            )
            return True
        else:
            raise


def cdk_deploy():
    try:
        run_command(f"cd ./cdk && npx cdk deploy --require-approval never --all", True)
    except Exception as e:
        sys.exit(e)


def cdk_destroy():
    try:
        os.environ["JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION"] = "true"
        run_command(f"cd ./cdk && npx cdk destroy --all --force", True)
    except Exception as e:
        sys.exit(e)


def init():
    run_init = input("Install Dependency? (y to confirm, any other key to skip): ")
    if run_init == "y":
        # ? Install CDK Dependency
        install_dependency(path="./cdk", args="", print_output=True)
        # ? Install Frontend Dependency
        install_dependency(
            path="./frontend",
            args="-f --target_arch=x64 --target_platform=linux",
            print_output=True,
        )


# ? Actions
def configure(session):
    try:
        subnets = get_variable_from_context("subnets")
        security_group_id = get_cfn_output(
            session, stackset_name="BedrockChatStack", key="FunctionDefaultSG"
        )
        function = get_function(
            session=session, lambda_prefix_name="BedrockChatStack-CrossRegionAws"
        )
        attach_vpc_execution_policy_to_role(
            session,
            function["Role"],
            managed_policy="service-role/AWSLambdaVPCAccessExecutionRole",
        )
        time.sleep(10)
        update_lambda_config(
            session, function["FunctionName"], subnets, security_group_id
        )
    except Exception as e:
        time.sleep(10)
        configure(session)


def deploy(session, region, account_id, qualifier):
    try:
        os.environ["JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION"] = "true"

        # ? Bootstrap CDK
        cdk_bootstrap(session, region, account_id, qualifier)

        # ? CDK Deploy
        cdk_deploy()

    except Exception as e:
        sys.exit(e)


def publish(session):
    try:
        # ? Upload CDK Project to Source Bucket.
        asset_bucket_name = get_bucket_name(
            session=session, bucket_prefix_name="bedrockchatstack-sourcebucketforcode"
        )
        upload_folder_to_bucket(
            "./cdk",
            asset_bucket_name,
            key="/cdk",
            exclude_dirs=["node_modules", "cdk.out"],
        )
        upload_folder_to_bucket(
            "./backend",
            asset_bucket_name,
            key="/backend",
            exclude_dirs=["node_modules"],
        )
        # ? Build And Upload Frontend Files.

        bedrock_chat_outputs = get_chatbot_stack_outputs(session, "BedrockChatStack")
        set_environment(bedrock_chat_outputs)
        build_frontend_files("./frontend")
        frontend_bucket_name = get_variable_from_context("domain_name")
        upload_folder_to_bucket("./frontend/dist", frontend_bucket_name)
    except Exception as e:
        sys.exit(e)


def destroy(session, region):
    try:
        domain_name = get_variable_from_context("domain_name")
        # ? All buckets will be emptied to allow successful CDK destroy.
        cleanup_buckets(session, buckets_prefix_name="bedrockchatstack-")
        cleanup_buckets(session, buckets_prefix_name="bedrockregionresource")
        cleanup_buckets(session, buckets_prefix_name=domain_name)

        # ? Delete Custom Bots Stacksets
        delete_stacks_with_prefix(
            session, prefix="ApiPublishmentStack", region_name=region
        )
        delete_stacks_with_prefix(session, prefix="BrChatKbStack", region_name=region)

        # ? Destroy CDK
        cdk_destroy()
    except Exception as e:
        sys.exit(e)


def main():
    try:
        cdk_qualifier = get_variable_from_context("@aws-cdk/core:bootstrapQualifier")
        aws_region = get_environment_variables(
            "AWS_REGION",
            "Error: Missing required environment variable 'AWS_REGION'. Please set it before running the script.",
        )
        session = boto3.Session(region_name=aws_region)
        aws_account_id = get_account_id(session)
        action = get_action()
        connect_to_ecr(session, aws_account_id, aws_region)
        match action:
            case "deploy":
                deploy(session, aws_region, aws_account_id, cdk_qualifier)
            case "configure":
                configure(session)
            case "publish":
                publish(session)
            case "provision":
                deploy_ecr = input("Deploy Ecr Repos? (y): ")

                deploy(session, aws_region, aws_account_id, cdk_qualifier)
                if deploy_ecr == "y":
                    build_images_and_push(session, aws_account_id, aws_region)

                configure(session)
                publish(session)

                domain_name = get_variable_from_context("domain_name")
                alb_dns = get_cfn_output(
                    session, stackset_name="BedrockChatStack", key="LoadBalancerDnsName"
                )
                print("\n")
                print(
                    f"Please Remember To Add Record in Hosted Zone:\nDomain: {domain_name}\nALB Dns: {alb_dns}"
                )
                print("\n")
            case "destroy":
                destroy(session, aws_region)
            case _:
                get_action(True)
    except KeyboardInterrupt:
        print("\nExecution interrupted by user (Ctrl+C). Terminating command...")


if __name__ == "__main__":
    main()
