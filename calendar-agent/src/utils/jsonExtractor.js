/**
 * Extract and parse JSON from LLM response
 * Handles markdown code blocks and surrounding text
 */
function extractJSON(text) {
    try {
        // Remove markdown code blocks
        let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');

        // Find first { and last }
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            return null;
        }

        // Extract just the JSON portion
        const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);

        // Parse it
        return JSON.parse(jsonStr);
    } catch (error) {
        return null;
    }
}

module.exports = { extractJSON };
