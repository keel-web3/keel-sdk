export const MEDIA_CANDIDATE_FORMATS = ["webp", "avif", "mp4", "mov", "webm"];
export function parseMediaPreparationCapabilities(value) {
    if (!value || typeof value !== "object")
        throw new Error("Media capabilities are unavailable. Retry to check the current encoders.");
    const record = value;
    const adapter = (input) => {
        if (!input || typeof input !== "object")
            throw new Error("The server returned invalid media capabilities.");
        const item = input;
        if (typeof item.available !== "boolean" || !Array.isArray(item.formats) || item.formats.some(format => !MEDIA_CANDIDATE_FORMATS.includes(format)))
            throw new Error("The server returned invalid media capabilities.");
        return { available: item.available, formats: item.formats, ...(typeof item.reason === "string" ? { reason: item.reason } : {}) };
    };
    if (record.schema !== "keel-media-capabilities@1")
        throw new Error("The server returned an unsupported media capabilities version.");
    return { schema: record.schema, image: adapter(record.image), movie: adapter(record.movie) };
}
export function mediaCandidateFormats(capabilities, source) {
    if (!capabilities)
        return [];
    return MEDIA_CANDIDATE_FORMATS.filter(format => (!source.movie && capabilities.image.available && capabilities.image.formats.includes(format) && !(source.animated && format === "avif")) || (capabilities.movie.available && capabilities.movie.formats.includes(format)));
}
export function mediaGeometryAvailable(capabilities, source, recipe) {
    return capabilities?.image.available === true && !source.movie && !source.animated && (recipe.format === "webp" || recipe.format === "avif");
}
export function mediaRecipeUnavailableReason(capabilities, source, recipe) {
    if (recipe.mode === "original")
        return undefined;
    if (!capabilities)
        return "Check the current encoders before preparing an edited candidate. Your saved edits and original are retained.";
    if (!mediaCandidateFormats(capabilities, source).includes(recipe.format))
        return `${recipe.format.toUpperCase()} conversion is unavailable on this server for this media. Your saved edits and original are retained.`;
    if ((recipe.width || recipe.height || recipe.crop || recipe.rotate || recipe.layers?.length) && !mediaGeometryAvailable(capabilities, source, recipe))
        return "Crop, resize, rotation and layers require a still image with the image encoder. Keep these edits saved, or undo them to use a movie format.";
    if (source.hasAudio && !recipe.noSound && (recipe.format === "webp" || recipe.format === "avif"))
        return "Image formats cannot retain audio. Explicitly remove audio or choose a movie format.";
    return undefined;
}
