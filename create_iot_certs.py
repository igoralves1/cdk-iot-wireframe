#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys

def run_command(cmd):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        print(f"[ERROR] Command failed:\n  STDOUT: {result.stdout}\n  STDERR: {result.stderr}")
        sys.exit(result.returncode)
    return result.stdout.strip()

def fetch_registration_code():
    """Return the AWS IoT registration code as a string."""
    print("Fetching AWS IoT registration code (requires AWS CLI configured)...")
    output = run_command("aws iot get-registration-code")
    return json.loads(output)["registrationCode"]

def register_ca_certificate(ca_cert_file, verification_crt_file):
    """Register the CA with AWS IoT (auto-registration enabled)."""
    cmd = (
        f"aws iot register-ca-certificate "
        f"--ca-certificate file://{ca_cert_file} "
        f"--verification-certificate file://{verification_crt_file} "
        f"--set-as-active --allow-auto-registration"
    )
    run_command(cmd)
    print("CA certificate registered successfully!")

def describe_iot_endpoint():
    """Fetch the Data-ATS endpoint address from AWS IoT."""
    out = run_command("aws iot describe-endpoint --endpoint-type iot:Data-ATS")
    data = json.loads(out)
    return data["endpointAddress"]

def main():
    parser = argparse.ArgumentParser(
        description="Create/register an AWS IoT CA and/or create a device certificate."
    )
    parser.add_argument("--createCA", action="store_true", help="Create and register a new CA certificate.")
    parser.add_argument("--createDevice", action="store_true", help="Create a new device certificate.")
    args = parser.parse_args()

    create_ca = args.createCA
    create_device = args.createDevice

    # If no flags provided, print help and exit
    if not create_ca and not create_device:
        parser.print_help()
        sys.exit(1)

    # FilesNames
    ca_key_file = "sampleCACertificate.key"
    ca_cert_file = "sampleCACertificate.pem"
    verification_key_file = "privateKeyVerification.key"
    verification_csr_file = "privateKeyVerification.csr"
    verification_crt_file = "privateKeyVerification.crt"

    # 1) (OPTIONAL) CREATE & REGISTER CA
    if create_ca:
        print("=== Creating a new CA certificate ===")
        run_command(f"openssl genrsa -out {ca_key_file} 2048")

        run_command(
            f"openssl req -x509 -new -nodes -key {ca_key_file} -sha256 "
            f"-days 365 -out {ca_cert_file} "
            f"-addext 'basicConstraints=critical,CA:true' "
            f"-subj '/C=US/ST=NY/O=MyCompany/OU=IoT/CN=MyRootCA'" # change values here accordingly
        )

        run_command(f"openssl genrsa -out {verification_key_file} 2048")

        # Get AWS registration code
        reg_code = fetch_registration_code()
        print(f"Registration code: {reg_code}")

        run_command(
            f"openssl req -new -key {verification_key_file} -out {verification_csr_file} "
            f"-subj '/C=US/ST=NY/O=MyCompany/OU=IoT/CN={reg_code}'" # change values here accordingly
        )

        run_command(
            f"openssl x509 -req -in {verification_csr_file} "
            f"-CA {ca_cert_file} -CAkey {ca_key_file} -CAcreateserial "
            f"-out {verification_crt_file} -days 365 -sha256"
        )

        # Register the CA with AWS IoT
        register_ca_certificate(ca_cert_file, verification_crt_file)

        if os.path.exists("root.cert"):
            os.remove("root.cert")
        os.rename(ca_cert_file, "root.cert")
        print("Renamed sampleCACertificate.pem to root.cert for convenience.\n")

    # 2) (OPTIONAL) CREATE DEVICE CERT
    if create_device:
        print("=== Creating a new device certificate ===")
        device_id = input("Enter your Device ID (to embed in the device certificate's CN): ").strip()
        if not device_id:
            print("Device ID cannot be empty.")
            sys.exit(1)

        device_key_file = f"{device_id}_deviceCert.key"
        run_command(f"openssl genrsa -out {device_key_file} 2048")

        device_csr_file = f"{device_id}_deviceCert.csr"
        run_command(
            f"openssl req -new -key {device_key_file} -out {device_csr_file} "
            f"-subj '/C=US/ST=NY/O=MyCompany/OU=IoT/CN={device_id}'"
        )

        device_crt_file = f"{device_id}_deviceCert.crt"

        if not os.path.exists("root.cert"):
            print("[WARNING] Could not find 'root.cert'. Did you rename your CA cert differently?")

        run_command(
            f"openssl x509 -req -in {device_csr_file} "
            f"-CA root.cert -CAkey {ca_key_file} -CAcreateserial "
            f"-out {device_crt_file} -days 365 -sha256"
        )

        print(f"\nCreated device certificate: {device_crt_file}")

        print("\n === Fetching AWS IoT endpoint === ")
        endpoint_address = describe_iot_endpoint()
        print(f"Your AWS IoT endpoint: {endpoint_address}")

        print("\nTest the connection with the following command : \n")
        print(
            f'curl --tlsv1.2 --cacert root.cert '
            f'--cert ./{device_crt_file} '
            f'--key ./{device_key_file} '
            f'-X POST -d \'{{ "message": "Hello, from test device : {device_id}" }}\' '
            f'"https://{endpoint_address}:8443/topics/devices/{device_id}"\n'
        )

    print("\nCertificates has been created !!!\n")

if __name__ == "__main__":
    main()
