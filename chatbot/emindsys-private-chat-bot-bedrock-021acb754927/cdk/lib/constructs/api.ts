import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { CfnOutput, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { AuthorizationType, CognitoUserPoolsAuthorizer, Deployment, EndpointType, IdentitySource, IRestApi, LambdaIntegration, Model, RestApi } from 'aws-cdk-lib/aws-apigateway';
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import { InterfaceVpcEndpoint, ISubnet, IVpc } from 'aws-cdk-lib/aws-ec2';
import * as iam from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  IFunction,
  LayerVersion,
  Runtime,
  SnapStartConf,
} from "aws-cdk-lib/aws-lambda";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import { excludeDockerImage } from "../constants/docker";
import { Auth } from "./auth";
import { Database } from "./database";
import { UsageAnalysis } from "./usage-analysis";

export interface ApiProps {
  readonly database: Database;
  readonly envName: string;
  readonly envPrefix: string;
  readonly corsAllowOrigins?: string[];
  readonly auth: Auth;
  readonly bedrockRegion: string;
  readonly documentBucket: IBucket;
  readonly largeMessageBucket: IBucket;
  readonly apiPublishProject: codebuild.IProject;
  readonly bedrockCustomBotProject: codebuild.IProject;
  readonly usageAnalysis?: UsageAnalysis;
  readonly enableBedrockCrossRegionInference: boolean;
  readonly enableLambdaSnapStart: boolean;
  readonly openSearchEndpoint?: string;
  readonly executeApiEndpointId: string;
  readonly vpc: IVpc;
  readonly subnets: ISubnet[];
}

export class Api extends Construct {
  readonly api: IRestApi;
  readonly handler: IFunction;
  readonly apiEndpoint: string;
  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const region = Stack.of(this).region

    const { database, corsAllowOrigins: allowOrigins = ["*"] } = props;
    const { tableAccessRole } = database;

