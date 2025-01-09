import {
  IoTClient,
  DescribeEndpointCommand,
  CreateKeysAndCertificateCommand,
  CreatePolicyCommand,
  AttachPolicyCommand,
  UpdateCertificateCommand,
} from "@aws-sdk/client-iot";
import {
  IoTDataPlaneClient,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";

const region = process.env.REGION || "us-east-2";

const iotClient = new IoTClient({ region });

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
            "iot:DescribeEndpoint",
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

    const describeEndpointCmd = new DescribeEndpointCommand({
      endpointType: "iot:Data-ATS",
    });
    const { endpointAddress } = await iotClient.send(describeEndpointCmd);

    console.log("IoT Endpoint retrieved:", endpointAddress);

    const iotDataClient = new IoTDataPlaneClient({
      region,
      endpoint: `https://${endpointAddress}`,
    });

    const publishCmd = new PublishCommand({
      topic: "kinesis/test",
      qos: 1,
      retain: false,
      payload: new TextEncoder().encode(
        JSON.stringify({
          message: "Hello from IoTDataPlaneClient",
          timestamp: new Date().toISOString(),
        })
      ),
    });

    let publishSuccess = false;
    try {
      await iotDataClient.send(publishCmd);
      publishSuccess = true;
    } catch (error) {
      console.error("Error publishing message:", error);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          "Certificate created, activated, and message publish attempt complete",
        certificateId: certResult.certificateId,
        certificateArn: certResult.certificateArn,
        certificatePem: certResult.certificatePem,
        keyPair: {
          privateKey: certResult.keyPair.PrivateKey,
          publicKey: certResult.keyPair.PublicKey,
        },
        publishStatus: publishSuccess
          ? "Message published successfully"
          : "Failed to publish message",
      }),
    };
  } catch (error) {
    console.error("Error occurred:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create, activate certificate, or publish message",
        details: error.message,
      }),
    };
  }
};
