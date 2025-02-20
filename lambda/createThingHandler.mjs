import {
  IoTClient,
  CreateThingCommand,
  AttachThingPrincipalCommand,
} from "@aws-sdk/client-iot";

const iotClient = new IoTClient({ region: process.env.REGION });

const generateUID = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
};

export const handler = async (event) => {
  console.log(
    "createThingHandler received event:",
    JSON.stringify(event, null, 2)
  );

  const deviceId = event.deviceId;
  const certId = event.certId;
  const uid = event.uid;

  if (!deviceId || !certId || !uid) {
    throw new Error("Missing deviceId, uid or certId from IoT event payload.");
  }

  // const uid = generateUID();

  const accountId = process.env.ACCOUNT_ID;
  const region = process.env.REGION;
  const certificateArn = `arn:aws:iot:${region}:${accountId}:cert/${certId}`;

  try {
    console.log(`Creating Thing with name: ${deviceId} and uid: ${uid}`);
    await iotClient.send(
      new CreateThingCommand({
        thingName: deviceId,
        attributePayload: {
          attributes: {
            uid: uid,
          },
          merge: true,
        },
      })
    );
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
      uid: uid,
    };
  } catch (error) {
    console.error("Error in createThingHandler:", error);
    throw error;
  }
};
