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

    // Create Thing Lambda

    const thingCreationLambda = new lambda.Function(
      this,
      "ThingCreationLambda",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "thingCreationHandler.handler",
        environment: {
          REGION: this.region,
        },
      }
    );

    thingCreationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iot:CreateThing",
          "iot:AttachThingPrincipal",
          "iot:DescribeThing",
          "iot:AddThingToThingGroup",
        ],
        resources: ["*"],
      })
    );

    // JIT Task

    const firstConnectionBucket = new s3.Bucket(this, "FirstConnectionBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const certificateActivationLambda = new lambda.Function(
      this,
      "CertificateActivationLambda",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "certificateActivation.handler",
        environment: {
          REGION: this.region,
          BUCKET_NAME: firstConnectionBucket.bucketName,
          THING_CREATION_LAMBDA_NAME: thingCreationLambda.functionName,
        },
      }
    );

    certificateActivationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iot:UpdateCertificate",
          "iot:CreatePolicy",
          "iot:AttachPolicy",
          "iot:DeletePolicy",
          "iot:ListPolicyPrincipals",
          "iot:DetachPolicy",
          "iot:ListTargetsForPolicy",
          "iot:DescribeCertificate",
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "lambda:InvokeFunction",
        ],
        resources: ["*"],
      })
    );

    firstConnectionBucket.grantPut(certificateActivationLambda);

    const iotCertActivationRule = new iot.CfnTopicRule(
      this,
      "IotCertActivationRule",
      {
        ruleName: "cert_activation_rule",
        topicRulePayload: {
          ruleDisabled: false,
          sql: "SELECT * FROM '$aws/events/certificates/registered/+'",
          actions: [
            {
              lambda: {
                functionArn: certificateActivationLambda.functionArn,
              },
            },
          ],
        },
      }
    );

    new lambda.CfnPermission(this, "AllowIotToInvokeCertActivationLambda", {
      action: "lambda:InvokeFunction",
      functionName: certificateActivationLambda.functionName,
      principal: "iot.amazonaws.com",
      sourceArn: iotCertActivationRule.attrArn,
    });

    const deviceDataBucket = new s3.Bucket(this, "DeviceDataBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const deviceDataHandlerLambda = new lambda.Function(
      this,
      "DeviceDataHandlerLambda",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "deviceDataHandler.handler",
        environment: {
          BUCKET_NAME: deviceDataBucket.bucketName,
        },
      }
    );

    deviceDataBucket.grantPut(deviceDataHandlerLambda);

    const iotDeviceDataRule = new iot.CfnTopicRule(this, "IotDeviceDataRule", {
      ruleName: "device_data_rule",
      topicRulePayload: {
        ruleDisabled: false,
        sql: "SELECT topic(2) as deviceId, * FROM 'devices/+'",
        actions: [
          {
            lambda: {
              functionArn: deviceDataHandlerLambda.functionArn,
            },
          },
        ],
      },
    });

    new lambda.CfnPermission(this, "AllowIotToInvokeDeviceDataLambda", {
      action: "lambda:InvokeFunction",
      functionName: deviceDataHandlerLambda.functionName,
      principal: "iot.amazonaws.com",
      sourceArn: iotDeviceDataRule.attrArn,
    });

    const activateDeviceLambda = new lambda.Function(
      this,
      "ActivateDeviceHandlerLambda",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "activateDeviceHandler.handler",
        environment: {
          BUCKET_NAME: deviceDataBucket.bucketName,
          REGION: this.region,
          ACCOUNT_ID: cdk.Stack.of(this).account,
        },
      }
    );

    const activateDeviceRule = new iot.CfnTopicRule(
      this,
      "ActivateDeviceRule",
      {
        ruleName: "activate_device_rule",
        topicRulePayload: {
          ruleDisabled: false,
          sql: "SELECT *, topic(2) as certificateId, topic(3) as deviceId FROM 'activate-device/+/+'",
          actions: [
            {
              lambda: {
                functionArn: activateDeviceLambda.functionArn,
              },
            },
          ],
        },
      }
    );

    new lambda.CfnPermission(this, "AllowIotToInvokeActivateDeviceLambda", {
      action: "lambda:InvokeFunction",
      functionName: activateDeviceLambda.functionName,
      principal: "iot.amazonaws.com",
      sourceArn: activateDeviceRule.attrArn,
    });
    activateDeviceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iot:UpdateCertificate",
          "iot:CreatePolicy",
          "iot:AttachPolicy",
          "iot:DeletePolicy",
          "iot:ListPolicyPrincipals",
          "iot:DetachPolicy",
          "iot:ListTargetsForPolicy",
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
        ],
        resources: ["*"],
      })
    );

    // Lambdas to Create a thing & Delete a thing

    // 1) CreateThingHandler Lambda
    const createThingLambda = new lambda.Function(this, "CreateThingLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda"),
      handler: "createThingHandler.handler",
      environment: {
        REGION: this.region,
        ACCOUNT_ID: cdk.Stack.of(this).account,
      },
    });

    createThingLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:CreateThing", "iot:AttachThingPrincipal"],
        resources: ["*"],
      })
    );

    const createThingRule = new iot.CfnTopicRule(this, "CreateThingRule", {
      ruleName: "create_thing_rule",
      topicRulePayload: {
        ruleDisabled: false,
        sql: "SELECT topic(2) as deviceId, topic(3) as certId FROM 'creatething/+/+'", // "creatething/<deviceID>/<certID>"
        actions: [
          {
            lambda: {
              functionArn: createThingLambda.functionArn,
            },
          },
        ],
      },
    });

    new lambda.CfnPermission(this, "AllowIotToInvokeCreateThingLambda", {
      action: "lambda:InvokeFunction",
      functionName: createThingLambda.functionName,
      principal: "iot.amazonaws.com",
      sourceArn: createThingRule.attrArn,
    });

    // 2) DeleteThingHandler Lambda
    const deleteThingLambda = new lambda.Function(this, "DeleteThingLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda"),
      handler: "deleteThingHandler.handler",
      environment: {
        REGION: this.region,
        ACCOUNT_ID: cdk.Stack.of(this).account,
      },
    });

    deleteThingLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iot:DescribeThing",
          "iot:ListThingPrincipals",
          "iot:DetachThingPrincipal",
          "iot:DeleteThing",
        ],
        resources: ["*"],
      })
    );

    const deleteThingRule = new iot.CfnTopicRule(this, "DeleteThingRule", {
      ruleName: "delete_thing_rule",
      topicRulePayload: {
        ruleDisabled: false,
        sql: "SELECT topic(2) as deviceId FROM 'destroything/+'", // "destroything/<deviceID>"
        actions: [
          {
            lambda: {
              functionArn: deleteThingLambda.functionArn,
            },
          },
        ],
      },
    });

    new lambda.CfnPermission(this, "AllowIotToInvokeDeleteThingLambda", {
      action: "lambda:InvokeFunction",
      functionName: deleteThingLambda.functionName,
      principal: "iot.amazonaws.com",
      sourceArn: deleteThingRule.attrArn,
    });
  }
}
