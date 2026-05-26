import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadSupportedChains } from "./chains.js";
import { DEFAULT_PUBLIC_BASE_PATH } from "./constants.js";
import {
  createSnapshotFiles,
  fetchProtocolData,
  parseChainIds,
  selectChains,
} from "./snapshot.js";
import { getSampleProtocolData } from "./sample-data.js";
import type { SnapshotFile } from "./types.js";

type SnapshotSource = "hasura" | "sample";

const getRequiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const createS3Client = () =>
  new S3Client({
    region: getRequiredEnv("REGION"),
    endpoint: getRequiredEnv("ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: getRequiredEnv("ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("SECRET_ACCESS_KEY"),
    },
  });

const uploadAndVerify = async (
  client: S3Client,
  bucket: string,
  file: SnapshotFile
) => {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.key,
      Body: file.body,
      ContentType: file.contentType,
      CacheControl: file.cacheControl,
    })
  );

  await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: file.key,
    })
  );
};

const writeLocalFile = async (outputDir: string, file: SnapshotFile) => {
  const filePath = path.join(outputDir, file.key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, file.body);
};

export async function runPublisher() {
  const publicBasePath =
    process.env.SNAPSHOT_PUBLIC_BASE_PATH || DEFAULT_PUBLIC_BASE_PATH;
  const supportedChains = await loadSupportedChains();
  const chainIds = parseChainIds(
    process.env.SNAPSHOT_CHAIN_IDS,
    supportedChains
  );
  const chains = selectChains(chainIds, supportedChains);
  const outputDir = process.env.SNAPSHOT_OUTPUT_DIR;
  const source = (process.env.SNAPSHOT_SOURCE ||
    (outputDir ? "sample" : "hasura")) as SnapshotSource;
  if (source !== "sample" && source !== "hasura") {
    throw new Error(
      `SNAPSHOT_SOURCE must be sample or hasura; received ${source}`
    );
  }

  const loadProtocolData =
    source === "sample"
      ? (chainId: number) => getSampleProtocolData(chainId)
      : (chainId: number) =>
          fetchProtocolData(
            getRequiredEnv("HASURA_GRAPHQL_URL"),
            chainId,
            process.env.HASURA_GRAPHQL_ADMIN_SECRET?.trim()
          );

  const files = await createSnapshotFiles({
    chains,
    loadProtocolData,
    publicBasePath,
  });

  const regularFiles = files.filter((file) => !file.publishLast);
  const publishLastFiles = files.filter((file) => file.publishLast);

  if (outputDir) {
    for (const file of [...regularFiles, ...publishLastFiles]) {
      await writeLocalFile(outputDir, file);
    }
    console.log(`Wrote ${files.length} snapshot files to ${outputDir}`);
    return;
  }

  const client = createS3Client();
  const bucket = getRequiredEnv("BUCKET");

  for (const file of regularFiles) {
    await uploadAndVerify(client, bucket, file);
  }
  for (const file of publishLastFiles) {
    await uploadAndVerify(client, bucket, file);
  }

  console.log(`Published ${files.length} snapshot files to ${bucket}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPublisher().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
