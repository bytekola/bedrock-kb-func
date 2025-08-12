#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { BedrockChatStack } from "../lib/bedrock-chat-stack";
import { BedrockRegionResourcesStack } from "../lib/bedrock-region-resources";
import { getBedrockChatParameters } from "../lib/utils/parameter-models";
import { bedrockChatParams } from "../parameter";

const app = new cdk.App();
const params = getBedrockChatParameters(app, app.node.tryGetContext("envName"), bedrockChatParams);
const sepHyphen = params.envPrefix ? "-" : "";

const bedrockRegionResources = new BedrockRegionResourcesStack(app, `${params.envPrefix}${sepHyphen}BedrockRegionResourcesStack`, {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: params.bedrockRegion,
    },
    crossRegionReferences: false,
});

const chat = new BedrockChatStack(app, `${params.envPrefix}${sepHyphen}BedrockChatStack`, {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    envName: params.envName,
    envPrefix: params.envPrefix,
    crossRegionReferences: false,
    bedrockRegion: params.bedrockRegion,
    identityProviders: params.identityProviders,
    userPoolDomainPrefix: params.userPoolDomainPrefix,
    publishedApiAllowedIpV4AddressRanges:
    params.publishedApiAllowedIpV4AddressRanges,
    publishedApiAllowedIpV6AddressRanges:
    params.publishedApiAllowedIpV6AddressRanges,
    allowedSignUpEmailDomains: params.allowedSignUpEmailDomains,
    autoJoinUserGroups: params.autoJoinUserGroups,
    selfSignUpEnabled: params.selfSignUpEnabled,
    documentBucket: bedrockRegionResources.documentBucket,
    enableRagReplicas: params.enableRagReplicas,
    enableBedrockCrossRegionInference: params.enableBedrockCrossRegionInference,
    enableLambdaSnapStart: params.enableLambdaSnapStart,
    alternateDomainName: params.alternateDomainName,
    hostedZoneId: params.hostedZoneId,
    enableBotStore: params.enableBotStore,
    enableBotStoreReplicas: params.enableBotStoreReplicas,
    botStoreLanguage: params.botStoreLanguage,
    tokenValidMinutes: params.tokenValidMinutes,
    devAccessIamRoleArn: params.devAccessIamRoleArn,
    domainName: params.domainName,
    vpcId: params.vpcId,
    subnets: params.subnets,
    lb_subnets: params.lb_subnets,
    s3VpcEndpoint: params.s3VpcEndpoint,
    s3EndpointIps: params.s3EndpointIps,
    certificateArn: params.certificateArn,
    executeApiEndpointId: params.executeApiEndpointId,
    albIngressCidr: params.albIngressCidr,
    openSearchVpcEndpoint: params.openSearchVpcEndpoint
});

chat.addDependency(bedrockRegionResources);

cdk.Tags.of(app).add("CDKEnvironment", params.envName);
