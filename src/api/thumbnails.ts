import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import type { ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
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
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      `Thumbnail file exceeds the maximum allowed size of 10MB`
    );
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }

  const base64EncodedThumbnailFile = Buffer.from(
    await file.arrayBuffer()
  ).toString("base64");
  if (!base64EncodedThumbnailFile) {
    throw new Error("Error reading file data");
  }

  const base64DataURL = `data:${mediaType};base64,${base64EncodedThumbnailFile}`;
  video.thumbnailURL = base64DataURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
