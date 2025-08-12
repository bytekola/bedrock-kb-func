import * as cdk from "aws-cdk-lib";
import { Stack, StackProps } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { EndpointType, LambdaRestApi } from "aws-cdk-lib/aws-apigateway";
import { InterfaceVpcEndpoint, IVpc, Subnet, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as path from "path";
import { excludeDockerImage } from "./constants/docker";

interface ApiPublishmentStackProps extends StackProps {
  readonly bedrockRegion: string;
  readonly enableBedrockCrossRegionInference: boolean;
  readonly conversationTableName: string;
  readonly botTableName: string;
  readonly tableAccessRoleArn: string;
  readonly usagePlan: apigateway.UsagePlanProps;
  readonly deploymentStage?: string;
  readonly largeMessageBucketName: string;
  readonly corsOptions?: apigateway.CorsOptions;
  readonly vpcId: string;
  readonly subnets: any;
  readonly executeApiEndpointId: string;
}

export class ApiPublishmentStack extends Stack {
  public readonly chatQueue: sqs.Queue;
  constructor(scope: Construct, id: string, props: ApiPublishmentStackProps) {
    super(scope, id, props);

    console.log(`usagePlan: ${JSON.stringify(props.usagePlan)}`); // DEBUG

    const deploymentStage = props.deploymentStage ?? "dev";

    // Add Lambda to Vpc
    const vpc: IVpc = Vpc.fromLookup(this, 'ApiPrivateVpc', {
      vpcId: props.vpcId,
    }); 
    
    const subnet_ids = typeof props.subnets === "string" ?  props.subnets.split(",") : props.subnets
    const subnets = []
    for (const _subnet of subnet_ids) {
      const subnet = Subnet.fromSubnetId(this, _subnet, _subnet);
      subnets.push(subnet)
    }

    const chatQueueDLQ = new sqs.Queue(this, "ChatQueueDlq", {
      retentionPeriod: cdk.Duration.days(14),
    });
    const chatQueue = new sqs.Queue(this, "ChatQueue", {
      visibilityTimeout: cdk.Duration.minutes(30),
      deadLetterQueue: {
        maxReceiveCount: 2, // one retry
        queue: chatQueueDLQ,
      },
    });
    const handlerRole = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    handlerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );
    handlerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaVPCAccessExecutionRole"
      )
    );        
    handlerRole.addToPolicy(
      // Assume the table access role for row-level access control.
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [props.tableAccessRoleArn],
      })
    );

    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:*"],
        resources: ["*"],
      })
    );

    const largeMessageBucket = s3.Bucket.fromBucketName(this, "LargeMessageBucket",
      props.largeMessageBucketName
    );

    largeMessageBucket.grantReadWrite(handlerRole);

    // Handler for FastAPI
    const apiHandler = new DockerImageFunction(this, "ApiHandler", {
      code: DockerImageCode.fromImageAsset(
        path.join(__dirname, "../../backend"),
        {
          platform: Platform.LINUX_AMD64,
          file: "Dockerfile",
          exclude: [...excludeDockerImage],
        }
      ),
      vpc: vpc,
      vpcSubnets: {
        subnets: subnets
      },
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        AWS_STS_REGIONAL_ENDPOINTS: "regional",
        PUBLISHED_API_ID: id.replace("ApiPublishmentStack", ""),
        QUEUE_URL: chatQueue.queueUrl,
        CONVERSATION_TABLE_NAME: props.conversationTableName,
        BOT_TABLE_NAME: props.botTableName,
        CORS_ALLOW_ORIGINS: (props.corsOptions?.allowOrigins ?? ["*"]).join(
          ","
        ),
        ACCOUNT: Stack.of(this).account,
        REGION: Stack.of(this).region,
        BEDROCK_REGION: props.bedrockRegion,
        LARGE_MESSAGE_BUCKET: props.largeMessageBucketName,
        TABLE_ACCESS_ROLE_ARN: props.tableAccessRoleArn,
      },
      role: handlerRole,
    });

    // Handler for SQS consumer
    const sqsConsumeHandler = new DockerImageFunction(this,"SqsConsumeHandler", {
        code: DockerImageCode.fromImageAsset(
          path.join(__dirname, "../../backend"),
          {
            platform: Platform.LINUX_AMD64,
            file: "lambda.Dockerfile",
            cmd: ["app.sqs_consumer.handler"],
            exclude: [...excludeDockerImage],
          }
        ),
        vpc: vpc,
        vpcSubnets: {
          subnets: subnets
        },        
        memorySize: 1024,
        timeout: cdk.Duration.minutes(15),
        environment: {
          AWS_STS_REGIONAL_ENDPOINTS: "regional", 
          PUBLISHED_API_ID: id.replace("ApiPublishmentStack", ""),
          QUEUE_URL: chatQueue.queueUrl,
          CONVERSATION_TABLE_NAME: props.conversationTableName,
          BOT_TABLE_NAME: props.botTableName,
          CORS_ALLOW_ORIGINS: (props.corsOptions?.allowOrigins ?? ["*"]).join(
            ","
          ),
          ACCOUNT: Stack.of(this).account,
          REGION: Stack.of(this).region,
          ENABLE_BEDROCK_CROSS_REGION_INFERENCE: props.enableBedrockCrossRegionInference.toString(),
          BEDROCK_REGION: props.bedrockRegion,
          TABLE_ACCESS_ROLE_ARN: props.tableAccessRoleArn,
        },
        role: handlerRole
      
    });

    sqsConsumeHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(chatQueue)
    );

    chatQueue.grantSendMessages(apiHandler);
    chatQueue.grantConsumeMessages(sqsConsumeHandler);
    const executeApiEndpoint = InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(this, 'ExecuteApiEndpointId', {
      vpcEndpointId: props.executeApiEndpointId,
      port: 443
    });

    const api = new LambdaRestApi(this, "Api", {
      restApiName: id,
      handler: apiHandler,
      proxy: true,
      endpointConfiguration: {
        types: [EndpointType.PRIVATE],
        vpcEndpoints: [executeApiEndpoint]
      },
      deployOptions: {
        stageName: deploymentStage,
      },
      defaultMethodOptions: { apiKeyRequired: true },
      defaultCorsPreflightOptions: props.corsOptions,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            principals: [new iam.AnyPrincipal()],
            resources: ['execute-api:/*/*/*'],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            principals: [new iam.AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*/*/*'],
            conditions: {
              'StringNotEquals': {
                "aws:SourceVpce": [
                  props.executeApiEndpointId
                ]
              }
            }
          })
        ]
      })
    });

    const apiKey = api.addApiKey("ApiKey", {
      description: "Default api key (Auto generated by CDK)",
    });

    const usagePlan = api.addUsagePlan("UsagePlan", {
      ...props.usagePlan,
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });
    
    this.chatQueue = chatQueue;
  }
}
