import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import iotPkg from "@aws-sdk/client-iot";
import forge from "node-forge";

const {
  IoTClient,
  UpdateCertificateCommand,
  DescribeCertificateCommand,
  AttachPolicyCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
  DetachPolicyCommand,
  ListTargetsForPolicyCommand,
} = iotPkg;

const s3Client = new S3Client({ region: process.env.REGION });
const iotClient = new IoTClient({ region: process.env.REGION });
const lambdaClient = new LambdaClient({ region: process.env.REGION });

export const handler = async (event) => {
  console.log(
    "Received certificate registration event:",
    JSON.stringify(event, null, 2)
  );

  try {
    const { certificateId, certificateStatus, awsAccountId } = event;
    const region = process.env.REGION;
    const bucketName = process.env.BUCKET_NAME;

    if (!certificateId) {
      throw new Error("Missing certificateId in event payload.");
    }

    if (certificateStatus === "PENDING_ACTIVATION") {
      console.log(`Activating certificate ${certificateId}`);

      await iotClient.send(
        new UpdateCertificateCommand({
          certificateId,
          newStatus: "ACTIVE",
        })
      );
      console.log(`Certificate ${certificateId} status updated to ACTIVE.`);

      const describeResp = await iotClient.send(
        new DescribeCertificateCommand({ certificateId })
      );
      const certDescription = describeResp.certificateDescription || {};
      const { certificatePem } = certDescription;

      if (!certificatePem) {
        throw new Error(
          `Could not retrieve certificate PEM for certificateId ${certificateId}`
        );
      }
      const forgeCert = forge.pki.certificateFromPem(certificatePem);
      const subjectCN = forgeCert.subject.getField("CN")
        ? forgeCert.subject.getField("CN").value
        : null;

      if (!subjectCN) {
        throw new Error(
          `No CN (Common Name) found in certificate subject. Cannot extract deviceId.`
        );
      }
      const deviceId = subjectCN;
      console.log(`Extracted deviceId (CN) from cert: ${deviceId}`);

      const certificateArn = `arn:aws:iot:${region}:${awsAccountId}:cert/${certificateId}`;
      const policyName = `Policy__${certificateId}`;

      try {
        const targetsResponse = await iotClient.send(
          new ListTargetsForPolicyCommand({ policyName })
        );
        for (const target of targetsResponse.targets || []) {
          await iotClient.send(
            new DetachPolicyCommand({
              policyName,
              target,
            })
          );
          console.log(`Detached policy ${policyName} from target ${target}`);
        }

        await iotClient.send(new DeletePolicyCommand({ policyName }));
        console.log(`Deleted existing policy ${policyName}.`);
      } catch (error) {
        if (error.name === "ResourceNotFoundException") {
          console.log(
            `Policy ${policyName} does not exist yet; proceeding to create.`
          );
        } else {
          throw error;
        }
      }
      const restrictedPolicy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["iot:Connect", "iot:DescribeEndpoint"],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: ["iot:Publish", "iot:Receive"],
            Resource: `arn:aws:iot:${region}:${awsAccountId}:topic/devices/${deviceId}`,
          },
          {
            Effect: "Allow",
            Action: ["iot:Subscribe"],
            Resource: `arn:aws:iot:${region}:${awsAccountId}:topicfilter/devices/${deviceId}`,
          },
        ],
      };

      await iotClient.send(
        new CreatePolicyCommand({
          policyName,
          policyDocument: JSON.stringify(restrictedPolicy),
        })
      );
      console.log(
        `Created restricted policy ${policyName} for device ${deviceId}.`
      );

      await iotClient.send(
        new AttachPolicyCommand({
          policyName,
          target: certificateArn,
        })
      );
      console.log(
        `Policy ${policyName} attached to certificate ${certificateId}.`
      );

      const thingCreationPayload = {
        deviceId,
        certificateArn,
      };
      console.log(
        "Invoking ThingCreationLambda with payload:",
        thingCreationPayload
      );

      const res = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: process.env.THING_CREATION_LAMBDA_NAME,
          InvocationType: "RequestResponse",
          Payload: Buffer.from(JSON.stringify(thingCreationPayload)),
        })
      );
      console.log("Successfully invoked ThingCreationLambda : ", res);
    } else {
      console.log(
        `Certificate ${certificateId} is in state "${certificateStatus}". No action taken.`
      );
    }

    const s3Key = `firstconnection/${certificateId}.json`;
    const payload = JSON.stringify(event);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: payload,
        ContentType: "application/json",
      })
    );
    console.log(`Event payload stored in S3 at s3://${bucketName}/${s3Key}.`);

    return {
      status: "success",
      certificateId,
    };
  } catch (error) {
    console.error("Error processing certificate activation event:", error);
    throw error;
  }
};
