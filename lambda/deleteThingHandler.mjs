import {
  IoTClient,
  DescribeThingCommand,
  ListThingPrincipalsCommand,
  DetachThingPrincipalCommand,
  DeleteThingCommand,
} from "@aws-sdk/client-iot";

const iotClient = new IoTClient({ region: process.env.REGION });

export const handler = async (event) => {
  console.log(
    "deleteThingHandler received event:",
    JSON.stringify(event, null, 2)
  );

  const deviceId = event.deviceId;
  if (!deviceId) {
    throw new Error("Missing deviceId in IoT event payload.");
  }

  try {
    await iotClient.send(new DescribeThingCommand({ thingName: deviceId }));
    console.log(
      `Thing ${deviceId} found. Proceeding to detach principals and delete.`
    );

    const principalRes = await iotClient.send(
      new ListThingPrincipalsCommand({ thingName: deviceId })
    );

    const principals = principalRes.principals || [];
    console.log(
      `Found ${principals.length} principals attached to ${deviceId}:`,
      principals
    );

    for (const principalArn of principals) {
      console.log(
        `Detaching principal: ${principalArn} from Thing: ${deviceId}`
      );
      await iotClient.send(
        new DetachThingPrincipalCommand({
          thingName: deviceId,
          principal: principalArn,
        })
      );
    }

    console.log(`Deleting Thing: ${deviceId}`);
    await iotClient.send(new DeleteThingCommand({ thingName: deviceId }));

    console.log(`Thing ${deviceId} deleted successfully.`);
    return { status: "success", thingName: deviceId };
  } catch (error) {
    console.error("Error in deleteThingHandler:", error);
    throw error;
  }
};
