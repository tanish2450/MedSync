import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import {
  aws_apigateway as apigw, aws_bedrock as bedrock, aws_cloudfront as cf, aws_cloudfront_origins as origins,
  aws_cloudtrail as cloudtrail, aws_cognito as cognito, aws_dynamodb as dynamodb, aws_healthlake as healthlake,
  aws_iam as iam, aws_kms as kms, aws_lambda as lambda, aws_lambda_nodejs as nodejs, aws_logs as logs,
  aws_s3 as s3, aws_s3_deployment as deploy, aws_stepfunctions as sfn, aws_stepfunctions_tasks as tasks,
  aws_events as events, aws_events_targets as targets, aws_timestream as timestream,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { TABLES, tableEnvVar } from "../../backend/src/lib/tables.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const ROLES = ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy"];

export class MedSyncStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const ctx = (k: string, d?: string) => (this.node.tryGetContext(k) as string | undefined) ?? d;
    const destroy = ctx("destroyOnDelete") === "true"; // hackathon teardown: -c destroyOnDelete=true
    const removal = destroy ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    // ---------- Security: one KMS key encrypts DynamoDB, S3, HealthLake, logs ----------
    const key = new kms.Key(this, "DataKey", { enableKeyRotation: true, description: "MedSync data encryption key", removalPolicy: removal });

    // ---------- DynamoDB (operational data) ----------
    const tables: Record<string, dynamodb.Table> = {};
    for (const def of Object.values(TABLES) as any[]) {
      const t = new dynamodb.Table(this, `Table${def.key}`, {
        partitionKey: { name: def.pk, type: dynamodb.AttributeType.STRING },
        sortKey: def.sk ? { name: def.sk, type: dynamodb.AttributeType.STRING } : undefined,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED, encryptionKey: key,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, removalPolicy: removal,
      });
      for (const g of def.gsis ?? []) {
        t.addGlobalSecondaryIndex({
          indexName: g.name, partitionKey: { name: g.pk, type: dynamodb.AttributeType.STRING },
          sortKey: g.sk ? { name: g.sk, type: dynamodb.AttributeType.STRING } : undefined,
        });
      }
      tables[def.key] = t;
    }

    // ---------- S3: private asset bucket (audio, transcripts, uploads) + web bucket ----------
    const assets = new s3.Bucket(this, "Assets", {
      encryption: s3.BucketEncryption.KMS, encryptionKey: key, bucketKeyEnabled: true, enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, versioned: true, removalPolicy: removal, autoDeleteObjects: destroy,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET], allowedOrigins: ["*"], allowedHeaders: ["*"] }],
    });
    // CloudFront needs an account verification on new AWS accounts. Off by default: the site is served from S3 website
    // hosting over HTTP. Enable later with: npx cdk deploy -c cloudfront=true
    const useCdn = ctx("cloudfront") === "true";
    const web = new s3.Bucket(this, "Web", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: useCdn,
      removalPolicy: cdk.RemovalPolicy.DESTROY, autoDeleteObjects: true,
      ...(useCdn
        ? { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL }
        : {
          // Public read of the static site files only. The API still requires Cognito tokens.
          publicReadAccess: true, websiteIndexDocument: "index.html", websiteErrorDocument: "index.html",
          blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false }),
        }),
    });
    const dist = useCdn ? new cf.Distribution(this, "Site", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      defaultRootObject: "index.html", minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [403, 404].map((s) => ({ httpStatus: s, responseHttpStatus: 200, responsePagePath: "/index.html" })),
    }) : undefined;
    // -c siteUrl=https://your-site.netlify.app lets the app be served from any HTTPS host (CORS + Cognito/Google callback use it)
    const customSite = (ctx("siteUrl") ?? "").replace(/\/+$/, "");
    if (customSite && !customSite.startsWith("https://")) throw new Error("-c siteUrl must start with https://");
    const siteOrigin = customSite || (dist ? `https://${dist.distributionDomainName}` : `http://${web.bucketWebsiteDomainName}`);

    // ---------- Cognito ----------
    const pool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true, signInAliases: { email: true }, autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true }, fullname: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      mfa: cognito.Mfa.OPTIONAL, mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY, removalPolicy: removal,
    });
    // Google sign-in needs an HTTPS callback URL, so it is only wired when CloudFront is on: -c cloudfront=true -c google=true -c googleClientId=...
    // The Google client secret lives in Secrets Manager as "medsync/google-client-secret" (plain-text secret value).
    const googleOn = (useCdn || !!customSite) && ctx("google") === "true";
    let googleIdp: cognito.UserPoolIdentityProviderGoogle | undefined; let cognitoDomain: string | undefined;
    if (googleOn) {
      if (!ctx("googleClientId")) throw new Error("-c googleClientId=... is required with -c google=true");
      googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
        userPool: pool, clientId: ctx("googleClientId")!, clientSecretValue: cdk.SecretValue.secretsManager("medsync/google-client-secret"),
        scopes: ["openid", "email", "profile"],
        attributeMapping: { email: cognito.ProviderAttribute.GOOGLE_EMAIL, fullname: cognito.ProviderAttribute.GOOGLE_NAME },
      });
      const dom = pool.addDomain("HostedDomain", { cognitoDomain: { domainPrefix: ctx("cognitoDomainPrefix") ?? `medsync-${this.account}` } });
      cognitoDomain = `${dom.domainName}.auth.${this.region}.amazoncognito.com`;
    }
    const client = pool.addClient("Web", {
      authFlows: { userSrp: true }, generateSecret: false, preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1), idTokenValidity: cdk.Duration.hours(1),
      ...(googleOn ? {
        supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO, cognito.UserPoolClientIdentityProvider.GOOGLE],
        oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE], callbackUrls: [`${siteOrigin}/`], logoutUrls: [`${siteOrigin}/`] },
      } : {}),
    });
    if (googleIdp) client.node.addDependency(googleIdp);
    for (const r of ROLES) new cognito.CfnUserPoolGroup(this, `Group-${r}`, { userPoolId: pool.userPoolId, groupName: r, description: `MedSync ${r}` });

    // ---------- Optional: HealthLake (FHIR) — region support is limited; enable with -c healthLake=true ----------
    let healthLakeEndpoint: string | undefined; let healthLakeArn: string | undefined;
    if (ctx("healthLake") === "true") {
      const ds = new healthlake.CfnFHIRDatastore(this, "Fhir", {
        datastoreTypeVersion: "R4", datastoreName: "medsync-fhir",
        sseConfiguration: { kmsEncryptionConfig: { cmkType: "CUSTOMER_MANAGED_KMS_KEY", kmsKeyId: key.keyArn } },
      });
      healthLakeEndpoint = ds.attrDatastoreEndpoint; healthLakeArn = ds.attrDatastoreArn;
    }

    // ---------- Bedrock Guardrail (explanations only; deterministic logic decides safety) ----------
    const guardrail = new bedrock.CfnGuardrail(this, "Guardrail", {
      name: "medsync-explain", blockedInputMessaging: "Request blocked by MedSync guardrail.", blockedOutputsMessaging: "Output blocked by MedSync guardrail.",
      topicPolicyConfig: {
        topicsConfig: [
          { name: "DiagnosingPatients", type: "DENY", definition: "Stating or inferring a medical diagnosis for a specific patient.", examples: ["What disease does this patient have?"] },
          { name: "PrescribingNewTherapy", type: "DENY", definition: "Recommending a new medicine, dose or treatment that is not in the supplied record.", examples: ["What should I prescribe instead?"] },
        ],
      },
    });
    const modelId = ctx("bedrockModelId", "us.anthropic.claude-3-5-haiku-20241022-v1:0"); // confirm availability in your region/account

    // ---------- Optional: Timestream adherence time-series (-c timestream=true). New AWS accounts may not have access to
    // Timestream for LiveAnalytics; dashboards read DynamoDB either way, so this is additive. ----------
    let tsDb: string | undefined; let tsTable: string | undefined; let tsArn: string | undefined;
    if (ctx("timestream") === "true") {
      const db = new timestream.CfnDatabase(this, "AdherenceDb", { databaseName: "medsync", kmsKeyId: key.keyId });
      const tbl = new timestream.CfnTable(this, "AdherenceTable", { databaseName: db.ref, tableName: "dose_events",
        retentionProperties: { memoryStoreRetentionPeriodInHours: "168", magneticStoreRetentionPeriodInDays: "365" } });
      tbl.addDependency(db); tsDb = db.ref; tsTable = "dose_events"; tsArn = tbl.attrArn;
    }

    // ---------- Lambdas ----------
    const env: Record<string, string> = {
      USER_POOL_ID: pool.userPoolId, CORS_ORIGIN: siteOrigin,
      ASSETS_BUCKET: assets.bucketName, GROQ_PARAM: "/medsync/groq-api-key", GROQ_VISION_MODEL: ctx("groqModel", "qwen/qwen3.8-27b")!,
      BEDROCK_MODEL_ID: modelId, BEDROCK_GUARDRAIL_ID: guardrail.attrGuardrailId, BEDROCK_GUARDRAIL_VERSION: "DRAFT",
      COMPREHEND_MEDICAL_ENABLED: ctx("comprehendMedical", "true")!, COMPREHEND_MEDICAL_REGION: this.region,
      ...Object.fromEntries(Object.keys(TABLES).map((k) => [tableEnvVar(k), tables[k].tableName])),
      SMS_ENABLED: ctx("smsEnabled", "false")!, // SNS SMS needs sandbox exit / origination identity in many regions
      ...(tsDb ? { TIMESTREAM_DB: tsDb, TIMESTREAM_TABLE: tsTable! } : {}),
      ...(healthLakeEndpoint ? { HEALTHLAKE_ENDPOINT: healthLakeEndpoint } : {}),
    };
    const bundling: nodejs.BundlingOptions = { target: "node22", minify: true, sourceMap: false, externalModules: [] };
    const mk = (id: string, entry: string, handler: string, memory = 512, timeout = 30) =>
      new nodejs.NodejsFunction(this, id, {
        entry: path.join(root, "backend/src", entry), handler, runtime: lambda.Runtime.NODEJS_22_X, memorySize: memory,
        timeout: cdk.Duration.seconds(timeout), environment: env, bundling, projectRoot: root,
        depsLockFilePath: path.join(root, "package-lock.json"), logRetention: logs.RetentionDays.ONE_MONTH,
        tracing: lambda.Tracing.ACTIVE,
      });
    const apiFn = mk("ApiFn", "handlers/api.ts", "handler");
    const tickFn = mk("TickFn", "handlers/scheduler.ts", "tick", 512, 120);
    const dayBeforeFn = mk("DayBeforeFn", "handlers/scheduler.ts", "dayBefore", 512, 120);
    const writers = [apiFn, tickFn, dayBeforeFn];
    const wf = { normalise: mk("WfNormalise", "workflow/steps.ts", "normalise"), lookup: mk("WfLookup", "workflow/steps.ts", "interactionLookup"),
      evaluate: mk("WfEvaluate", "workflow/steps.ts", "evaluate"), explain: mk("WfExplain", "workflow/steps.ts", "explain", 512, 60) };

    const readOnly = ["DrugCatalogue", "DrugInteractions"];
    const bedrockPolicy = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:Converse"],
      resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
    });
    const guardPolicy = new iam.PolicyStatement({ actions: ["bedrock:ApplyGuardrail"], resources: [guardrail.attrGuardrailArn] });
    const cmed = new iam.PolicyStatement({ actions: ["comprehendmedical:InferRxNorm"], resources: ["*"] }); // service has no resource-level ARNs
    for (const fn of [...writers, ...Object.values(wf)]) {
      for (const [k, t] of Object.entries(tables)) {
        if (k === "AuditEvents") { t.grant(fn, "dynamodb:PutItem", "dynamodb:Query"); key.grantEncryptDecrypt(fn); } // append-only: no update/delete
        else if (readOnly.includes(k) || !writers.includes(fn as any)) t.grantReadData(fn);
        else t.grantReadWriteData(fn);
      }
      fn.addToRolePolicy(bedrockPolicy); fn.addToRolePolicy(guardPolicy); fn.addToRolePolicy(cmed);
    }
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminGetUser"], resources: [pool.userPoolArn],
    }));
    if (healthLakeArn) apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["healthlake:CreateResource"], resources: [healthLakeArn, `${healthLakeArn}/*`] }));
    assets.grantReadWrite(apiFn);
    // Groq API key lives in SSM Parameter Store (SecureString), never in code or Lambda env. Create it with: aws ssm put-parameter --name /medsync/groq-api-key --type SecureString --value <key>
    apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["ssm:GetParameter"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/medsync/groq-api-key`] }));
    for (const fn of writers) {
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["sns:Publish"], resources: ["*"] })); // SMS to phone numbers has no resource-level ARN
      if (tsArn) { fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["timestream:WriteRecords"], resources: [tsArn] })); fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["timestream:DescribeEndpoints"], resources: ["*"] })); }
    }

    // ---------- EventBridge: dose reminders / missed-dose checks every minute; day-before confirmations at 18:00 IST ----------
    new events.Rule(this, "DoseTick", { schedule: events.Schedule.rate(cdk.Duration.minutes(1)), targets: [new targets.LambdaFunction(tickFn, { retryAttempts: 2 })] });
    new events.Rule(this, "DayBeforeConfirm", { schedule: events.Schedule.cron({ minute: "30", hour: "12" }), // 12:30 UTC = 18:00 IST
      targets: [new targets.LambdaFunction(dayBeforeFn, { retryAttempts: 2 })] });

    // ---------- Step Functions (Express, synchronous): the drug-safety workflow ----------
    const step = (id: string, fn: lambda.IFunction) => new tasks.LambdaInvoke(this, id, { lambdaFunction: fn, payloadResponseOnly: true,
      retryOnServiceExceptions: true });
    const definition = step("Normalise", wf.normalise).next(step("InteractionLookup", wf.lookup)).next(step("Evaluate", wf.evaluate)).next(step("Explain", wf.explain));
    const sm = new sfn.StateMachine(this, "SafetyWorkflow", {
      definitionBody: sfn.DefinitionBody.fromChainable(definition), stateMachineType: sfn.StateMachineType.EXPRESS,
      timeout: cdk.Duration.seconds(90), tracingEnabled: true,
      logs: { destination: new logs.LogGroup(this, "SfnLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }), level: sfn.LogLevel.ERROR, includeExecutionData: false },
    });
    apiFn.addEnvironment("SAFETY_STATE_MACHINE_ARN", sm.stateMachineArn);
    sm.grantStartSyncExecution(apiFn);

    // ---------- API Gateway: single authorised API (Cognito) ----------
    const api = new apigw.RestApi(this, "Api", {
      restApiName: "medsync-api", deployOptions: { stageName: "v1", throttlingRateLimit: 100, throttlingBurstLimit: 200, tracingEnabled: true },
      defaultCorsPreflightOptions: { allowOrigins: [siteOrigin, "http://localhost:5173"], allowMethods: apigw.Cors.ALL_METHODS, allowHeaders: ["Content-Type", "Authorization"] },
    });
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "Authorizer", { cognitoUserPools: [pool] });
    api.root.addProxy({
      defaultIntegration: new apigw.LambdaIntegration(apiFn), anyMethod: true,
      defaultMethodOptions: { authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    });
    for (const [id, type] of [["Default4xx", apigw.ResponseType.DEFAULT_4XX], ["Default5xx", apigw.ResponseType.DEFAULT_5XX]] as const) {
      api.addGatewayResponse(id, { type, responseHeaders: { "Access-Control-Allow-Origin": `'${siteOrigin}'` } });
    }

    // ---------- Frontend deployment (runtime config.json keeps secrets out of the bundle; none are secret) ----------
    new deploy.BucketDeployment(this, "DeploySite", {
      destinationBucket: web, ...(dist ? { distribution: dist, distributionPaths: ["/*"] } : {}),
      sources: [
        deploy.Source.asset(path.join(root, "frontend/dist")),
        deploy.Source.jsonData("config.json", { apiUrl: api.url.replace(/\/$/, ""), userPoolId: pool.userPoolId, clientId: client.userPoolClientId, region: this.region, googleEnabled: googleOn, cognitoDomain: cognitoDomain ?? "" }),
      ],
    });

    // ---------- Audit: CloudTrail ----------
    const trailBucket = new s3.Bucket(this, "TrailBucket", { encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true, blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, removalPolicy: removal, autoDeleteObjects: destroy });
    const trail = new cloudtrail.Trail(this, "Trail", { bucket: trailBucket, enableFileValidation: true, includeGlobalServiceEvents: true });
    trail.addS3EventSelector([{ bucket: assets }]);

    // ---------- Outputs ----------
    new cdk.CfnOutput(this, "SiteUrl", { value: siteOrigin });
    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "UserPoolId", { value: pool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new cdk.CfnOutput(this, "TableNames", { value: this.toJsonString(Object.fromEntries(Object.keys(TABLES).map((k) => [k, tables[k].tableName]))) });
  }
}
