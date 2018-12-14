const { Command, flags } = require("@oclif/command");
const { cli } = require("cli-ux");

const util = require("util");

const exec = util.promisify(require("child_process").exec);

const inquirer = require("inquirer");
const AWS = require("aws-sdk");

const samPackage = async (bucketName, deployDir) => {
  return await exec(
    `sam package --template-file ${deployDir}/template.yml --s3-bucket ${bucketName} --output-template-file ${deployDir}/packaged.yml`
  );
};

const samDeploy = async (stackName, deployDir) => {
  const deployCommand = `sam deploy --template-file ${deployDir}/packaged.yml --stack-name ${stackName} --capabilities CAPABILITY_IAM`;

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

    if (bucketLocationResponse.LocationConstraint != region) {
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

    const deployResults = await samDeploy(stackName, flags.deployDir);

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
  })
};

module.exports = Deploy;
