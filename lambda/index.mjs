import {
  IoTClient,
  CreateKeysAndCertificateCommand,
  CreatePolicyCommand,
  AttachPolicyCommand,
  UpdateCertificateCommand,
} from "@aws-sdk/client-iot";

const iotClient = new IoTClient({ region: process.env.REGION || "us-east-2" });

/**
 * AWS IoT Certificate Handler Lambda Function
 * @param {object} event - The incoming event object
 * @returns {object} - API response object
 */
export const handler = async (event) => {
  console.log("Event received:", JSON.stringify(event, null, 2));

  try {
    const createCertCmd = new CreateKeysAndCertificateCommand({
      setAsActive: true,
    });
    const certResult = await iotClient.send(createCertCmd);

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
          ],
          Resource: "*",
        },
      ],
    };

    const createPolicyCmd = new CreatePolicyCommand({
      policyName: `Policy_${certResult.certificateId}`,
      policyDocument: JSON.stringify(policyDocument),
    });
    const policyResult = await iotClient.send(createPolicyCmd);

    const attachPolicyCmd = new AttachPolicyCommand({
      policyName: policyResult.policyName,
      target: certResult.certificateArn,
    });
    await iotClient.send(attachPolicyCmd);

    const updateCertCmd = new UpdateCertificateCommand({
      certificateId: certResult.certificateId,
      newStatus: "ACTIVE",
    });
    await iotClient.send(updateCertCmd);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Certificate created and activated successfully",
        certificateId: certResult.certificateId,
        certificateArn: certResult.certificateArn,
        certificatePem: certResult.certificatePem,
        keyPair: {
          privateKey: certResult.keyPair.PrivateKey,
          publicKey: certResult.keyPair.PublicKey,
        },
      }),
    };
  } catch (error) {
    console.error("Error occurred:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create and activate certificate",
        details: error.message,
      }),
    };
  }
};
