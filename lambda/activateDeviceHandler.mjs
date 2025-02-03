import iotPkg from "@aws-sdk/client-iot";

const {
  IoTClient,
  CreatePolicyCommand,
  AttachPolicyCommand,
  DeletePolicyCommand,
  DetachPolicyCommand,
  ListTargetsForPolicyCommand,
} = iotPkg;

const iotClient = new IoTClient({ region: process.env.REGION });

export const handler = async (event) => {
  console.log("Received activateDevice event:", JSON.stringify(event, null, 2));

  try {
    const certificateId = event.certificateId;
    const deviceId = event.deviceId;

    if (!certificateId || !deviceId) {
      throw new Error("Missing certificateId or deviceId in event payload.");
    }

    const region = process.env.REGION;
    const accountId = process.env.ACCOUNT_ID; 
    const certificateArn = `arn:aws:iot:${region}:${accountId}:cert/${certificateId}`;
    const newPolicyName = `Policy_Device_${deviceId}`;
    const oldPolicyName = `Policy__${certificateId}`; 
    try {
      const targetsResponse = await iotClient.send(
        new ListTargetsForPolicyCommand({ policyName: oldPolicyName })
      );
      for (const target of targetsResponse.targets || []) {
        await iotClient.send(
          new DetachPolicyCommand({
            policyName: oldPolicyName,
            target,
          })
        );
        console.log(
          `Detached old broad policy ${oldPolicyName} from target ${target}`
        );
      }
      await iotClient.send(
        new DeletePolicyCommand({ policyName: oldPolicyName })
      );
      console.log(`Deleted old broad policy ${oldPolicyName}.`);
    } catch (err) {
      if (err.name === "ResourceNotFoundException") {
        console.log(`No existing broad policy found for ${oldPolicyName}.`);
      } else {
        throw err;
      }
    }

    try {
      const targetsResponse = await iotClient.send(
        new ListTargetsForPolicyCommand({ policyName: newPolicyName })
      );
      for (const target of targetsResponse.targets || []) {
        await iotClient.send(
          new DetachPolicyCommand({
            policyName: newPolicyName,
            target,
          })
        );
        console.log(
          `Detached old broad policy ${newPolicyName} from target ${target}`
        );
      }
      await iotClient.send(
        new DeletePolicyCommand({ policyName: newPolicyName })
      );
      console.log(`Deleted old broad policy ${newPolicyName}.`);
    } catch (err) {
      if (err.name === "ResourceNotFoundException") {
        console.log(`No existing broad policy found for ${newPolicyName}.`);
      } else {
        throw err;
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
          Resource: `arn:aws:iot:${region}:${accountId}:topic/devices/${deviceId}`,
        },
        {
          Effect: "Allow",
          Action: ["iot:Subscribe"],
          Resource: `arn:aws:iot:${region}:${accountId}:topicfilter/devices/${deviceId}`,
        },
      ],
    };

    await iotClient.send(
      new CreatePolicyCommand({
        policyName: newPolicyName,
        policyDocument: JSON.stringify(restrictedPolicy),
      })
    );
    console.log(`Created new restricted policy ${newPolicyName}.`);

    await iotClient.send(
      new AttachPolicyCommand({
        policyName: newPolicyName,
        target: certificateArn,
      })
    );
    console.log(
      `Attached policy ${newPolicyName} to certificate ${certificateId}.`
    );

    return {
      status: "success",
      certificateId,
      deviceId,
    };
  } catch (error) {
    console.error("Error in activateDevice Lambda:", error);
    throw error;
  }
};
