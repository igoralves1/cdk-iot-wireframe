import {
  IoTClient,
  CreateThingCommand,
  AttachThingPrincipalCommand,
} from "@aws-sdk/client-iot";

const iotClient = new IoTClient({ region: process.env.REGION });

export const handler = async (event) => {
  console.log("ThingCreationLambda received:", JSON.stringify(event));

  const { deviceId, certificateArn, uid } = event;
  if (!deviceId || !certificateArn || !uid) {
    throw new Error(
      "Missing 'deviceId', 'uid' or 'certificateArn' in event payload."
    );
  }

  try {
    console.log(`Creating IoT Thing: ${deviceId}`);
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

    console.log(
      `Attaching certificateArn ${certificateArn} to Thing ${deviceId}`
    );
    await iotClient.send(
      new AttachThingPrincipalCommand({
        thingName: deviceId,
        principal: certificateArn,
      })
    );

    console.log(
      `Thing ${deviceId} created and certificate attached successfully.`
    );
    return {
      status: "success",
      thingName: deviceId,
    };
  } catch (error) {
    console.error("Error in ThingCreationLambda:", error);
    throw error;
  }
};
