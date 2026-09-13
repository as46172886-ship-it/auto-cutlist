export type ImageDetail = "high" | "original";

export function structuredImageContent(images: Array<{ dataUrl: string }>, detail: ImageDetail = "high") {
  return images.map((image) => ({ type: "input_image", image_url: image.dataUrl, detail }));
}
