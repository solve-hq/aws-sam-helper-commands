const { Command, flags } = require("@oclif/command");
const { cli } = require("cli-ux");

const inquirer = require("inquirer");
const AWS = require("aws-sdk");

const YAML = require("yaml");
const fs = require("fs");

const {
  samBuild,
  samDeploy,
  samPackage,
  getConfigRegion
} = require("../samCommands");

const loadTemplate = (deployDir, templateFile) => {
  const warn = console.warn;
  console.warn = () => {};
  const doc = YAML.parse(
    fs.readFileSync(`${deployDir}/${templateFile}`, "utf8")
  );
  console.warn = warn;

  return doc;
};

class Deploy extends Command {
  async run() {
    // can get args as an object
    const { argv, flags } = this.parse(Deploy);

    let region = flags.region || process.env["AWS_REGION"];

    if (!region) {
      region = await getConfigRegion(flags.profile);
    }

    if (region) {
      console.log(`Deploying in ${region}...`);

      AWS.config.update({ region: region });
    } else {
      console.error(
        "Cannot deploy because no AWS region specified. Please specify a region using the --region flag"
      );

      this.exit();
    }

    if (flags.profile) {
      console.log(`Using AWS profile ${flags.profile}`);

      const credentials = new AWS.SharedIniFileCredentials({
        profile: flags.profile
      });

      AWS.config.update({ credentials });
    }

    const paramOverrides = [];

    if (flags["override-parameters"]) {
      const doc = loadTemplate(flags["deploy-dir"], flags.template);

      const ssm = new AWS.SSM();

      const parameterKeys = Object.keys(doc.Parameters);

      for (let index = 0; index < parameterKeys.length; index++) {
        const parameterKey = parameterKeys[index];
        const parameter = doc.Parameters[parameterKey];

        if (parameter.Type.match(/AWS::SSM::Parameter::Value/)) {
          const searchPath = parameter.Default.split("/")
            .slice(0, 3)
            .join("/");

          const parameterChoicesData = await ssm
            .getParametersByPath({
              Path: searchPath,
              Recursive: true
            })
            .promise();

          const parameterOptions = parameterChoicesData.Parameters.map(
            param => param.Name
          );

          let paramResponse = await inquirer.prompt([
            {
              name: "paramOverride",
              message: `Override "${parameterKey}" param value`,
              type: "list",
              choices: parameterOptions,
              default: parameter.Default
            }
          ]);

          paramOverrides.push({
            Value: paramResponse.paramOverride,
            Name: parameterKey
          });
        } else {
          let paramResponse = await inquirer.prompt([
            {
              name: "paramOverride",
              message: `Override "${parameterKey}" param value:`,
              type: "input",
              default: parameter.Default
            }
          ]);

          paramOverrides.push({
            Value: paramResponse.paramOverride,
            Name: parameterKey
          });
        }
      }
    }

    const cloudFormation = new AWS.CloudFormation();

    let createOrUpdateStackResponse = await inquirer.prompt([
      {
        name: "createNewStack",
        message: "Create a new stack?",
        type: "confirm",
        default: false
      }
    ]);

    var stackName = null;

    if (createOrUpdateStackResponse.createNewStack) {
      let newStackNameResponse = await inquirer.prompt([
        {
          name: "stackName",
          message: "Choose a name for the new stack",
          type: "input"
        }
      ]);

      stackName = newStackNameResponse.stackName;
    } else {
      let stacks = await cloudFormation
        .listStacks({
          StackStatusFilter: [
            "CREATE_COMPLETE",
            "UPDATE_COMPLETE",
            "UPDATE_ROLLBACK_COMPLETE"
          ]
        })
        .promise();

      const stackOptions = stacks.StackSummaries.filter(
        stack =>
          !flags["stack-filter"] ||
          stack.StackName.match(new RegExp(flags["stack-filter"], "i"))
      )
        .filter(stack => !stack.ParentId)
        .sort((a, b) => {
          return (
            (b.LastUpdatedTime || b.CreationTime) -
            (a.LastUpdatedTime || a.CreationTime)
          );
        })
        .map(stack => {
          return { name: stack.StackName };
        });

      let existingStackResponse = await inquirer.prompt([
        {
          name: "stackName",
          message: `select a stack in ${region}`,
          type: "list",
          choices: stackOptions
        }
      ]);

      stackName = existingStackResponse.stackName;
    }

    const s3 = new AWS.S3();

    const bucketsResponse = await s3.listBuckets().promise();

    const bucketOptions = bucketsResponse.Buckets.filter(bucket =>
      bucket.Name.match(new RegExp(flags["bucket-filter"], "i"))
    ).map(bucket => {
      return { name: bucket.Name };
    });

    let bucketResponse = await inquirer.prompt([
      {
        name: "bucketName",
        message: `select an s3 source-code bucket in ${region}`,
        type: "list",
        choices: bucketOptions
      }
    ]);

    const bucketName = bucketResponse.bucketName;

    const bucketLocationResponse = await s3
      .getBucketLocation({ Bucket: bucketName })
      .promise();

    const bucketInRegion =
      region === "us-east-1"
        ? bucketLocationResponse.LocationConstraint !== null
        : bucketLocationResponse.LocationConstraint === region;

    if (!bucketInRegion) {
      console.error(
        `Bucket ${bucketName} must be in the ${region} region, instead it is in ${
          bucketLocationResponse.LocationConstraint
        }`
      );
      this.exit();
    }

    let packageResponse = await inquirer.prompt([
      {
        name: "shouldPackage",
        message: "Re-package with sam package?",
        type: "confirm",
        default: true
      }
    ]);

    if (!flags["skip-build"]) {
      cli.action.start("Building the stack");

      const buildResults = await samBuild(region, flags.profile);

      cli.action.stop();
    }

    if (packageResponse.shouldPackage) {
      cli.action.start("Packaging the stack");

      const packageResults = await samPackage(
        bucketName,
        flags["deploy-dir"],
        flags.template,
        region,
        flags.profile
      );

      cli.action.stop();
    }

    const capabilityAnswers = await inquirer.prompt([
      {
        name: "hasIAMCapability",
        message: "Deploy with CAPABILITY_IAM capability?",
        type: "confirm",
        default: true
      },
      {
        name: "hasAutoExpandCapability",
        message: "Deploy with CAPABILITY_AUTO_EXPAND capability?",
        type: "confirm",
        default: false
      }
    ]);

    const capabilities = [];

    if (capabilityAnswers.hasIAMCapability) {
      capabilities.push("CAPABILITY_IAM");
    }

    if (capabilityAnswers.hasAutoExpandCapability) {
      capabilities.push("CAPABILITY_AUTO_EXPAND");
    }

    cli.action.start(`Deploying ${stackName}`);

    const deployResults = await samDeploy(
      stackName,
      flags["deploy-dir"],
      paramOverrides,
      region,
      flags.profile,
      capabilities
    );

    cli.action.stop();
  }
}

