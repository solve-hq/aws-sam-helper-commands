const { Command, flags } = require("@oclif/command");

const util = require("util");

const exec = util.promisify(require("child_process").exec);

const AWS = require("aws-sdk");

const fs = require("fs");
const YAML = require("yaml");

const isEqual = require("lodash.isequal");

const loadTemplate = (deployDir, templateFile) => {
  const warn = console.warn;
  console.warn = () => {};
  const doc = YAML.parse(
    fs.readFileSync(`${deployDir}/${templateFile}`, "utf8")
  );
  console.warn = warn;

  return doc;
};

const samPackage = async (
  region,
  bucketName,
  deployDir,
  templateFile,
  dryRun,
  profile
) => {
  let packageCommand = `sam package --template-file ${deployDir}/${templateFile} --s3-bucket ${bucketName} --output-template-file ${deployDir}/packaged.yml  --region ${region}`;

  if (profile) {
    packageCommand += ` --profile ${profile}`;
  }

  console.log(`Running ${packageCommand}`);

  if (!dryRun) {
    return await exec(packageCommand);
  }
};

const samDeploy = async (
  region,
  stackName,
  deployDir,
  parameterOverrides,
  dryRun,
  profile
) => {
  let deployCommand = `sam deploy --template-file ${deployDir}/packaged.yml --stack-name ${stackName} --capabilities CAPABILITY_IAM --region ${region}`;

  if (parameterOverrides.length > 0) {
    const parameterOverridesPart = parameterOverrides.reduce((cmd, p) => {
      return `${cmd} ${p.Name}="${p.Value}"`;
    }, "");

    deployCommand += ` --parameter-overrides ${parameterOverridesPart}`;
  }

  if (profile) {
    deployCommand += ` --profile ${profile}`;
  }

  console.log(`Running ${deployCommand}`);

  if (!dryRun) {
    return await exec(deployCommand);
  }
};

const encodedValue = rawValue => {
  let result;

  if (typeof rawValue == "string") {
    result = rawValue;
  } else {
    result = JSON.stringify(rawValue);
  }

  return result;
};

const configureParam = async (ssm, Name, rawValue, dryRun, override) => {
  try {
    const existingParam = await ssm.getParameter({ Name }).promise();

    if (encodedValue(rawValue) !== existingParam.Parameter.Value) {
      console.log(
        `Parameter drift detected on ${Name}. Expected Value to be ${encodedValue(
          rawValue
        )} but instead it is ${existingParam.Parameter.Value}`
      );

      if (override) {
        let Value;

        if (typeof rawValue == "string") {
          Value = rawValue;
        } else {
          Value = JSON.stringify(rawValue);
        }

        console.log(`Overriding parameter ${Name} with value ${Value}`);

        if (!dryRun) {
          return ssm
            .putParameter({
              Name,
              Value,
              Type: "String",
              Overwrite: true
            })
            .promise();
        }
      }
    }
  } catch (error) {
    let Value;

    if (typeof rawValue == "string") {
      Value = rawValue;
    } else {
      Value = JSON.stringify(rawValue);
    }

    console.log(`Putting parameter ${Name} with value ${Value}`);

    if (!dryRun) {
      return ssm
        .putParameter({
          Name,
          Value,
          Type: "String",
          Overwrite: true
        })
        .promise();
    }
  }
};

