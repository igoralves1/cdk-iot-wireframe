# Welcome to your CDK JavaScript project

You should explore the contents of this project. It demonstrates a CDK app with an instance of a stack (`cdk-iot-wireframe`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The `cdk.json` file tells the CDK Toolkit how to execute your app. The build step is not required when using JavaScript.

## Useful commands

- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk deploy --require-approval never` deploy this stack to your default AWS account/region with giving approval
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template

- `npm install`
- `cdk bootstrap --profile <your profile>`
- `cdk synth`
- `cdk deploy --profile <your profile>`

---

# Registering Your CA Certificate

### Resources

1. [Just-in-Time Registration of Device Certificates on AWS IoT](https://aws.amazon.com/blogs/iot/just-in-time-registration-of-device-certificates-on-aws-iot/)
2. [Create a client certificate using your CA certificate](https://docs.aws.amazon.com/iot/latest/developerguide/create-device-cert.html)
3. [Register a client certificate when the client connects to AWS IoT just-in-time registration (JITR)](https://docs.aws.amazon.com/iot/latest/developerguide/auto-register-device-cert.html)

### A. Commands to Create & Register Your CA Certificate

Enter the following commands in your terminal:

```
$ openssl genrsa -out sampleCACertificate.key 2048
```

```
$ openssl req -x509 -new -nodes -key sampleCACertificate.key -sha256 -days 365 -out sampleCACertificate.pem
```

```
$ openssl genrsa -out privateKeyVerification.key 2048
```
```
$ aws iot get-registration-code
```

> <b>NOTE: Save the Registration code received in above step it will be used in next steps</b>

> In the next step, you will be prompted to enter information. When asked to Enter the `Common Name` Enter the Registration Code

```
...
Organization Name (eg, company) []:
Organizational Unit Name (eg, section)
Common Name (e.g. server FQDN or YOUR name) []: XXXXXSAMPLEREGISTRATIONCODEXXXXX
EMAIL ADDRESS []:
```
```
$ openssl req -new -key privateKeyVerification.key -out privateKeyVerification.csr
```



```
$ openssl x509 -req -in privateKeyVerification.csr -CA sampleCACertificate.pem -CAkey sampleCACertificate.key -CAcreateserial -out privateKeyVerification.crt -days 365 -sha256
```

```
$ aws iot register-ca-certificate --ca-certificate file://sampleCACertificate.pem --verification-certificate file://privateKeyVerification.crt  --set-as-active --allow-auto-registration
```

<!-- > In response you will get the `certificateId` save that it will be used in next steps

```
{
    "certificateArn": "arn:aws:iot:us-east-2:996242555412:cacert/YYYYYYYYYYYYYY",
    "certificateId": "XXXXXXXXXXXXXXXXXXXXXXXXX"
}
``` -->

> Now follow the B. Steps to create a device certificate and connect to the IOT

### B. Create Device Certificate Signed by Your CA Certificate

Enter the following commands in your terminal to create a device certificate:

```bash
$ openssl genrsa -out deviceCert.key 2048
```
> <b>NOTE : In the next step when asked to enter the `Common Name` Enter the `<deviceId>` that you want to use to publish message on topic `devices/<deviceId>`</b>
```bash
$ openssl req -new -key deviceCert.key -out deviceCert.csr
```

```bash
$ openssl x509 -req -in deviceCert.csr -CA sampleCACertificate.pem -CAkey sampleCACertificate.key -CAcreateserial -out deviceCert.crt -days 365 -sha256
```

> Create a certificate file that contains the device certificate and its registered CA certificate. Here is the Linux command:

```bash
$ cat deviceCert.crt sampleCACertificate.pem > deviceCertAndCACert.crt
```

> Download & save the `root.cert` from this link : [Download AmazonRootCA](https://www.amazontrust.com/repository/AmazonRootCA1.pem)

> Now use the following command to simulate the device connecting to IOT for first time

```bash
curl --tlsv1.2 --cacert root.cert --cert ./deviceCertAndCACert.crt --key ./deviceCert.key -X POST -d "{ \"message\": \"Hello, bash\" }" "https://alciucqxncdzf-ats.iot.us-east-2.amazonaws.com:8443/topics/devices/<deviceId>";
```
> Once the above command is run the certificate will be activated & a policy will be attached to it that will allow the device to publish a message on `devices/<deviceId>`. The `<deviceId>` will be taken from the certificate itself ( we added the deviceId in `Common Name` before ).
```bash
curl --tlsv1.2 --cacert root.cert --cert ./deviceCertAndCACert.crt --key ./deviceCert.key -X POST -d "{ \"message\": \"Hello, from devie\" }" "https://alciucqxncdzf-ats.iot.us-east-2.amazonaws.com:8443/topics/devices/<deviceId>";
```
> The above command will publish messages on `devices/<deviceId>`

---

## Process

As soon as the device is connected for the first time following things will happen :

- Following payload will be published on topic `$aws/events/certificates/registered/<caCertificateID>`

```json
{
  "certificateId": "<certificateID>",
  "caCertificateId": "<caCertificateId>",
  "timestamp": "<timestamp>",
  "certificateStatus": "PENDING_ACTIVATION",
  "awsAccountId": "<awsAccountId>",
  "certificateRegistrationTimestamp": "<certificateRegistrationTimestamp>"
}
```

- A `certificateActivation` lambda will take the payload, extract the `certificateId` and then activate the associated certificate that has the `PENDING_ACTIVATION` status.
- The `certificateActivation` lambda will also attach a policy to the above certificate.
- The above payload will be saved in a S3 bucket.
- Now the events from the device will be received in the IOT core.
----------------------------

- Extra commands
```bash
for i in {1..50}
do
   curl --tlsv1.2 --cacert root.cert --cert ./deviceCertAndCACert.crt --key ./deviceCert.key -X POST -d "{ \"message\": \"Hello, bash\" }" "https://alciucqxncdzf-ats.iot.us-east-2.amazonaws.com:8443/topics/devices/12368123";
   echo "";
   sleep 10
done
```