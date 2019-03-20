# aws-sam-helper-commands

A CLI tool to make certain common AWS SAM commands easier to use

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/aws-sam-helper-commands.svg)](https://npmjs.org/package/aws-sam-helper-commands)
[![Downloads/week](https://img.shields.io/npm/dw/aws-sam-helper-commands.svg)](https://npmjs.org/package/aws-sam-helper-commands)
[![License](https://img.shields.io/npm/l/aws-sam-helper-commands.svg)](https://github.com/solve-hq/solve-hq/aws-sam-helper-commands/blob/master/package.json)

# Commands

## Deploy

Deploys a SAM stack to AWS using `sam package` and `sam deploy`.

Examples:

```bash
$ npx sam-helper deploy
```

Lookup help using the `--help` flag like so:

```bash
$ npx sam-helper deploy --help
```

## Deploy Config

Deploys a SAM stack to AWS using `sam package` and `sam deploy`, but uses config data loaded from a JSON file instead of CLI prompts

To use, first create a `stack-config.json` file in the root of your repository, e.g.:

```json
{
  "profile": "solve-dev-eric",
  "capabilities": ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND"],
  "regions": {
    "eu-west-2": {
      "bucket": "solve-dev-source-code-eu-west-2"
    },
    "eu-west-1": {
      "bucket": "solve-dev-source-code-eu-west-1"
    }
  },
  "secrets": {
    "LogTesting/FunctionShield": {
      "token": "1234"
    }
  },
  "stacks": {
    "log-test-2019-03-19": {
      "stage": "dev",
      "parameterOverrides": {
        "LogLevel": "DEBUG"
      },
      "parameters": {
        "/Services/RestAPI/Config": {
          "dynamodb": {
            "params": { "TableName": "rest-api-table" }
          },
          "logLevel": "DEBUG"
        }
      }
    }
  }
}
```

> **Note** As you can see above, this file may contain secrets. For that reason, make sure to add `stack-config.json` to your `.gitignore` file to avoid publishing the file to a remote repo.

Then, to deploy, run `deploy-config` and pass in the stack name and the region to deploy to:

```bash
$ npx sam-helper deploy-config -n log-test-2019-03-19 -r eu-west-2
```

## Read Stream

A very simple DynamoDB stream consumer that reads from all shards and prints events to STDOUT

Lookup help using the `--help` flag like so:

```bash
$ npx sam-helper read-stream --help
```
