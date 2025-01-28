import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iot from "aws-cdk-lib/aws-iot";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";

export class CdkIotWireframe extends cdk.Stack {
  /**
   * @param {cdk.App} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const IotCertificateHandlerLambda = new lambda.Function(
      this,
      "IotCertificateHandlerLambda",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "index.handler",
        environment: {
          REGION: this.region,
        },
      }
    );

    IotCertificateHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iot:CreateKeysAndCertificate",
          "iot:CreatePolicy",
          "iot:AttachPolicy",
          "iot:UpdateCertificate",
          "iot:Publish",
          "iot:DescribeEndpoint",
        ],
        resources: ["*"],
      })
    );

    const api = new apigateway.RestApi(this, "IotCertificateApi", {
      restApiName: "IOT Certificate API",
      description: "API for creating and activating IoT certificates",
    });

    const certificateResource = api.root.addResource("certificate");
    certificateResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(IotCertificateHandlerLambda)
    );

    const uploadsBucket = new s3.Bucket(this, "UploadsBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const UploadPayloadLambda = new lambda.Function(
      this,
      "UploadPayloadLambda",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "uploadHandler.handler",
        environment: {
          REGION: this.region,
          BUCKET_NAME: uploadsBucket.bucketName,
        },
      }
    );

    uploadsBucket.grantPut(UploadPayloadLambda);

    const iotRule = new iot.CfnTopicRule(this, "KinesisTestIoTRule", {
      ruleName: "kinesis_test_rule",
      topicRulePayload: {
        ruleDisabled: false,

        sql: "SELECT * FROM 'kinesis/test'",
        actions: [
          {
            lambda: {
              functionArn: UploadPayloadLambda.functionArn,
            },
          },
        ],
      },
    });

    new lambda.CfnPermission(this, "AllowIotToInvokeUploadLambda", {
      action: "lambda:InvokeFunction",
      functionName: UploadPayloadLambda.functionName,
      principal: "iot.amazonaws.com",
      sourceArn: iotRule.attrArn,
    });
    const firehoseBucket = new s3.Bucket(this, "IotTestS3Bucket", {
      bucketName: "iot-eerrww-s3",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const firehoseRole = new iam.Role(this, "FirehoseS3Role", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });

    firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
        ],
        resources: [
          firehoseBucket.bucketArn,
          firehoseBucket.arnForObjects("*"),
        ],
      })
    );

    const firehoseStream = new firehose.CfnDeliveryStream(
      this,
      "IotFirehoseToS3",
      {
        deliveryStreamName: "iot-firehose-to-s3",
        deliveryStreamType: "DirectPut",
        s3DestinationConfiguration: {
          bucketArn: firehoseBucket.bucketArn,
          roleArn: firehoseRole.roleArn,
          compressionFormat: "GZIP",
          prefix: "deviceId=!{partitionKey}/!{timestamp:yyyy-MM-dd}/",
          errorOutputPrefix: "error/",
        },
      }
    );

    const iotToFirehoseRole = new iam.Role(this, "IotToFirehoseRole", {
      assumedBy: new iam.ServicePrincipal("iot.amazonaws.com"),
    });

    iotToFirehoseRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
        resources: [firehoseStream.attrArn],
      })
    );

    const iotFirehoseRule = new iot.CfnTopicRule(this, "IotFirehoseRule", {
      ruleName: "iot_firehose_rule",
      topicRulePayload: {
        ruleDisabled: false,
        sql: "SELECT topic(2) as partitionKey, * FROM 'testfirehose/#' WHERE (topic(2) = '100' OR topic(2) = '101' OR topic(2) = '102')",
        actions: [
          {
            firehose: {
              deliveryStreamName: firehoseStream.deliveryStreamName,
              roleArn: iotToFirehoseRole.roleArn,
              separator: "\n",
            },
          },
        ],
      },
    });

    const jitpProvisioningRole = new iam.Role(this, "JITPProvisioningRole", {
      assumedBy: new iam.ServicePrincipal("iot.amazonaws.com"),
      description: "Role assumed by AWS IoT for JITP provisioning actions",
    });

    jitpProvisioningRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSIoTThingsRegistration"
      )
    );

    jitpProvisioningRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "iot:CreateThing",
          "iot:CreatePolicy",
          "iot:AttachPolicy",
          "iot:AttachThingPrincipal",
          "iot:RegisterThing",
          "iot:UpdateCertificate",
          "iot:DescribeCertificate",
          "iot:DescribeEndpoint",
          "iot:ListPolicies",
        ],
        resources: ["*"],
      })
    );

    const provisioningTemplate = {
      Parameters: {
        "AWS::IoT::Certificate::CommonName": { Type: "String" },
        "AWS::IoT::Certificate::Country": { Type: "String" },
        "AWS::IoT::Certificate::Id": { Type: "String" },
      },
      Resources: {
        thing: {
          Type: "AWS::IoT::Thing",
          Properties: {
            ThingName: { Ref: "AWS::IoT::Certificate::CommonName" },
            AttributePayload: {
              version: "v1",
              country: { Ref: "AWS::IoT::Certificate::Country" },
            },
          },
        },
        certificate: {
          Type: "AWS::IoT::Certificate",
          Properties: {
            CertificateId: { Ref: "AWS::IoT::Certificate::Id" },
            Status: "ACTIVE",
          },
        },
        policy: {
          Type: "AWS::IoT::Policy",
          Properties: {
            PolicyDocument: JSON.stringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: "iot:*",
                  Resource: "*",
                },
              ],
            }),
          },
        },
      },
    };

    const templateBodyString = JSON.stringify(provisioningTemplate);

    new iot.CfnProvisioningTemplate(this, "MyJITPProvisioningTemplate", {
      templateName: "MyJITPProvisioningTemplate",
      provisioningRoleArn: jitpProvisioningRole.roleArn,
      enabled: true,
      templateType: "JITP",
      allowAutoRegistration: true,
      templateBody: templateBodyString,
      description: "Example JITP template created via AWS CDK",
    });
  }
}
