const { DynamoDBStreams, DynamoDB } = require("aws-sdk");
const { Command, flags } = require("@oclif/command");
const pick = require("lodash.pick");

const { Readable } = require("stream");

const readRecordsFromShard = async (ShardId, StreamArn, service) => {
  const shardIteratorResponse = await service
    .getShardIterator({
      ShardId,
      ShardIteratorType: "TRIM_HORIZON",
      StreamArn
    })
    .promise();

  const ShardIterator = shardIteratorResponse.ShardIterator;

  const recordsStream = new Readable({
    read(size) {
      const recordsCallback = (err, data) => {
        if (err) {
          console.log("Stop the streaming");
          this.push(null);
        }

        this.ShardIterator = data.NextShardIterator;

        this.push(JSON.stringify(data.Records, null, 2));
      };

      if (this.ShardIterator) {
        service.getRecords(
          { ShardIterator: this.ShardIterator },
          recordsCallback.bind(this)
        );
      } else {
        console.log("Stop the streaming");
        this.push(null);
      }
    }
  });

  recordsStream.ShardIterator = ShardIterator;

  return recordsStream;
};

class ReadStream extends Command {
  async run() {
    const { argv, flags } = this.parse(ReadStream);

    let serviceOptions = pick(flags, ["endpoint", "region"]);

    const tableService = new DynamoDB(serviceOptions);
    const streamsService = new DynamoDBStreams(serviceOptions);

    const TableName = argv[0];

    const tableResponse = await tableService
      .describeTable({ TableName })
      .promise();

    const StreamArn = tableResponse.Table.LatestStreamArn;

    if (!StreamArn) {
      console.error(
        `Table ${TableName} does not have a LatestStreamArn property`
      );
      return;
    }

    const streamResponse = await streamsService
      .describeStream({ StreamArn })
      .promise();

    const shardIds = streamResponse.StreamDescription.Shards.map(
      shard => shard.ShardId
    );

    shardIds.forEach(async ShardId => {
      const recordStream = await readRecordsFromShard(
        ShardId,
        StreamArn,
        streamsService
      );

      recordStream.on("data", chunk => {
        const records = JSON.parse(chunk);

        if (records.length > 0) {
          console.log(JSON.stringify(records, null, 2));
        }
      });
    });
  }
}

ReadStream.description = "Reads the DynamoDB stream of a given table";

ReadStream.args = [{ name: "Table Name", required: true }];

ReadStream.examples = [
  "read-stream local-db-table",
  "read-stream local-db-table --endpoint http://localhost:8000",
  "read-stream local-db-table --endpoint http://localhost:8000",
  "read-stream local-db-table --endpoint http://localhost:8000"
];
ReadStream.flags = {
  endpoint: flags.string({
    char: "e",
    description:
      "DynamoDB service endpoint. Override this to use a local DynamoDB instance",
    required: false
  }),
  region: flags.string({
    char: "r",
    description: "Specify the AWS Region",
    required: false
  })
};

module.exports = ReadStream;
