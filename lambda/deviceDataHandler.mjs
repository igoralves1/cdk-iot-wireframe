import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.REGION });

export const handler = async (event) => {
  console.log("Received device data event:", JSON.stringify(event, null, 2));

  try {
    const bucketName = process.env.BUCKET_NAME;
    const { deviceId } = event;
    if (!deviceId) {
      throw new Error("Missing deviceId in event payload.");
    }

    const s3Key = `devices/${deviceId}/${Date.now()}.json`;
    const payload = JSON.stringify(event);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: payload,
        ContentType: "application/json",
      })
    );
    console.log(
      `Device data for device ${deviceId} stored in S3 at s3://${bucketName}/${s3Key}.`
    );

    return { status: "success" };
  } catch (error) {
    console.error("Error processing device data event:", error);
    throw error;
  }
};
