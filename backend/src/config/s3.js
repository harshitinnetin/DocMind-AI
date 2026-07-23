import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET_NAME;

/**
 * Upload a file buffer to S3.
 * @param {Buffer} buffer - File buffer
 * @param {string} key    - S3 object key (e.g. "documents/userId/uuid.pdf")
 * @param {string} mimeType - MIME type of the file
 * @returns {string} The S3 key that was uploaded
 */
export const uploadToS3 = async (buffer, key, mimeType) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });
  await s3Client.send(command);
  return key;
};

/**
 * Delete a file from S3.
 * @param {string} key - S3 object key
 */
export const deleteFromS3 = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  await s3Client.send(command);
};

/**
 * Generate a pre-signed URL for a file in S3.
 * @param {string} key          - S3 object key
 * @param {number} expiresIn    - Expiry in seconds (default: 3600)
 * @returns {string} Pre-signed URL
 */
export const getS3SignedUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Stream an S3 object response body (for piping to express res).
 * @param {string} key - S3 object key
 * @returns {{ body: ReadableStream, contentType: string, contentLength: number }}
 */
export const streamFromS3 = async (key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  const response = await s3Client.send(command);
  return {
    body: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
};

export default s3Client;
