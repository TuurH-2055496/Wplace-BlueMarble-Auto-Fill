import { uint8ToBase64 } from "./utils";

/** An instance of a template.
 * Handles all mathematics, manipulation, and analysis regarding a single template.
 * @since 0.65.2
 */
export default class Template {

  /** The constructor for the {@link Template} class with enhanced pixel tracking.
   * @param {Object} [params={}] - Object containing all optional parameters
   * @param {string} [params.displayName='My template'] - The display name of the template
   * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
   * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
   * @param {string} [params.url=''] - The URL to the source image
   * @param {File} [params.file=null] - The template file (pre-processed File or processed bitmap)
   * @param {Array<number>} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
   * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
   * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
   * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
   * @since 0.65.2
   */
  constructor({
    displayName = 'My template',
    sortID = 0,
    authorID = '',
    url = '',
    file = null,
    coords = null,
    chunked = null,
    tileSize = 1000,
  } = {}) {
    this.displayName = displayName;
    this.sortID = sortID;
    this.authorID = authorID;
    this.url = url;
    this.file = file;
    this.coords = coords;
    this.chunked = chunked;
    this.tileSize = tileSize;
    this.pixelCount = 0; // Total pixel count in template
  }

  /** Creates chunks of the template for each tile.
   * 
   * @returns {Object} Collection of template bitmaps & buffers organized by tile coordinates
   * @since 0.65.4
   */
  async createTemplateTiles() {
    console.log('Template coordinates:', this.coords);

    const shreadSize = 3; // Scale image factor for pixel art enhancement (must be odd)
    const bitmap = await createImageBitmap(this.file); // Create efficient bitmap from uploaded file
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    
    // Calculate total pixel count using standard width × height formula
    // For performance, we'll calculate actual non-transparent pixels during processing
    let actualPixelCount = 0;
    console.log(`Template dimensions: ${imageWidth}×${imageHeight} = ${(imageWidth * imageHeight).toLocaleString()} total pixels`);

    const templateTiles = {}; // Holds the template tiles
    const templateTilesBuffers = {}; // Holds the buffers of the template tiles

    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // Pre-extract the entire template image data once for efficiency
    const sourceCanvas = new OffscreenCanvas(imageWidth, imageHeight);
    const sourceContext = sourceCanvas.getContext('2d');
    sourceContext.drawImage(bitmap, 0, 0);
    const sourceImageData = sourceContext.getImageData(0, 0, imageWidth, imageHeight);

    console.log('PERFORMANCE: Pre-extracted template image data for faster processing');

    // For every tile...
    for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {

      // Draws the partial tile first, if any
      // This calculates the size based on which is smaller:
      // A. The top left corner of the current tile to the bottom right corner of the current tile
      // B. The top left corner of the current tile to the bottom right corner of the image
      const drawSizeY = Math.min(this.tileSize - (pixelY % this.tileSize), imageHeight - (pixelY - this.coords[3]));

      for (let pixelX = this.coords[2]; pixelX < imageWidth + this.coords[2];) {

        // Draws the partial tile first, if any
        // This calculates the size based on which is smaller:
        // A. The top left corner of the current tile to the bottom right corner of the current tile
        // B. The top left corner of the current tile to the bottom right corner of the image
        const drawSizeX = Math.min(this.tileSize - (pixelX % this.tileSize), imageWidth - (pixelX - this.coords[2]));

        // Change the canvas size and wipe the canvas
        const canvasWidth = drawSizeX * shreadSize;
        const canvasHeight = drawSizeY * shreadSize;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        context.imageSmoothingEnabled = false; // Nearest neighbor

        // Draws the template segment on this tile segment
        context.clearRect(0, 0, canvasWidth, canvasHeight); // Clear any previous drawing
        context.drawImage(
          bitmap, // Bitmap image to draw
          pixelX - this.coords[2], // Coordinate X to draw from
          pixelY - this.coords[3], // Coordinate Y to draw from
          drawSizeX, // X width to draw from
          drawSizeY, // Y height to draw from
          0, // Coordinate X to draw at
          0, // Coordinate Y to draw at
          drawSizeX * shreadSize, // X width to draw at
          drawSizeY * shreadSize // Y height to draw at
        ); // Coordinates and size of draw area of source image, then canvas

        const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight); // Data of the image on the canvas

        // Count non-transparent pixels and apply transparency optimization
        let tilePixelCount = 0;
        for (let y = 0; y < canvasHeight; y++) {
          for (let x = 0; x < canvasWidth; x++) {
            // For every pixel...

            // ... Make it transparent unless it is the "center"
            if (x % shreadSize !== 1 || y % shreadSize !== 1) {
              const pixelIndex = (y * canvasWidth + x) * 4; // Find the pixel index in an array where every 4 indexes are 1 pixel
              imageData.data[pixelIndex + 3] = 0; // Make the pixel transparent on the alpha channel
            } else {
              // This is a center pixel - check if it's non-transparent in the source
              const sourceX = Math.floor(x / shreadSize) + (pixelX - this.coords[2]);
              const sourceY = Math.floor(y / shreadSize) + (pixelY - this.coords[3]);
              
              if (sourceX >= 0 && sourceX < imageWidth && sourceY >= 0 && sourceY < imageHeight) {
                const sourcePixelIndex = (sourceY * imageWidth + sourceX) * 4;
                const sourceAlpha = sourceImageData.data[sourcePixelIndex + 3];
                
                if (sourceAlpha > 0) {
                  tilePixelCount++;
                }
              }
            }
          }
        }

        actualPixelCount += tilePixelCount;

        context.putImageData(imageData, 0, 0);

        // Creates the "0000,0000,000,000" key name
        const templateTileName = `${(this.coords[0] + Math.floor(pixelX / 1000))
          .toString()
          .padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000))
          .toString()
          .padStart(4, '0')},${(pixelX % 1000)
          .toString()
          .padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`;

        templateTiles[templateTileName] = await createImageBitmap(canvas); // Creates the bitmap
        
        const canvasBlob = await canvas.convertToBlob();
        const canvasBuffer = await canvasBlob.arrayBuffer();
        const canvasBufferBytes = Array.from(new Uint8Array(canvasBuffer));
        templateTilesBuffers[templateTileName] = uint8ToBase64(canvasBufferBytes); // Stores the buffer

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
    }

    // Store the actual non-transparent pixel count for better accuracy
    this.pixelCount = actualPixelCount;
    console.log(`PERFORMANCE: Template processing complete - ${actualPixelCount.toLocaleString()} non-transparent pixels`);

    console.log('Template Tiles: ', templateTiles);
    console.log('Template Tiles Buffers: ', templateTilesBuffers);
    return { templateTiles, templateTilesBuffers };
  }
}
