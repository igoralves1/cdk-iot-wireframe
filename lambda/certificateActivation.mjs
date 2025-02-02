import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import iotPkg from "@aws-sdk/client-iot";

const {
  IoTClient,
  UpdateCertificateCommand,
  AttachPolicyCommand,
  CreatePolicyCommand,
} = iotPkg;

const s3Client = new S3Client({ region: process.env.REGION });
const iotClient = new IoTClient({ region: process.env.REGION });

export async function handler(event) {
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
          certificateId: certificateId,
          newStatus: "ACTIVE",
        })
      );
      console.log(`Certificate ${certificateId} status updated to ACTIVE.`);

      const certificateArn = `arn:aws:iot:${region}:${awsAccountId}:cert/${certificateId}`;

      const policyDocument = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "iot:Connect",
              "iot:Publish",
              "iot:Subscribe",
              "iot:Receive",
              "iot:DescribeEndpoint",
            ],
            Resource: "*",
          },
        ],
      };
      const createPolicyCmd = new CreatePolicyCommand({
        policyName: `Policy_${certificateId}`,
        policyDocument: JSON.stringify(policyDocument),
      });

      const policyResult = await iotClient.send(createPolicyCmd);

      const attachPolicyCmd = new AttachPolicyCommand({
        policyName: policyResult.policyName,
        target: certificateArn,
      });
      await iotClient.send(attachPolicyCmd);

      console.log(
        `Policy ${policyName} attached to certificate ${certificateId}.`
      );
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

    return { status: "success" };
  } catch (error) {
    console.error("Error processing certificate activation event:", error);
    throw error;
  }
}