class DeployConfig extends Command {
  async run() {
    // can get args as an object
    const { argv, flags } = this.parse(DeployConfig);

    let region = flags.region || process.env["AWS_REGION"];

    const stackName = flags["stack-name"];
    const configFilePath = flags["config-file"];

    const configFileContents = fs.readFileSync(flags["config-file"], "utf8");

    const config = JSON.parse(configFileContents);

    const stackConfig = config.stacks[stackName];

    if (!stackConfig) {
      console.error(
        `Cannot deploy because stack ${stackName}: Its definition cannot be found in ${configFilePath}`
      );

      this.exit();
    }

    if (!region) {
      const getRegionCommand = config.profile
        ? `aws configure get region --profile ${config.profile}`
        : `aws configure get region`;

      const { stdout } = await exec(getRegionCommand);
      region = stdout.replace(/\n$/, "");
    }

    if (region) {
      AWS.config.update({ region: region });
    } else {
      console.error(
        "Cannot deploy because no AWS region specified. Please specify a region using the --region flag"
      );

      this.exit();
    }

    if (config.profile) {
      console.log(`Using AWS profile ${config.profile}`);

      const credentials = new AWS.SharedIniFileCredentials({
        profile: config.profile
      });

      AWS.config.update({ credentials });
    }

    const regionConfig = config.regions[region];

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

    const ssm = new AWS.SSM({ region: region });

    if (stackConfig.parameters) {
      const parameterOperations = Object.keys(stackConfig.parameters).map(
        Name =>
          configureParam(
            ssm,
            Name,
            stackConfig.parameters[Name],
            flags["dry-run"],
            flags["override-parameters"]
          )
      );

      await Promise.all(parameterOperations);
    }

    const doc = loadTemplate(flags["deploy-dir"], flags.template);

    const parameterKeys = Object.keys(doc.Parameters || {});

    for (let index = 0; index < parameterKeys.length; index++) {
      const parameterKey = parameterKeys[index];
      const parameter = doc.Parameters[parameterKey];

      if (parameter.Type.match(/AWS::SSM::Parameter::Value/)) {
        try {
          const existingParam = await ssm
            .getParameter({ Name: parameter.Default })
            .promise();
        } catch (error) {
          console.error(
            `Cannot deploy because stack depends on availability of ${
              parameter.Default
            } parameter. Create it in Systems Manager Parameter Store and then try again.`
          );

          this.exit();
        }
      }
    }

    if (config.secrets) {
      const secretsManager = new AWS.SecretsManager({ region: region });

      const allSecrets = Object.keys(config.secrets).map(async name => {
        const secretValue = config.secrets[name];

        try {
          const existingSecret = await secretsManager
            .getSecretValue({ SecretId: name })
            .promise();

          const existingSecretValue = JSON.parse(existingSecret.SecretString);

          if (!isEqual(existingSecretValue, secretValue)) {
            console.log(`Updating SecretString value for ${name}...`);

            return secretsManager
              .putSecretValue({
                SecretId: name,
                SecretString: JSON.stringify(secretValue)
              })
              .promise();
          }
        } catch (error) {
          console.log(`Creating SecretString ${name}...`);

          return secretsManager
            .createSecret({
              Name: name,
              SecretString: JSON.stringify(secretValue)
            })
            .promise();
        }
      });

      await Promise.all(allSecrets).catch(console.error);
    }

    console.log(`Deploying in ${region}...`);

    const packageResults = await samPackage(
      region,
      bucketName,
      flags["deploy-dir"],
      flags.template,
      flags["dry-run"],
      config.profile
    );

    const paramOverridesConfig = stackConfig.parameterOverrides || {};

    const paramOverrides = Object.keys(paramOverridesConfig).map(Name => {
      return { Name, Value: paramOverridesConfig[Name] };
    });

    const deployResults = await samDeploy(
      region,
      stackName,
      flags["deploy-dir"],
      paramOverrides,
      flags["dry-run"],
      config.profile
    );
  }
}

DeployConfig.description =
  "Deploys this SAM stack to AWS using the configuration file stack-config.json";

DeployConfig.flags = {
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
  "stack-name": flags.string({
    char: "n",
    description: "The stack found inside stack-config.json to deploy",
    required: true
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
  "override-parameters": flags.boolean({
    char: "p",
    description:
      "Override the parameters in Param Store with the parameters defined in the stack config file",
    required: false,
    default: false
  }),
  "dry-run": flags.boolean({
    description: "View the output of the command without making any changes",
    required: false,
    default: false
  })
};

module.exports = DeployConfig;
