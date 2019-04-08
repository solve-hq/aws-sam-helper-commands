# aws-sam-helper-commands

A CLI tool to make certain common AWS SAM commands easier to use

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/aws-sam-helper-commands.svg)](https://npmjs.org/package/aws-sam-helper-commands)
[![Downloads/week](https://img.shields.io/npm/dw/aws-sam-helper-commands.svg)](https://npmjs.org/package/aws-sam-helper-commands)
[![License](https://img.shields.io/npm/l/aws-sam-helper-commands.svg)](https://github.com/solve-hq/solve-hq/aws-sam-helper-commands/blob/master/package.json)

# Commands

## Deploy

Deploys a SAM stack to AWS using the stack definition in `stack-config.json`.

To use, first create a `stack-config.json` file in the root of your repository, e.g.:

```json
{
  "namespace": "Services",
  "service": "FeedApi",
  "name": "feed-api",
  "capabilities": ["CAPABILITY_IAM"],
  "stages": {
    "dev": {
      "profile": "dev",
      "regions": {
        "eu-west-2": {
          "bucket": "solve-dev-source-code-eu-west-2"
        }
      }
    }
  },
  "secrets": {
    "FeatureFlagService": {
      "token": "api-1234",
      "projectKey": "app"
    }
  }
}
```

> **Note** As you can see above, this file may contain secrets. For that reason, make sure to add `stack-config.json` to your `.gitignore` file to avoid publishing the file to a remote repo.

Then, to deploy, run `deploy` and pass in the stage name and the region to deploy to:

```bash
$ npx sam-helper deploy --stage dev --region eu-west-2
```

The above command will deploy a stack named `feed-api-dev` and will make sure the `/Services/FeedApi/FeatureFlagService` secret exists, if not it will be created.

You can skip running `sam build` by passing the skip-build flag:

```bash
$ npx sam-helper deploy --stage dev --region eu-west-2 --skip-build
```
