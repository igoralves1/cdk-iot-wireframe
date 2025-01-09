import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.REGION });

export const handler = async (event) => {
  console.log("Incoming event from IoT rule:", JSON.stringify(event, null, 2));

  try {
    const payload = JSON.stringify(event);
    const objectKey = `uploads/${Date.now()}.json`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: objectKey,
        Body: payload,
      })
    );

    console.log(
      `Successfully uploaded payload to S3: s3://${process.env.BUCKET_NAME}/${objectKey}`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Payload uploaded successfully",
        key: objectKey,
      }),
    };
  } catch (error) {
    console.error("Error uploading to S3:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to upload payload to S3",
        details: error.message,
      }),
    };
  }
};
