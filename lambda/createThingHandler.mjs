import {
  IoTClient,
  CreateThingCommand,
  AttachThingPrincipalCommand,
} from "@aws-sdk/client-iot";

const iotClient = new IoTClient({ region: process.env.REGION });

export const handler = async (event) => {
  console.log(
    "createThingHandler received event:",
    JSON.stringify(event, null, 2)
  );

  const deviceId = event.deviceId;
  const certId = event.certId;

  if (!deviceId || !certId) {
    throw new Error("Missing deviceId or certId from IoT event payload.");
  }

  const accountId = process.env.ACCOUNT_ID;
  const region = process.env.REGION;
  const certificateArn = `arn:aws:iot:${region}:${accountId}:cert/${certId}`;

  try {
    console.log(`Creating Thing with name: ${deviceId}`);
    await iotClient.send(new CreateThingCommand({ thingName: deviceId }));
    console.log("Thing created successfully.");

    console.log(
      `Attaching certificate ARN ${certificateArn} to Thing ${deviceId}`
    );
    await iotClient.send(
      new AttachThingPrincipalCommand({
        thingName: deviceId,
        principal: certificateArn,
      })
    );
    console.log("AttachThingPrincipal completed successfully.");

    return {
      status: "success",
      thingName: deviceId,
    };
  } catch (error) {
    console.error("Error in createThingHandler:", error);
    throw error;
  }
};