    const usageAnalysisOutputLocation = `s3://${props.usageAnalysis?.resultOutputBucket.bucketName}` || "";

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
        resources: [tableAccessRole.roleArn],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:*"],
        resources: ["*"],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["codebuild:StartBuild"],
        resources: [
          props.apiPublishProject.projectArn,
          props.bedrockCustomBotProject.projectArn,
        ],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DescribeStackResource",
          "cloudformation:DescribeStackResources",
          "cloudformation:DeleteStack",
        ],
        resources: [`*`],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["codebuild:BatchGetBuilds"],
        resources: [
          props.apiPublishProject.projectArn,
          props.bedrockCustomBotProject.projectArn,
        ],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "apigateway:GET",
          "apigateway:POST",
          "apigateway:PUT",
          "apigateway:DELETE",
        ],
        resources: [`arn:aws:apigateway:${Stack.of(this).region}::/*`],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "athena:GetWorkGroup",
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:GetDataCatalog",
        ],
        resources: [props.usageAnalysis?.workgroupArn || ""],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["glue:GetDatabase", "glue:GetDatabases"],
        resources: [
          props.usageAnalysis?.database.databaseArn || "",
          props.usageAnalysis?.database.catalogArn || "",
        ],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "glue:GetDatabase",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
        ],
        resources: [
          props.usageAnalysis?.database.databaseArn || "",
          props.usageAnalysis?.database.catalogArn || "",
          props.usageAnalysis?.ddbExportTable.tableArn || "",
        ],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:ListUsers",
          "cognito-idp:ListGroups",
        ],
        resources: [props.auth.userPool.userPoolArn],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "aoss:APIAccessAll",
          "aoss:DescribeCollection",
          "aoss:GetCollection",
          "aoss:SearchCollections",
          "aoss:BatchGetCollection",
          "aoss:ListCollections",
        ],
        resources: ["*"],
      })
    );
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["aoss:DescribeIndex", "aoss:ReadDocument"],
        resources: [
          `arn:aws:aoss:${Stack.of(this).region}:${Stack.of(this).account
          }:collection/*`,
        ],
      })
    );
    // For Firecrawl api key
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:RestoreSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage",
          "secretsmanager:DeleteSecret",
          "secretsmanager:RotateSecret",
          "secretsmanager:CancelRotateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:TagResource",
        ],
        resources: [
          `arn:aws:secretsmanager:${Stack.of(this).region}:${Stack.of(this).account
          }:secret:firecrawl/*/*`,
        ],
      })
    );
    props.usageAnalysis?.resultOutputBucket.grantReadWrite(handlerRole);
    props.usageAnalysis?.ddbBucket.grantRead(handlerRole);
    props.largeMessageBucket.grantReadWrite(handlerRole);

    const handler = new PythonFunction(this, "HandlerV2", {
      entry: path.join(__dirname, "../../../backend"),
      index: "app/main.py",
      bundling: {
        assetExcludes: [...excludeDockerImage],
        buildArgs: { POETRY_VERSION: "1.8.3" },
      },
      runtime: Runtime.PYTHON_3_13,
      architecture: Architecture.X86_64,
      memorySize: 1024,
      timeout: Duration.minutes(15),
      vpc: props.vpc,
      vpcSubnets: {
        subnets: props.subnets
      },
      environment: {
        AWS_STS_REGIONAL_ENDPOINTS: "regional",
        CONVERSATION_TABLE_NAME: database.conversationTable.tableName,
        BOT_TABLE_NAME: database.botTable.tableName,
        ENV_NAME: props.envName,
        ENV_PREFIX: props.envPrefix,
        CORS_ALLOW_ORIGINS: allowOrigins.join(","),
        USER_POOL_ID: props.auth.userPool.userPoolId,
        CLIENT_ID: props.auth.client.userPoolClientId,
        ACCOUNT: Stack.of(this).account,
        REGION: Stack.of(this).region,
        BEDROCK_REGION: props.bedrockRegion,
        TABLE_ACCESS_ROLE_ARN: tableAccessRole.roleArn,
        DOCUMENT_BUCKET: props.documentBucket.bucketName,
        LARGE_MESSAGE_BUCKET: props.largeMessageBucket.bucketName,
        PUBLISH_API_CODEBUILD_PROJECT_NAME: props.apiPublishProject.projectName,
        KNOWLEDGE_BASE_CODEBUILD_PROJECT_NAME:
          props.bedrockCustomBotProject.projectName,
        USAGE_ANALYSIS_DATABASE:
          props.usageAnalysis?.database.databaseName || "",
        USAGE_ANALYSIS_TABLE:
          props.usageAnalysis?.ddbExportTable.tableName || "",
        USAGE_ANALYSIS_WORKGROUP: props.usageAnalysis?.workgroupName || "",
        USAGE_ANALYSIS_OUTPUT_LOCATION: usageAnalysisOutputLocation,
        ENABLE_BEDROCK_CROSS_REGION_INFERENCE:
          props.enableBedrockCrossRegionInference.toString(),
        OPENSEARCH_DOMAIN_ENDPOINT: props.openSearchEndpoint || "",
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        PORT: "8000",
      },
      role: handlerRole,
      snapStart: props.enableLambdaSnapStart
        ? SnapStartConf.ON_PUBLISHED_VERSIONS
        : undefined,
      layers: [
        LayerVersion.fromLayerVersionArn(
          this,
          "LwaLayer",
          // https://github.com/awslabs/aws-lambda-web-adapter?tab=readme-ov-file#lambda-functions-packaged-as-zip-package-for-aws-managed-runtimes
          `arn:aws:lambda:${Stack.of(this).region
          }:753240598075:layer:LambdaAdapterLayerX86:23`
        ),
      ],
    });

    // https://github.com/awslabs/aws-lambda-web-adapter/tree/main/examples/fastapi-zip
    (handler.node.defaultChild as CfnResource).addPropertyOverride(
      "Handler",
      "run.sh"
    );
    const executeApiEndpoint = InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(this, 'ExecuteApiEndpointId', {
      vpcEndpointId: props.executeApiEndpointId,
      port: 443
    });

    const cognitoAuthorizer = new CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      authorizerName: "Authorization",
      cognitoUserPools: [props.auth.userPool],
      identitySource: IdentitySource.header("Authorization")
    })

    const api = new RestApi(this, 'PrivateApi', {
      restApiName: "ChatBotPrivateApi",
      endpointConfiguration: {
        types: [EndpointType.PRIVATE],
        vpcEndpoints: [executeApiEndpoint]
      },
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

    cognitoAuthorizer._attachToApi(api)

    const deployment = new Deployment(this, 'Deployment', { api });

    const proxyResource = api.root.addResource("{proxy+}", {
      defaultCorsPreflightOptions: {
        statusCode: 200,
        allowOrigins: ["*"],
        allowHeaders: ["*"],
        allowMethods: ["*"],
        allowCredentials: true,
        exposeHeaders: ["*"],
        maxAge: Duration.seconds(864000)
      }
    })

    // ? GET
    proxyResource.addMethod('GET', new LambdaIntegration(handler, 
      { 
        proxy: true,
        cacheKeyParameters: ['method.request.path.proxy'],
        timeout: Duration.millis(120000)
      }),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: AuthorizationType.COGNITO,
        methodResponses:  [{ statusCode: '200', responseModels: {'application/json': Model.EMPTY_MODEL} }],
        requestParameters: {
          'method.request.path.proxy': true
        }
      }
    );

    // ? PATCH
    proxyResource.addMethod('PATCH', new LambdaIntegration(handler, 
      { 
        proxy: true,
        cacheKeyParameters: ['method.request.path.proxy'],
        timeout: Duration.millis(120000)
      }),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: AuthorizationType.COGNITO,
        methodResponses:  [{ statusCode: '200', responseModels: {'application/json': Model.EMPTY_MODEL} }],
        requestParameters: {
          'method.request.path.proxy': true
        }
      }
    );    
    // ? POST
    proxyResource.addMethod('POST', new LambdaIntegration(handler, 
      { 
        proxy: true,
        cacheKeyParameters: ['method.request.path.proxy'],
        timeout: Duration.millis(120000)
      }),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: AuthorizationType.COGNITO,
        methodResponses:  [{ statusCode: '200', responseModels: {'application/json': Model.EMPTY_MODEL} }],
        requestParameters: {
          'method.request.path.proxy': true
        }
      }
    );        
    // ? PUT
    proxyResource.addMethod('PUT', new LambdaIntegration(handler, 
      { 
        proxy: true,
        cacheKeyParameters: ['method.request.path.proxy'],
        timeout: Duration.millis(120000)
      }),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: AuthorizationType.COGNITO,
        methodResponses:  [{ statusCode: '200', responseModels: {'application/json': Model.EMPTY_MODEL} }],
        requestParameters: {
          'method.request.path.proxy': true
        }
      }
    );       
    // ? DELETE                 
    proxyResource.addMethod('DELETE', new LambdaIntegration(handler, 
      { 
        proxy: true,
        cacheKeyParameters: ['method.request.path.proxy'],
        timeout: Duration.millis(120000)
      }),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: AuthorizationType.COGNITO,
        methodResponses: [{ statusCode: '200', responseModels: {'application/json': Model.EMPTY_MODEL} }],
        requestParameters: {
          'method.request.path.proxy': true
        }
      }
    );  

    const api_endpoint = `https://${api.restApiId}.execute-api.${region}.amazonaws.com/prod`

    this.api = api;
    this.apiEndpoint = api_endpoint
    this.handler = handler;

    new CfnOutput(this, "BackendApiUrl", { value: api_endpoint });
  }
}
