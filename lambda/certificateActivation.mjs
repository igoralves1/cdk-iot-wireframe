import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import iotPkg from "@aws-sdk/client-iot";

const {
  IoTClient,
  UpdateCertificateCommand,
  AttachPolicyCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
  DetachPolicyCommand,
  ListTargetsForPolicyCommand,
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
      const policyName = `Policy__${certificateId}`;

      try {
        const targetsResponse = await iotClient.send(
          new ListTargetsForPolicyCommand({
            policyName: policyName,
          })
        );

        for (const target of targetsResponse.targets || []) {
          await iotClient.send(
            new DetachPolicyCommand({
              policyName: policyName,
              target: target,
            })
          );
          console.log(`Detached policy ${policyName} from target ${target}`);
        }

        await iotClient.send(
          new DeletePolicyCommand({
            policyName: policyName,
          })
        );
        console.log(`Deleted existing policy ${policyName}.`);
      } catch (error) {
        if (error.name === "ResourceNotFoundException") {
          console.log(
            `Policy ${policyName} does not exist. Proceeding to create.`
          );
        } else {
          throw error;
        }
      }

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

      await iotClient.send(
        new CreatePolicyCommand({
          policyName: policyName,
          policyDocument: JSON.stringify(policyDocument),
        })
      );
      console.log(`Created policy ${policyName}.`);

      await iotClient.send(
        new AttachPolicyCommand({
          policyName: policyName,
          target: certificateArn,
        })
      );
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
