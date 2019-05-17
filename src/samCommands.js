const util = require("util");
const exec = util.promisify(require("child_process").exec);

const samPackage = async (
  bucketName,
  deployDir,
  templateFile,
  region,
  profile,
  dryRun = false
) => {
  let packageCommand = `sam package --template-file ${deployDir}/${templateFile} --s3-bucket ${bucketName} --output-template-file ${deployDir}/packaged.yml --region ${region}`;

  if (profile) {
    packageCommand += ` --profile ${profile}`;
  }

  console.log(`Running ${packageCommand}`);

  if (dryRun) {
    return;
  }

  return exec(packageCommand);
};

const samDeploy = async (
  stackName,
  deployDir,
  parameterOverrides,
  region,
  profile,
  bucketName,
  capabilities = [],
  dryRun = false
) => {
  let deployCommand = `sam deploy --template-file ${deployDir}/packaged.yml --s3-bucket ${bucketName} --stack-name ${stackName} --region ${region}`;

  if (capabilities) {
    deployCommand += ` --capabilities ${capabilities.join(" ")}`;
  }

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

  if (dryRun) {
    return;
  }

  return exec(deployCommand);
};

const samBuild = async (region, profile, dryRun = false) => {
  let buildCommand = `sam build --region ${region}`;

  if (profile) {
    buildCommand += ` --profile ${profile}`;
  }

  console.log(`Running ${buildCommand}`);

  if (dryRun) {
    return;
  }

  return exec(buildCommand);
};

const getConfigRegion = async profile => {
  const getRegionCommand = profile
    ? `aws configure get region --profile ${profile}`
    : `aws configure get region`;

  const { stdout } = await exec(getRegionCommand);

  return stdout.replace(/\n$/, "");
};

module.exports = {
  samPackage,
  samDeploy,
  samBuild,
  getConfigRegion
};