Deploy.description = "Deploys this SAM stack to AWS";

Deploy.flags = {
  region: flags.string({
    char: "r",
    description: "Destination AWS region",
    required: false
  }),
  profile: flags.string({
    char: "p",
    description: "Sets the AWS profile",
    required: false
  }),
  "deploy-dir": flags.string({
    char: "d",
    description:
      "Path to local deploy directory where the code artifacts and template file are located",
    required: false,
    default: "./.aws-sam/build"
  }),
  template: flags.string({
    char: "t",
    description:
      "Name of the template to package, located inside the --deploy-dir",
    required: false,
    default: "template.yaml"
  }),
  "stack-filter": flags.string({
    char: "f",
    description:
      "A pattern to filter stacks when displaying which stack to deploy",
    required: false
  }),
  "bucket-filter": flags.string({
    char: "b",
    description:
      "A pattern to filter s3 buckets when choosing the source code s3 bucket",
    required: false,
    default: "source-code"
  }),
  "override-parameters": flags.boolean({
    char: "o",
    description:
      "Set this flag if you'd like to override this stack's parameters on deploy",
    required: false,
    default: false
  }),
  "skip-build": flags.boolean({
    description: "Set this flag to skip the build step",
    required: false,
    default: false
  })
};

module.exports = Deploy;
