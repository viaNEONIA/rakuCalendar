const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 2048;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("画像を読み込めませんでした。"));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("画像形式を読み込めません。PNG・JPEG・WebPを選択してください。")); };
    image.src = objectUrl;
  });
}

export async function compressEventImage(file: File): Promise<string> {
  if (!/^image\/(?:png|jpeg|webp)$/.test(file.type)) throw new Error("PNG・JPEG・WebP画像を選択してください。");
  if (file.size > MAX_INPUT_BYTES) throw new Error("画像ファイルは20MB以下を選択してください。");
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1 && file.size <= MAX_OUTPUT_BYTES) return readAsDataUrl(file);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を処理できませんでした。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("画像を処理できませんでした。")), outputType, 0.9);
  });
  if (blob.size > MAX_OUTPUT_BYTES) throw new Error("圧縮後の画像が4MBを超えています。小さい画像を選択してください。");
  return readAsDataUrl(blob);
}
