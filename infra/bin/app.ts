import * as cdk from "aws-cdk-lib";
import { MedSyncStack } from "../lib/stack.js";

const app = new cdk.App();
new MedSyncStack(app, "MedSyncStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  description: "MedSync healthcare medication coordination platform",
});
