import type { BunRequest } from "bun";
import { rm } from "fs/promises";
import path from "path";

import { getVideoAspectRatio, processVideoForFastStart } from "./assets";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";
import { generatePresignedURL, uploadVideoToS3 } from "../s3";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File exceeds size limit (1GB)");
  }
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Invalid file type, only MP4 is allowed");
  }

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, file);
  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const processedFilePath = await processVideoForFastStart(tempFilePath);

  let key = `${aspectRatio}/${videoId}.mp4`;
  await uploadVideoToS3(cfg, key, processedFilePath, "video/mp4");

  video.videoURL = key;

  updateVideo(cfg.db, video);

  await Promise.all([
    rm(tempFilePath, { force: true }),
    rm(processedFilePath, { force: true }),
  ]);

  const signedVideo = await dbVideoToSignedVideo(cfg, video);

  return respondWithJSON(200, signedVideo);
}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) {
    return video;
  }

  video.videoURL = await generatePresignedURL(cfg, video.videoURL, 5 * 60); // expires in 5 minutes

  return video;
}
