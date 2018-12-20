const { Command, flags } = require("@oclif/command");
const { cli } = require("cli-ux");

const util = require("util");

const exec = util.promisify(require("child_process").exec);

const inquirer = require("inquirer");
const AWS = require("aws-sdk");

const YAML = require("yaml");
const fs = require("fs");

const loadTemplate = deployDir => {
  const warn = console.warn;
  console.warn = () => {};
  const doc = YAML.parse(fs.readFileSync(`${deployDir}/template.yml`, "utf8"));
  console.warn = warn;

  return doc;
};

const samPackage = async (bucketName, deployDir) => {
  const packageCommand = `sam package --template-file ${deployDir}/template.yml --s3-bucket ${bucketName} --output-template-file ${deployDir}/packaged.yml`;

  console.log(`Running ${packageCommand}`);

  return await exec(packageCommand);
};

const samDeploy = async (stackName, deployDir, parameterOverrides) => {
  let deployCommand = `sam deploy --template-file ${deployDir}/packaged.yml --stack-name ${stackName} --capabilities CAPABILITY_IAM`;

  if (parameterOverrides.length > 0) {
    const parameterOverridesPart = parameterOverrides.reduce((cmd, p) => {
      return `${cmd} ${p.Name}="${p.Value}"`;
    }, "");

    deployCommand += ` --parameter-overrides ${parameterOverridesPart}`;
  }

  console.log(`Running ${deployCommand}`);

  return await exec(deployCommand);
};

class Deploy extends Command {
  async run() {
    // can get args as an object
    const { argv, flags } = this.parse(Deploy);

    let region = flags.region || process.env["AWS_REGION"];

    if (!region) {
      const { stdout } = await exec(`aws configure get region`);
      region = stdout.replace(/\n$/, "");
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

    const paramOverrides = [];

    if (flags["override-parameters"]) {
      const doc = loadTemplate(flags.deployDir);

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
          !flags.stackFilter ||
          stack.StackName.match(new RegExp(flags.stackFilter, "i"))
      )
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
      bucket.Name.match(new RegExp(flags.bucketFilter, "i"))
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

    const bucketInRegion = region === "us-east-1"
      ? bucketLocationResponse.LocationConstraint !== null
      : bucketLocationResponse.LocationConstraint !== region;

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

    if (packageResponse.shouldPackage) {
      cli.action.start("Packaging the stack");

      const packageResults = await samPackage(bucketName, flags.deployDir);

      cli.action.stop();
    }

    cli.action.start(`Deploying ${stackName}`);

    const deployResults = await samDeploy(
      stackName,
      flags.deployDir,
      paramOverrides
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
  deployDir: flags.string({
    char: "d",
    description:
      "Path to local deploy directory where the code artifacts and template.yml are located",
    required: false,
    default: "./deploy"
  }),
  stackFilter: flags.string({
    char: "f",
    description:
      "A pattern to filter stacks when displaying which stack to deploy",
    required: false
  }),
  bucketFilter: flags.string({
    char: "b",
    description:
      "A pattern to filter s3 buckets when choosing the source code s3 bucket",
    required: false,
    default: "source-code"
  }),
  "override-parameters": flags.boolean({
    char: "p",
    description:
      "Set this flag if you'd like to override this stack's parameters on deploy",
    required: false,
    default: false
  })
};

module.exports = Deploy;
