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

## Read Stream

A very simple DynamoDB stream consumer that reads from all shards and prints events to STDOUT

Lookup help using the `--help` flag like so:

```bash
$ npx sam-helper read-stream --help
```
