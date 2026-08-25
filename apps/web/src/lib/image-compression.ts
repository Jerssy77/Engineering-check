const PHOTO_UPLOAD_TARGET_BYTES = 460 * 1024;
const PHOTO_MAX_DIMENSION = 1920;
const PHOTO_MIN_DIMENSION = 640;

export interface PreparedUploadFile {
  file: File;
  compressed: boolean;
  originalSize: number;
}

function jpegFileName(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "photo";
  return `${baseName}.jpg`;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("照片压缩失败")),
      "image/jpeg",
      quality
    );
  });
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取照片"));
      element.src = objectUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export async function prepareFileForUpload(file: File): Promise<PreparedUploadFile> {
  if (!file.type.startsWith("image/") || file.size <= PHOTO_UPLOAD_TARGET_BYTES) {
    return { file, compressed: false, originalSize: file.size };
  }

  let loaded: Awaited<ReturnType<typeof loadImage>>;
  try {
    loaded = await loadImage(file);
  } catch {
    throw new Error(`${file.name} 无法自动压缩，请转换为 JPG、PNG 或 WebP 后重试`);
  }

  try {
    const initialScale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(loaded.width, loaded.height));
    let width = Math.max(1, Math.round(loaded.width * initialScale));
    let height = Math.max(1, Math.round(loaded.height * initialScale));

    for (let resizeRound = 0; resizeRound < 8; resizeRound += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器不支持照片压缩");

      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(loaded.source, 0, 0, width, height);

      for (const quality of [0.84, 0.72, 0.6, 0.48, 0.36, 0.28]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= PHOTO_UPLOAD_TARGET_BYTES) {
          return {
            file: new File([blob], jpegFileName(file.name), { type: "image/jpeg", lastModified: file.lastModified }),
            compressed: true,
            originalSize: file.size
          };
        }
      }

      const longest = Math.max(width, height);
      if (longest <= PHOTO_MIN_DIMENSION) break;
      const resizeScale = Math.max(PHOTO_MIN_DIMENSION / longest, 0.78);
      width = Math.max(1, Math.round(width * resizeScale));
      height = Math.max(1, Math.round(height * resizeScale));
    }

    throw new Error(`${file.name} 压缩后仍然过大，请重新拍摄或裁剪后上传`);
  } finally {
    loaded.close();
  }
}
