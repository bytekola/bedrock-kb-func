import * as cdk from "aws-cdk-lib";
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { ISubnet, IVpc, SecurityGroup, Subnet, Vpc } from 'aws-cdk-lib/aws-ec2';
import * as iam from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { Api } from "./constructs/api";
import { ApiPublishCodebuild } from "./constructs/api-publish-codebuild";
import { Auth } from "./constructs/auth";
import { BedrockCustomBotCodebuild } from "./constructs/bedrock-custom-bot-codebuild";
import { BotStore, Language } from "./constructs/bot-store";
import { Database } from "./constructs/database";
import { Embedding } from "./constructs/embedding";
import { Frontend } from "./constructs/frontend";
import { UsageAnalysis } from "./constructs/usage-analysis";
import { TIdentityProvider, identityProvider } from "./utils/identity-provider";

export interface BedrockChatStackProps extends StackProps {
  readonly envName: string;
  readonly envPrefix: string;
  readonly bedrockRegion: string;
  readonly identityProviders: TIdentityProvider[];
  readonly userPoolDomainPrefix: string;
  readonly publishedApiAllowedIpV4AddressRanges: string[];
  readonly publishedApiAllowedIpV6AddressRanges: string[];
  readonly allowedSignUpEmailDomains: string[];
  readonly autoJoinUserGroups: string[];
  readonly selfSignUpEnabled: boolean;
  readonly documentBucket: Bucket;
  readonly enableRagReplicas: boolean;
  readonly enableBedrockCrossRegionInference: boolean;
  readonly enableLambdaSnapStart: boolean;
  readonly enableBotStore: boolean;
  readonly enableBotStoreReplicas: boolean;
  readonly botStoreLanguage: Language;
  readonly tokenValidMinutes: number;
  readonly alternateDomainName: string;
  readonly hostedZoneId?: string;
  readonly devAccessIamRoleArn?: string;
  readonly domainName: string,
  readonly vpcId: string;
  readonly subnets: string[];
  readonly lb_subnets: string[];
  readonly s3VpcEndpoint: string;
  readonly s3EndpointIps: string[];
  readonly certificateArn: string;
  readonly executeApiEndpointId: string;
  readonly albIngressCidr: string;
  readonly openSearchVpcEndpoint: string;
}

export class BedrockChatStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BedrockChatStackProps) {
    super(scope, id, {
      description: "Bedrock Chat Stack (uksb-1tupboc46)",
      ...props,
    });

    const vpc: IVpc = Vpc.fromLookup(this, 'PrivateVpc', {
      vpcId: props.vpcId,
    }); 
    
    const subnets: ISubnet[] = []
    for (const _subnet of props.subnets) {
      const subnet = Subnet.fromSubnetId(this, _subnet, _subnet);
      subnets.push(subnet)
    }
    
    const sepHyphen = props.envPrefix ? "-" : "";
    const idp = identityProvider(props.identityProviders);

    const functionSecurityGroup = new SecurityGroup(this, 'FunctionSecurityGroup', {
      vpc: vpc,
      securityGroupName: "bedrock-function-default-sg",
      description: 'Allow HTTP and SSH access',
      allowAllOutbound: true
    });
    
