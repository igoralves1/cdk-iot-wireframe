#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CdkIotWireframe } from "../lib/cdk-iot-wireframe.mjs";

const app = new cdk.App();
new CdkIotWireframe(app, "CdkIotWireframe");
