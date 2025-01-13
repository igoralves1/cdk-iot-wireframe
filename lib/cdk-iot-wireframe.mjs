import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iot from "aws-cdk-lib/aws-iot";

import * as logs from "aws-cdk-lib/aws-logs";
import * as kinesisfirehose from "aws-cdk-lib/aws-kinesisfirehose";

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

    const firehoseBucket = new s3.Bucket(this, "FirehoseDataBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const firehoseRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });
    firehoseBucket.grantPut(firehoseRole);

    firehoseBucket.grantRead(firehoseRole);

    const firehoseLogGroup = new logs.LogGroup(this, "FirehoseLogGroup", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const firehoseStream = new kinesisfirehose.CfnDeliveryStream(
      this,
      "FirehoseDeliveryStream",
      {
        deliveryStreamName: "IotFirehoseDataStream",
        extendedS3DestinationConfiguration: {
          bucketArn: firehoseBucket.bucketArn,
          roleArn: firehoseRole.roleArn,
          prefix:
            "!{partitionKeyFromQuery:id}/!{timestamp:yyyy}/!{timestamp:MM}/!{timestamp:dd}/",
          errorOutputPrefix: "error/",
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 64,
          },
          compressionFormat: "GZIP",
          cloudWatchLoggingOptions: {
            enabled: true,
            logGroupName: firehoseLogGroup.logGroupName,
            logStreamName: "FirehoseStream",
          },
          fileExtension: ".json.gz",
          dynamicPartitioningConfiguration: {
            enabled: true,
          },

          processingConfiguration: {
            enabled: true,
            processors: [
              {
                type: "MetadataExtraction",
                parameters: [
                  {
                    parameterName: "MetadataExtractionQuery",
                    parameterValue: "{id: .partitionKeyFromQuery.id}",
                  },
                  {
                    parameterName: "JsonParsingEngine",
                    parameterValue: "JQ-1.6",
                  },
                ],
              },
              {
                type: "AppendDelimiterToRecord",
                parameters: [
                  {
                    parameterName: "Delimiter",
                    parameterValue: "\\n",
                  },
                ],
              },
            ],
          },
          dataFormatConversionConfiguration: {
            enabled: false,
          },
        },
      }
    );

    const iotToFirehoseRole = new iam.Role(this, "IoTToFirehoseRole", {
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
        sql: "SELECT *, topic(3) as partitionKeyFromQuery.id FROM 'firehose/dev/+'",
        ruleDisabled: false,
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
  }
}
