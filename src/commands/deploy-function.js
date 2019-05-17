const { Command, flags } = require("@oclif/command");
const { cli } = require("cli-ux");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const path = require("path");

const AWS = require("aws-sdk");

const fs = require("fs");

const notifier = require("node-notifier");

const { getConfigRegion } = require("../samCommands");

class DeployFunction extends Command {
  async run() {
    // can get args as an object
    const { args, flags } = this.parse(DeployFunction);

    let region = flags.region || process.env["AWS_REGION"];

    const configFileContents = fs.readFileSync(flags["config-file"], "utf8");

    const config = JSON.parse(configFileContents);

    const stackName = `${config.name}-${flags.stage}`;

    const stageConfig = config.stages[flags.stage];

    if (!stageConfig) {
      console.error(
        `No stage configured in ${flags["config-file"]} for ${flags.stage}`
      );

      this.exit();
    }

    if (!region) {
      region = await getConfigRegion(stageConfig.profile);
    }

    if (region) {
      AWS.config.update({ region: region });
    } else {
      console.error(
        "Cannot deploy because no AWS region specified. Please specify a region using the --region flag"
      );

      this.exit();
    }

    if (stageConfig.profile) {
      console.log(`Using AWS profile ${stageConfig.profile}`);

      const credentials = new AWS.SharedIniFileCredentials({
        profile: stageConfig.profile
      });

      AWS.config.update({ credentials });
    }

    const regionConfig = stageConfig.regions[region];

    if (!regionConfig) {
      console.error(
        `Cannot deploy because region config for ${region} not found`
      );

      this.exit();
    }

    const bucketName = regionConfig.bucket;

    if (!bucketName) {
      console.error(
        `Cannot deploy because region config ${region} does not specify a source code bucket name`
      );

      this.exit();
    }

    const s3 = new AWS.S3();

    try {
      await s3.headBucket({ Bucket: bucketName }).promise();
    } catch (error) {
      console.error(
        `Cannot deploy because bucket ${bucketName} does not exist`
      );

      this.exit();
    }

    const bucketLocationResponse = await s3
      .getBucketLocation({ Bucket: bucketName })
      .promise();

    const bucketInRegion =
      region === "us-east-1"
        ? bucketLocationResponse.LocationConstraint !== null
        : bucketLocationResponse.LocationConstraint === region;

    if (!bucketInRegion) {
      console.error(
        `Cannot deploy in ${region} to bucket ${bucketName} because it is located in ${
          bucketLocationResponse.LocationConstraint
        }`
      );

      this.exit();
    }

    const cloudformation = new AWS.CloudFormation();

    const functionResourceResponse = await cloudformation
      .describeStackResource({
        StackName: stackName,
        LogicalResourceId: args.function
      })
      .promise();

    const {
      PhysicalResourceId: functionName
    } = functionResourceResponse.StackResourceDetail;

    const buildCommand = `yarn build -f ${args.function}`;

    cli.action.start(`Building ${args.function}`);

    await exec(buildCommand);

    cli.action.stop();

    const deployDir = flags["deploy-dir"];
    const builtFunctionPath = path.join(deployDir, args.function);
    const zipFilePath = `${builtFunctionPath}.zip`;
    const absoluteZipFilePath = path.resolve(zipFilePath);

    const previousWorkingDirectory = process.cwd();
    process.chdir(builtFunctionPath);

    const zipCommand = `zip -q -r9 ../${args.function}.zip *`;

    cli.action.start(`Deploying ${args.function} to ${functionName}`);

    await exec(zipCommand);

    process.chdir(previousWorkingDirectory);

    const deployCommand = `aws lambda update-function-code --function-name ${functionName} --publish --zip-file fileb://${absoluteZipFilePath} --region ${region} --profile ${
      stageConfig.profile
    }`;

    if (flags["dry-run"]) {
      this.exit();
    }
    try {
      await exec(deployCommand);
    } catch (error) {
      console.error(error);
    }

    await exec(`rm ${zipFilePath}`);

    cli.action.stop();

    notifier.notify({
      title: `Function deployed!`,
      message: `${args.function} was deployed to ${functionName}`
    });
  }
}

DeployFunction.args = [
  {
    name: "function",
    required: true,
    description: "Logical ID of the function in your SAM template"
  }
];

DeployFunction.description = "Deploys a specific function";

DeployFunction.flags = {
  region: flags.string({
    char: "r",
    description: "Destination AWS region",
    required: false
  }),
  "config-file": flags.string({
    char: "c",
    description: "Path to the stack-config.json file",
    required: false,
    default: "./stack-config.json"
  }),
  "template-file": flags.string({
    char: "t",
    description: "Path to the SAM template file",
    required: false,
    default: "./template.yml"
  }),
  "deploy-dir": flags.string({
    char: "d",
    description:
      "Path to local deploy directory where the code artifacts and template file are located",
    required: false,
    default: "./.aws-sam/build"
  }),
  stage: flags.string({
    char: "s",
    description: "The stage to deploy",
    required: true,
    default: "dev"
  }),
  "dry-run": flags.boolean({
    description: "View the output of the command without making any changes",
    required: false,
    default: false
  })
};

module.exports = DeployFunction;
