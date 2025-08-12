import { CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { ISubnet, IVpc, Peer, Port, SecurityGroup, Subnet } from 'aws-cdk-lib/aws-ec2';
import { ApplicationListener, ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, ListenerAction, ListenerCertificate, ListenerCondition, TargetType } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { IpTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { AnyPrincipal, Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { Idp } from "../utils/identity-provider";
import { Auth } from "./auth";

export interface FrontendProps {
  readonly accessLogBucket?: IBucket;
  readonly alternateDomainName: string;
  readonly vpc: IVpc;
  readonly subnets: ISubnet[];
  readonly lb_subnets: string[];
  readonly s3VpcEndpoint: string;
  readonly s3EndpointIps: string[];
  readonly certificateArn: string;
  readonly albIngressCidr: string;
}

export class Frontend extends Construct {
  private readonly certificate: ICertificate;
  private readonly alternateDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendProps) {
    super(scope, id);

    this.alternateDomainName = props.alternateDomainName

    const lb_subnets: ISubnet[] = []
    for (const _subnet of props.lb_subnets) {
      const subnet = Subnet.fromSubnetId(this, _subnet, _subnet);
      lb_subnets.push(subnet)
    }

    const frontendBuildBucket = new Bucket(this, "FrontendBuildBucket", {
      bucketName: props.alternateDomainName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: false
    });

    frontendBuildBucket.addToResourcePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new AnyPrincipal()],
      actions: ['s3:GetObject'],
      resources: [
        `arn:aws:s3:::${props.alternateDomainName}/*`
      ],
      conditions: {
        StringEquals: {
          "aws:SourceVpce": props.s3VpcEndpoint
        }
      }
    }))

    //? Alb
    const albSecurityGroup = new SecurityGroup(this, 'AlbSecurityGroup', { vpc: props.vpc, allowAllOutbound: true, disableInlineRules: true  });

    albSecurityGroup.addIngressRule(Peer.ipv4(props.albIngressCidr), Port.tcp(443))

    // addIngressRul
    const alb = new ApplicationLoadBalancer(this, 'LB', {
      vpc: props.vpc,
      vpcSubnets: {
        subnets: lb_subnets
      },
      internetFacing: false,
      securityGroup: albSecurityGroup
    });

    const alb_tg = new ApplicationTargetGroup(this, "AlbTargetGroup", {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      targetType: TargetType.IP,
      vpc: props.vpc,
      healthCheck: {
        healthyHttpCodes: "200,307,405"
      }
    })

    for (const ip of props.s3EndpointIps) {
      const target_ip = new IpTarget(ip, 443, "all")
      alb_tg.addTarget(target_ip)
    }

    const alb_listener = new ApplicationListener(this, "AlbListener", {
      loadBalancer: alb,
      port: 443,
      certificates: [ListenerCertificate.fromArn(props.certificateArn)],
      defaultAction: ListenerAction.fixedResponse(503, {
        contentType: 'text/plain',
        messageBody: 'Access denied'
      })
    })

    alb_listener.addTargetGroups("LbTargetAttachment", {
      targetGroups: [alb_tg]
    })

    alb_listener.addAction('S3BucketRedirect', {
      priority: 10,
      conditions: [
        ListenerCondition.pathPatterns(['*/']),
        ListenerCondition.hostHeaders([props.alternateDomainName])
      ],
      action: ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '#{port}',
        host: '#{host}',
        path: '/#{path}index.html',
        query: '#{query}',
        permanent: true
      }),
    });

    alb_listener.addAction('S3BucketForwardToEndpoint', {
      priority: 15,
      conditions: [
        ListenerCondition.hostHeaders([props.alternateDomainName]),
      ],
      action: ListenerAction.forward([alb_tg]),
    });
    //? ------
    // alb.loadBalancerDnsName
    new CfnOutput(this, "LoadBalancerDnsName", {
      key: "LoadBalancerDnsName",
      value: alb.loadBalancerDnsName,
    });

    if (this.alternateDomainName) {
      new CfnOutput(this, 'AlternateDomain', {
        value: this.alternateDomainName,
        description: 'Alternate domain name for the CloudFront distribution',
      });
    }

    if (this.certificate) {
      new CfnOutput(this, 'CertificateArn', {
        key: "CertificateArn",
        value: this.certificate.certificateArn,
        description: 'ARN of the ACM certificate',
      });
    }
  }

  private getDomainZoneName(domainName: string): string {
    const parts = domainName.split('.');
    if (parts.length <= 2) return domainName;
    return parts.slice(-2).join('.');
  }

  getOrigin(): string {
    return `https://${this.alternateDomainName}`;
  }

  buildViteApp({
    backendApiEndpoint,
    webSocketApiEndpoint,
    auth,
    idp,
    alternateDomainName
  }: {
    backendApiEndpoint: string;
    webSocketApiEndpoint: string;
    userPoolDomainPrefix: string;
    alternateDomainName: string;
    auth: Auth;
    idp: Idp;
  }) {
    const region = Stack.of(auth.userPool).region;
    const cognitoDomain = `${alternateDomainName.split(".")[0]}.auth.${region}.amazoncognito.com/`;
 
    const outputs = {
      VITE_APP_API_ENDPOINT: backendApiEndpoint,
      VITE_APP_WS_ENDPOINT: webSocketApiEndpoint,
      VITE_APP_USER_POOL_ID: auth.userPool.userPoolId,
      VITE_APP_USER_POOL_CLIENT_ID: auth.client.userPoolClientId, 
      VITE_APP_REGION: region,
      VITE_APP_USE_STREAMING: "false",
      VITE_APP_REDIRECT_SIGNIN_URL: `https://${alternateDomainName}`,
      VITE_APP_REDIRECT_SIGNOUT_URL: `https://${alternateDomainName}`, 
      VITE_APP_COGNITO_DOMAIN: cognitoDomain,
        VITE_APP_SOCIAL_PROVIDERS: idp.getSocialProviders(),
        VITE_APP_CUSTOM_PROVIDER_ENABLED: idp
          .checkCustomProviderEnabled()
          .toString(),
    }
    if (idp.isExist()) {
      new CfnOutput(this, "CognitoDomain", { value: cognitoDomain });
      new CfnOutput(this, "SocialProviders", {
        value: idp.getSocialProviders(),
      });
    }
    return outputs

  }

  /**
   * CloudFront does not support access log delivery in the following regions
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html#access-logs-choosing-s3-bucket
   */
  private shouldSkipAccessLogging(): boolean {
    const skipLoggingRegions = [
      "af-south-1",
      "ap-east-1",
      "ap-south-2",
      "ap-southeast-3",
      "ap-southeast-4",
      "ca-west-1",
      "eu-south-1",
      "eu-south-2",
      "eu-central-2",
      "il-central-1",
      "me-central-1",
    ];
    return skipLoggingRegions.includes(Stack.of(this).region);
  }
}
