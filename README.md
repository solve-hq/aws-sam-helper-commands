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

The `deploy-config` command allows a service to define stacks and their configuration in a local `stack-config.json` file.

An example config file that defines a stack that supports three different regions:

```json
{
  "regions": {
    "eu-west-2": {
      "bucket": "source-code-eu-west-2"
    },
    "us-west-2": {
      "bucket": "source-code-us-west-2"
    },
    "ap-southeast-2": {
      "bucket": "source-code-ap-southeast-2"
    }
  },
  "secrets": {
    "FunctionShield": {
      "token": "1234"
    }
  },
  "stacks": {
    "rest-api": {
      "stage": "dev",
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

You can deploy the above `rest-api` stack in any of the above regions using the `deploy-config` command, like this:

```bash
$ npx sam-helper deploy-config -n rest-api -r us-west-2
```

## Read Stream

A very simple DynamoDB stream consumer that reads from all shards and prints events to STDOUT

Lookup help using the `--help` flag like so:

```bash
$ npx sam-helper read-stream --help
```
