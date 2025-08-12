import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";


interface BedrockRegionResourcesStackProps extends StackProps {
}

export class BedrockRegionResourcesStack extends Stack {
  readonly documentBucket: Bucket

  constructor(
    scope: Construct,
    id: string,
    props: BedrockRegionResourcesStackProps
  ) {
    super(scope, id, props);

    const prefix = Stack.of(this).region

    this.documentBucket = new Bucket(this, `${prefix}DocumentBucket`, {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: false
    });

    new CfnOutput(this, "DocumentBucketName", {
      value: this.documentBucket.bucketName,
    });

  } 
}
