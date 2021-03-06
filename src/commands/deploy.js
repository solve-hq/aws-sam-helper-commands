const { Command, flags } = require("@oclif/command");
const { cli } = require("cli-ux");

const AWS = require("aws-sdk");

const fs = require("fs");
const YAML = require("yaml");

const isEqual = require("lodash.isequal");
const merge = require("lodash.merge");

const notifier = require("node-notifier");

const loadTemplate = (deployDir, templateFile) => {
  const warn = console.warn;
  console.warn = () => {};

  try {
    const doc = YAML.parse(
      fs.readFileSync(`${deployDir}/${templateFile}`, "utf8")
    );
    console.warn = warn;

    return doc;
  } catch (err) {
    console.log(err.Error);
    return {};
  }
};

const {
  samBuild,
  samDeploy,
  samPackage,
  getConfigRegion
} = require("../samCommands");

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

class Deploy extends Command {
  async run() {
    // can get args as an object
    const { argv, flags } = this.parse(Deploy);

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
        `Cannot deploy in ${region} to bucket ${bucketName} because it is located in ${bucketLocationResponse.LocationConstraint}`
      );

      this.exit();
    }

    const ssm = new AWS.SSM({ region: region });

    if (config.parameters) {
      const parameterOperations = Object.keys(config.parameters).map(Name =>
        configureParam(
          ssm,
          Name,
          config.parameters[Name],
          flags["dry-run"],
          flags["override-parameters"]
        )
      );

      await Promise.all(parameterOperations);
    }

    if (!flags["skip-build"] && !flags["resources-only"]) {
      cli.action.start("Building the stack");

      await samBuild(region, stageConfig.profile);

      cli.action.stop();
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
            `Cannot deploy because stack depends on availability of ${parameter.Default} parameter. Create it in Systems Manager Parameter Store and then try again.`
          );

          this.exit();
        }
      }
    }

    if (stageConfig.secrets) {
      const buildSecretId = secretName =>
        `/${config.namespace}/${config.service}${
          flags.stage === "test" ? "/test" : ""
        }/${secretName}`;

      const secretsManager = new AWS.SecretsManager({ region: region });

      const allSecrets = Object.keys(stageConfig.secrets).map(async name => {
        const secretValue = stageConfig.secrets[name];
        const SecretId = buildSecretId(name);

        try {
          const existingSecret = await secretsManager
            .getSecretValue({ SecretId })
            .promise();

          const existingSecretValue = JSON.parse(existingSecret.SecretString);

          if (!isEqual(existingSecretValue, secretValue)) {
            console.log(`Updating SecretString value for ${SecretId}...`);

            return secretsManager
              .putSecretValue({
                SecretId,
                SecretString: JSON.stringify(secretValue)
              })
              .promise();
          }
        } catch (error) {
          console.log(`Creating SecretString ${SecretId}...`);

          return secretsManager
            .createSecret({
              Name: SecretId,
              SecretString: JSON.stringify(secretValue)
            })
            .promise();
        }
      });

      await Promise.all(allSecrets).catch(console.error);
    }

    if (!flags["resources-only"]) {
      cli.action.start(`Packaging the stack`);

      await samPackage(
        bucketName,
        flags["deploy-dir"],
        flags.template,
        region,
        stageConfig.profile,
        flags["dry-run"]
      );

      cli.action.stop();

      const paramOverridesConfig = merge(
        {},
        config.parameterOverrides || {},
        stageConfig.paramOverrides || {}
      );

      const paramOverrides = Object.keys(paramOverridesConfig).map(Name => {
        return { Name, Value: paramOverridesConfig[Name] };
      });

      paramOverrides.push({ Name: "Stage", Value: flags.stage });

      cli.action.start(`Deploying in ${region}`);

      await samDeploy(
        stackName,
        flags["deploy-dir"],
        paramOverrides,
        region,
        stageConfig.profile,
        bucketName,
        config.capabilities,
        flags["dry-run"]
      );

      cli.action.stop();

      notifier.notify({
        title: `Stack deployed!`,
        message: `${stackName} was deployed to ${region}`
      });
    }
  }
}

Deploy.description =
  "Deploys this SAM stack to AWS using the configuration file stack-config.json";

Deploy.flags = {
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
  stage: flags.string({
    char: "s",
    description: "The stage to deploy",
    required: true,
    default: "dev"
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
  }),
  "skip-build": flags.boolean({
    description: "Set this flag to skip the build step",
    required: false,
    default: true
  }),
  "resources-only": flags.boolean({
    description: "Set this flag to true to only create the secrets and params",
    required: false,
    default: false
  })
};

module.exports = Deploy;
