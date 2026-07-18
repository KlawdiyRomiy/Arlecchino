package app

import (
	"context"
	"fmt"
	"strings"

	"arlecchino/internal/ai"
)

// aiBrowserPreviewExecutor uses the existing IDE preview bridge. It does not
// claim computer-use or screenshot capture: the result explicitly records the
// absence of a capture adapter until one is connected by the frontend.
func (a *App) aiBrowserPreviewExecutor(ctx context.Context, projectRoot string, req ai.AIBrowserPreviewRequest) (ai.AIBrowserPreviewResult, error) {
	value, err := a.aiMCPToolExecutor(ctx, projectRoot, "ide_ui.preview_open", map[string]any{
		"id":      "ai-browser-preview",
		"surface": "browser",
		"url":     req.URL,
		"title":   strings.TrimSpace(req.Title),
	})
	if err != nil {
		return ai.AIBrowserPreviewResult{}, err
	}
	return ai.AIBrowserPreviewResult{
		URL:                req.URL,
		PreviewID:          "ai-browser-preview",
		ScreenshotCaptured: false,
		Summary:            fmt.Sprintf("IDE browser preview opened through approved bridge (%T); screenshot capture is not connected.", value),
	}, nil
}