    // Bucket for source code
    const sourceBucket = new Bucket(this, "SourceBucketForCodeBuild", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: false
    });

    // CodeBuild used for api publication
    const apiPublishCodebuild = new ApiPublishCodebuild(this, "ApiPublishCodebuild", {
        sourceBucket,
        envName: props.envName,
        envPrefix: props.envPrefix,
        bedrockRegion: props.bedrockRegion,
        vpc: vpc,
        subnets: subnets,
        executeApiEndpointId: props.executeApiEndpointId
    });

    // CodeBuild used for KnowledgeBase
    const bedrockCustomBotCodebuild = new BedrockCustomBotCodebuild(this, "BedrockKnowledgeBaseCodebuild", {
        sourceBucket,
        envName: props.envName,
        envPrefix: props.envPrefix,
        bedrockRegion: props.bedrockRegion,
        vpc: vpc,
        subnets: subnets
    });

    //? Frontend
    const frontend = new Frontend(this, "Frontend", {
      alternateDomainName: props.domainName,
      vpc: vpc,
      subnets: subnets,
      lb_subnets: props.lb_subnets,
      s3VpcEndpoint: props.s3VpcEndpoint,
      s3EndpointIps: props.s3EndpointIps,
      certificateArn: props.certificateArn,
      albIngressCidr: props.albIngressCidr
    });

    const auth = new Auth(this, "Auth", {
      origin: frontend.getOrigin(),
      userPoolDomainPrefixKey: props.userPoolDomainPrefix,
      idp,
      allowedSignUpEmailDomains: props.allowedSignUpEmailDomains,
      autoJoinUserGroups: props.autoJoinUserGroups,
      selfSignUpEnabled: props.selfSignUpEnabled,
      tokenValidity: Duration.minutes(props.tokenValidMinutes),
      vpc: vpc,
      subnets: subnets
    });

    

    const largeMessageBucket = new Bucket(this, "LargeMessageBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: false
    });

    const database = new Database(this, "Database", {
      pointInTimeRecovery: true,
    });

    let botStore = undefined;
    if (props.enableBotStore) {
      botStore = new BotStore(this, "BotStore", {
        envPrefix: props.envPrefix,
        botTable: database.botTable,
        conversationTable: database.conversationTable,
        language: props.botStoreLanguage,
        enableBotStoreReplicas: props.enableBotStoreReplicas,
        subnets: props.subnets,
        vpcId: props.vpcId,
        openSearchVpcEndpoint: props.openSearchVpcEndpoint
      });
    }

    const usageAnalysis = new UsageAnalysis(this, "UsageAnalysis", {
      envPrefix: props.envPrefix,
      sourceDatabase: database,
      vpc: vpc,
      subnets: subnets
    });

    const backendApi = new Api(this, "BackendApi", {
      envName: props.envName,
      envPrefix: props.envPrefix,
      database,
      auth,
      bedrockRegion: props.bedrockRegion,
      documentBucket: props.documentBucket,
      apiPublishProject: apiPublishCodebuild.project,
      bedrockCustomBotProject: bedrockCustomBotCodebuild.project,
      usageAnalysis,
      largeMessageBucket,
      enableBedrockCrossRegionInference:
        props.enableBedrockCrossRegionInference,
      enableLambdaSnapStart: props.enableLambdaSnapStart,
      openSearchEndpoint: botStore?.openSearchEndpoint,
      vpc: vpc,
      subnets: subnets,
      executeApiEndpointId: props.executeApiEndpointId
    });

    props.documentBucket.grantReadWrite(backendApi.handler);
    botStore?.addDataAccessPolicy(
      props.envPrefix,
      "DAPolicyApiHandler",
      backendApi.handler.role!,
      ["aoss:DescribeCollectionItems"],
      ["aoss:DescribeIndex", "aoss:ReadDocument"]
    );

    if (props.devAccessIamRoleArn) {
      // Access to BotStore
      botStore?.addDataAccessPolicy(
        props.envPrefix,
        "DAPolicyDevAccess",
        iam.Role.fromRoleArn(this, "DevAccessIamRoleArn", props.devAccessIamRoleArn),
        [
          "aoss:DescribeCollectionItems",
          "aoss:CreateCollectionItems",
          "aoss:DeleteCollectionItems",
          "aoss:UpdateCollectionItems"
        ],
        [
          "aoss:DescribeIndex",
          "aoss:ReadDocument",
          "aoss:WriteDocument",
          "aoss:CreateIndex",
          "aoss:DeleteIndex",
          "aoss:UpdateIndex"
        ]
      );
    }

    const embedding = new Embedding(this, "Embedding", {
      bedrockRegion: props.bedrockRegion,
      database,
      documentBucket: props.documentBucket,
      bedrockCustomBotProject: bedrockCustomBotCodebuild.project,
      enableRagReplicas: props.enableRagReplicas,
      vpc: vpc,
      subnets: subnets
    });
  
    const region = Stack.of(auth.userPool).region;
    const frontend_outputs = {
      VITE_APP_API_ENDPOINT: backendApi.apiEndpoint,
      VITE_APP_USER_POOL_ID: auth.userPool.userPoolId,
      VITE_APP_USER_POOL_CLIENT_ID: auth.client.userPoolClientId, 
      VITE_APP_REGION: region,
      VITE_APP_USE_STREAMING: "false",
      VITE_APP_REDIRECT_SIGNIN_URL: `https://${props.domainName}`,
      VITE_APP_REDIRECT_SIGNOUT_URL: `https://${props.domainName}`, 
      VITE_APP_COGNITO_DOMAIN: `${props.userPoolDomainPrefix}.auth.${region}.amazoncognito.com`,
      VITE_APP_SOCIAL_PROVIDERS: idp.getSocialProviders(),
      VITE_APP_CUSTOM_PROVIDER_ENABLED: idp.checkCustomProviderEnabled().toString()
    }

    for (const [key, value] of Object.entries(frontend_outputs)) {
      const output_key = key.split("_").join("")
  
      new CfnOutput(this, key, {
        key: output_key,
        value: value
      });
    }
    
    new CfnOutput(this, "FunctionDefaultSG", {
      key: "FunctionDefaultSG",
      value: functionSecurityGroup.securityGroupId,
    });

    //? Outputs
    new CfnOutput(this, "DocumentBucketName", {
      value: props.documentBucket.bucketName,
    });
    new CfnOutput(this, "FrontendURL", {
      value: frontend.getOrigin(),
    });
    new CfnOutput(this, "ConversationTableNameV3", {
      value: database.conversationTable.tableName,
      exportName: `${props.envPrefix}${sepHyphen}BedrockClaudeChatConversationTableName`,
    });
    new CfnOutput(this, "BotTableNameV3", {
      value: database.botTable.tableName,
      exportName: `${props.envPrefix}${sepHyphen}BedrockClaudeChatBotTableNameV3`,
    });
    new CfnOutput(this, "TableAccessRoleArn", {
      value: database.tableAccessRole.roleArn,
      exportName: `${props.envPrefix}${sepHyphen}BedrockClaudeChatTableAccessRoleArn`,
    });
    new CfnOutput(this, "LargeMessageBucketName", {
      value: largeMessageBucket.bucketName,
      exportName: `${props.envPrefix}${sepHyphen}BedrockClaudeChatLargeMessageBucketName`,
    });
  }
}
